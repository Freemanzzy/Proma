/* Browser substitute for the small Electron surface imported by preload/index.ts. */
import { coalesceRequest } from './ipc-request-dedupe'
import { isWebRemoteDataSaverEnabled, webRemoteHistoryBudgets } from './mobile-budget'
const TYPE_KEY = '__proma_web_remote_type'
if (typeof window !== 'undefined') {
  const remoteWindow = window as Window & { __PROMA_WEB_REMOTE__?: boolean }
  remoteWindow.__PROMA_WEB_REMOTE__ = true
  class WebRemoteAudio {
    src = ''
    preload = 'none'
    addEventListener(): void {}
    removeEventListener(): void {}
    load(): void {}
    play(): Promise<void> { return Promise.resolve() }
  }
  Object.defineProperty(window, 'Audio', { configurable: true, writable: true, value: WebRemoteAudio })
}

interface Listener { (event: { sender: Window }, value: unknown): void }

const listeners = new Map<string, Set<Listener>>()
const onceWrappers = new Map<Listener, Listener>()
let socket: WebSocket | null = null
let socketPromise: Promise<WebSocket> | null = null
let reconnectTimer: number | undefined
let reconnectDelay = 250
let hasConnectedOnce = false
let nextId = 0
let loggedSendSync = false
let lastInboundAt = 0
let livenessCheck: Promise<WebSocket> | null = null
/** 连接空闲超过该时长后，发请求前先 ping 确认连接仍活着（iOS 切后台后常出现“看似 OPEN 实已断开”的连接）。 */
const LIVENESS_IDLE_MS = 10_000
const PING_TIMEOUT_MS = 3_000
const pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void; timer: number; ws?: WebSocket; timeoutMs?: number }>()
const responseChunks = new Map<string, { requestId?: string; total: number; parts: string[]; received: number }>()
const inFlightReadRequests = new Map<string, Promise<unknown>>()
const RESPONSE_TIMEOUT_MS = 35_000
const SEND_MESSAGE_RESPONSE_TIMEOUT_MS = 60_000
const SEND_VERIFY_HISTORY_BUDGET_BYTES = 128 * 1024

function dataSaverEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const override = window.localStorage.getItem('proma-web-remote-data-saver')
    if (override === 'on') return true
    if (override === 'off') return false
  } catch {}
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection
  return isWebRemoteDataSaverEnabled(null, connection)
}

function consumeChunk(message: { id?: string; requestId?: string; seq?: number; total?: number; data?: string }): string | null {
  if (!message.id || !Number.isInteger(message.seq) || !Number.isInteger(message.total) || typeof message.data !== 'string' || !message.total || message.total > 4096 || message.seq! < 0 || message.seq! >= message.total) return null
  let transfer = responseChunks.get(message.id)
  if (!transfer) { transfer = { requestId: message.requestId, total: message.total!, parts: new Array(message.total), received: 0 }; responseChunks.set(message.id, transfer) }
  if (transfer.total !== message.total || transfer.requestId !== message.requestId) { responseChunks.delete(message.id); return null }
  if (transfer.parts[message.seq!] === undefined) { transfer.parts[message.seq!] = message.data; transfer.received++ }
  const request = message.requestId ? pending.get(message.requestId) : undefined
  if (request) { window.clearTimeout(request.timer); request.timer = window.setTimeout(() => { pending.delete(message.requestId!); responseChunks.delete(message.id!); request.reject(new Error('IPC 请求超时: response chunks stalled')) }, request.timeoutMs ?? RESPONSE_TIMEOUT_MS) }
  if (transfer.received !== transfer.total) return null
  responseChunks.delete(message.id)
  return reassembleTextChunks(transfer.parts)
}

function encode(value: unknown): unknown {
  if (value === undefined) return { [TYPE_KEY]: 'undefined' }
  if (value instanceof Date) return { [TYPE_KEY]: 'date', value: value.toISOString() }
  if (value instanceof Uint8Array) {
    let binary = ''
    for (const byte of value) binary += String.fromCharCode(byte)
    return { [TYPE_KEY]: 'bytes', value: btoa(binary) }
  }
  if (value instanceof ArrayBuffer) return encode(new Uint8Array(value))
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error(`无法序列化 ${typeof value}`)
  if (Array.isArray(value)) return value.map(encode)
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) output[key] = encode(item)
    return output
  }
  return value
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record[TYPE_KEY] === 'undefined') return undefined
  if (record[TYPE_KEY] === 'date' && typeof record.value === 'string') return new Date(record.value)
  if (record[TYPE_KEY] === 'bytes' && typeof record.value === 'string') {
    const binary = atob(record.value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
  }
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) output[key] = decode(item)
  return output
}

function normalizeHistoryWindow(value: unknown, sessionId?: string): unknown {
  if (!value || typeof value !== 'object' || (value as { __webRemoteHistoryWindow?: unknown }).__webRemoteHistoryWindow !== true) return value
  const windowed = value as { messages?: unknown; omittedCount?: number; hasEarlier?: boolean; startIndex?: number }
  const messages = Array.isArray(windowed.messages) ? windowed.messages : []
  const metadata = { omittedCount: windowed.omittedCount ?? 0, hasEarlier: windowed.hasEarlier === true, startIndex: windowed.startIndex ?? 0, sessionId }
  Object.defineProperty(messages, '__webRemoteHistory', { configurable: true, value: metadata })
  ;(window as Window & { __PROMA_WEB_REMOTE_HISTORY_META?: typeof metadata }).__PROMA_WEB_REMOTE_HISTORY_META = metadata
  return messages
}

function notify(channel: string, value: unknown): void {
  const event = { sender: window }
  for (const listener of [...(listeners.get(channel) ?? [])]) listener(event, decode(value))
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined
    socketPromise = null
    void connect()
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, 5000)
}

function connect(): Promise<WebSocket> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket)
  if (socketPromise) return socketPromise
  socketPromise = new Promise<WebSocket>((resolve, reject) => {
    const url = new URL('/api/ipc', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const next = new WebSocket(url)
    socket = next
    next.onopen = () => {
      reconnectDelay = 250
      lastInboundAt = Date.now()
      if (hasConnectedOnce) window.dispatchEvent(new CustomEvent('proma-web-remote-reconnected'))
      hasConnectedOnce = true
      resolve(next)
    }
    next.onmessage = (event) => {
      try {
        lastInboundAt = Date.now()
        let message = JSON.parse(typeof event.data === 'string' ? event.data : '') as { type?: string; id?: string; requestId?: string; seq?: number; total?: number; data?: string; ok?: boolean; value?: unknown; error?: unknown; channel?: string }
        if (message.type === 'chunk') {
          const assembled = consumeChunk(message)
          if (assembled === null) return
          message = JSON.parse(assembled) as typeof message
        }
        if (message.type === 'pong' && message.id) {
          const request = pending.get(message.id)
          if (request) { pending.delete(message.id); window.clearTimeout(request.timer); request.resolve(true) }
        } else if (message.type === 'response' && message.id) {
          const request = pending.get(message.id)
          if (!request) return
          pending.delete(message.id)
          window.clearTimeout(request.timer)
          if (message.ok) request.resolve(decode(message.value))
          else request.reject(message.error ?? new Error('IPC 请求失败'))
        } else if (message.type === 'event' && message.channel) {
          notify(message.channel, message.value)
        }
      } catch (error) {
        console.error('[Web Remote full-ui] 无法解析 IPC 帧', error)
      }
    }
    next.onclose = () => {
      // 只处理仍是当前连接的关闭；已被 liveSocket 主动替换的旧连接不影响新连接及其请求。
      if (socket === next) {
        socket = null
        socketPromise = null
        scheduleReconnect()
      }
      // 连接断开时立即让该连接上的在途请求失败，而不是等 35 秒超时。
      for (const [id, request] of [...pending]) {
        if (request.ws !== next) continue
        pending.delete(id)
        window.clearTimeout(request.timer)
        request.reject(new Error('与 Mac 的连接已断开'))
      }
    }
    next.onerror = () => { reject(new Error('IPC WebSocket 连接失败')) }
  })
  return socketPromise
}

function dropSocket(ws: WebSocket): void {
  if (socket === ws) socket = null
  socketPromise = null
  try { ws.close() } catch { /* already closed */ }
}

async function pingSocket(ws: WebSocket): Promise<boolean> {
  const id = `ping-${Date.now()}-${nextId++}`
  return new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => { pending.delete(id); resolve(false) }, PING_TIMEOUT_MS)
    pending.set(id, { resolve: () => resolve(true), reject: () => resolve(false), timer, ws })
    try { ws.send(JSON.stringify({ type: 'ping', id })) } catch { window.clearTimeout(timer); pending.delete(id); resolve(false) }
  })
}

/** 返回一个确认存活的连接：空闲过久先 ping，无响应则丢弃并重连。 */
function liveSocket(force = false): Promise<WebSocket> {
  if (livenessCheck) return livenessCheck
  livenessCheck = (async () => {
    const ws = await connect()
    if (!force && Date.now() - lastInboundAt < LIVENESS_IDLE_MS) return ws
    if (await pingSocket(ws)) return ws
    console.warn('[Web Remote full-ui] 连接无响应，正在重连')
    dropSocket(ws)
    return connect()
  })().finally(() => { livenessCheck = null })
  return livenessCheck
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const revalidate = () => { if (document.visibilityState === 'visible' && hasConnectedOnce) void liveSocket(true).catch(() => undefined) }
  document.addEventListener('visibilitychange', revalidate)
  window.addEventListener('pageshow', revalidate)
  window.addEventListener('online', revalidate)
}

function showSendStatusToast(message: string, tone: 'neutral' | 'warning' | 'error'): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null
  document.querySelector('[data-web-remote-send-status]')?.remove()
  document.querySelector('[data-web-remote-send-failed]')?.remove()
  const toast = document.createElement('div')
  toast.setAttribute('data-web-remote-send-status', tone)
  toast.setAttribute('role', 'status')
  toast.textContent = message
  const background = tone === 'error' ? '#b42318' : tone === 'warning' ? '#8a5a00' : '#475467'
  toast.style.cssText = `position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top) + 64px);z-index:2147483647;padding:12px 14px;border-radius:12px;background:${background};color:#fff;font-size:14px;line-height:1.4;box-shadow:0 6px 20px rgba(0,0,0,.25)`
  toast.addEventListener('click', () => toast.remove())
  document.body.appendChild(toast)
  if (tone !== 'neutral') window.setTimeout(() => toast.remove(), 8_000)
  return toast
}

function showSendFailedToast(): void {
  showSendStatusToast('消息未送达 Mac，请检查连接后重新发送（刷新页面可查看实际记录）', 'error')
}

function userMessageText(message: unknown): string {
  if (typeof message === 'string') return message
  if (!message || typeof message !== 'object') return ''
  if (Array.isArray(message)) return message.map(userMessageText).join('')
  const record = message as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (typeof record.content === 'string') return record.content
  if (Array.isArray(record.content)) return userMessageText(record.content)
  if (Array.isArray(record.parts)) return userMessageText(record.parts)
  return ''
}

export function reassembleTextChunks(parts: string[]): string {
  return parts.join('')
}

export type AgentSendVerification = 'found' | 'not-found' | 'check-failed'

export async function verifySentAgentMessage(sentText: string, loadHistory: () => Promise<unknown>): Promise<AgentSendVerification> {
  try {
    const history = await loadHistory()
    const needle = sentText.slice(0, 200)
    if (!needle || !Array.isArray(history)) return 'not-found'
    const found = history.some((message) => {
      if (!message || typeof message !== 'object' || (message as { role?: unknown }).role !== 'user') return false
      return userMessageText((message as Record<string, unknown>).content).includes(needle)
    })
    return found ? 'found' : 'not-found'
  } catch {
    return 'check-failed'
  }
}

function isAmbiguousSendFailure(error: unknown): boolean {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && /超时|连接已断开|连接失败|WebSocket.*(?:closed|open)|not open/i.test(message)
}

async function verifyAndNotifySendFailure(input: { sessionId?: unknown; userMessage?: unknown }): Promise<boolean> {
  const sentText = typeof input.userMessage === 'string' ? input.userMessage : ''
  const status = showSendStatusToast('发送确认较慢，正在核对…', 'neutral')
  const result = await verifySentAgentMessage(sentText, () => invokeWithToken('agent:get-sdk-messages', [input.sessionId, { budgetBytes: SEND_VERIFY_HISTORY_BUDGET_BYTES }]))
  if (result === 'found') { status?.remove(); return true }
  if (status) {
    status.textContent = '可能未送达，请刷新确认后再重发'
    status.setAttribute('data-web-remote-send-status', 'warning')
    window.setTimeout(() => status.remove(), 8_000)
  } else showSendStatusToast('可能未送达，请刷新确认后再重发', 'warning')
  return false
}

async function invokeWithToken(channel: string, args: unknown[], confirmToken?: string): Promise<unknown> {
  const ws = await liveSocket()
  const id = `${Date.now()}-${nextId++}`
  const requestArgs = channel === 'agent:get-sdk-messages' && dataSaverEnabled()
    ? [args[0], { ...(args[1] && typeof args[1] === 'object' ? args[1] as Record<string, unknown> : {}), budgetBytes: webRemoteHistoryBudgets(true).historyBytes, inlineImageBudgetBytes: webRemoteHistoryBudgets(true).inlineImageBytes }]
    : args
  const payload = JSON.stringify({ type: 'invoke', id, channel, args: requestArgs.map(encode), ...(confirmToken ? { confirmToken } : {}) })
  const response = await new Promise<unknown>((resolve, reject) => {
    const timeoutMs = channel === 'agent:send-message' ? SEND_MESSAGE_RESPONSE_TIMEOUT_MS : RESPONSE_TIMEOUT_MS
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error(`IPC 请求超时: ${channel}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer, ws, timeoutMs })
    ws.send(payload)
  })
  return channel === 'agent:get-sdk-messages' ? normalizeHistoryWindow(response, typeof args[0] === 'string' ? args[0] : undefined) : response
}

async function loadEarlierHistory(sessionId: string, endIndex: number): Promise<unknown[]> {
  const messages = await invokeWithToken('agent:get-sdk-messages', [sessionId, { endIndex, budgetBytes: 2 * 1024 * 1024 }])
  if (!Array.isArray(messages)) return []
  window.dispatchEvent(new CustomEvent('proma-web-remote-history-earlier', { detail: { sessionId, messages } }))
  return messages
}

function safeDeniedValue(channel: string): unknown {
  return /(?:list|get.*(?:status|tools|sounds)|statuses|candidates|search)/i.test(channel) ? [] : null
}

const MOBILE_FILE_MAX_BYTES = 25 * 1024 * 1024

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function openBrowserFileDialog(): Promise<unknown> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/*,video/*,audio/*,.pdf,.txt,.md,.json,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip'
    input.setAttribute('capture', 'environment')
    input.style.position = 'fixed'
    input.style.left = '-10000px'
    document.body.appendChild(input)
    let settled = false
    let cancelTimer: number | undefined
    const finish = (value: unknown) => {
      if (settled) return
      settled = true
      if (cancelTimer !== undefined) window.clearTimeout(cancelTimer)
      input.remove()
      resolve(value)
    }
    // Keep the input alive briefly after the browser reports picker cancellation. This also
    // permits CDP/mobile automation to attach files to the just-created input before cleanup.
    input.addEventListener('cancel', () => {
      cancelTimer = window.setTimeout(() => finish({ files: [], directories: [] }), 1_500)
    }, { once: true })
    input.addEventListener('change', () => {
      if (cancelTimer !== undefined) window.clearTimeout(cancelTimer)
      void (async () => {
        const files: Array<{ filename: string; mediaType: string; data: string; size: number }> = []
        const skippedFiles: Array<{ filename: string; size: number; reason: 'unreadable'; message: string }> = []
        for (const file of Array.from(input.files ?? [])) {
          if (file.size > MOBILE_FILE_MAX_BYTES) {
            skippedFiles.push({ filename: file.name, size: file.size, reason: 'unreadable', message: '手机端单个附件不能超过 25MB' })
            continue
          }
          try {
            files.push({ filename: file.name, mediaType: file.type || 'application/octet-stream', data: bytesToBase64(new Uint8Array(await file.arrayBuffer())), size: file.size })
          } catch {
            skippedFiles.push({ filename: file.name, size: file.size, reason: 'unreadable', message: '浏览器无法读取此文件' })
          }
        }
        finish({ files, skippedFiles, directories: [] })
      })()
    }, { once: true })
    input.click()
  })
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  if (channel === 'agent:open-file-or-folder-dialog') return openBrowserFileDialog()
  if (channel === 'agent:save-files-to-session') {
    try { return await invokeWithToken(channel, args) }
    catch (error) {
      const access = error as { denied?: boolean; reason?: string }
      if (access?.denied) throw new Error(access.reason || '手机附件上传被服务端拒绝')
      throw error
    }
  }
  if (channel === 'agent:list-sessions') return coalesceRequest(inFlightReadRequests, JSON.stringify([channel, args]), () => invokeWithToken(channel, args), 3_000)
  try {
    return await invokeWithToken(channel, args)
  } catch (error) {
    const access = error as { denied?: boolean; needsConfirm?: boolean; summary?: string; token?: string }
    if (channel === 'agent:send-message' && !access?.denied && !access?.needsConfirm) {
      if (isAmbiguousSendFailure(error)) {
        const input = args[0] && typeof args[0] === 'object' ? args[0] as { sessionId?: unknown; userMessage?: unknown } : {}
        if (await verifyAndNotifySendFailure(input)) return { accepted: true }
      } else showSendFailedToast()
    }
    if (access?.denied) {
      console.warn(`[Web Remote full-ui] 已安全忽略不可用通道: ${channel}`)
      return safeDeniedValue(channel)
    }
    const challenge = access
    if (!challenge?.needsConfirm || !challenge.token) throw error
    const accepted = window.confirm(challenge.summary || `确认执行远程操作：${channel}`)
    if (!accepted) throw new Error('用户取消远程操作')
    return invokeWithToken(channel, args, challenge.token)
  }
}

async function invokeStrict(channel: string, ...args: unknown[]): Promise<unknown> {
  return invokeWithToken(channel, args)
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__PROMA_WEB_REMOTE_INVOKE', { configurable: false, enumerable: false, value: invokeStrict })
  Object.defineProperty(window, '__PROMA_WEB_REMOTE_LOAD_EARLIER', { configurable: false, enumerable: false, value: loadEarlierHistory })
}

function send(channel: string, ...args: unknown[]): void {
  void connect().then((ws) => ws.send(JSON.stringify({ type: 'send', id: `${Date.now()}-${nextId++}`, channel, args: args.map(encode) }))).catch((error) => console.error('[Web Remote full-ui] send 失败', error))
}

export const contextBridge = {
  exposeInMainWorld(name: string, value: unknown): void {
    Object.defineProperty(window, name, { configurable: false, enumerable: true, value })
  },
}

export const ipcRenderer = {
  invoke,
  // Electron's synchronous IPC is unavailable in a browser. Return the safe
  // no-op value used by optional desktop-only persistence paths instead of
  // throwing during renderer initialization.
  sendSync(channel: string, ..._args: unknown[]): null {
    if (!loggedSendSync) {
      loggedSendSync = true
      console.warn(`[Web Remote full-ui] ipcRenderer.sendSync 不支持，已忽略: ${channel}`)
    }
    return null
  },
  send,
  on(channel: string, listener: Listener): void {
    let set = listeners.get(channel)
    if (!set) { set = new Set(); listeners.set(channel, set) }
    set.add(listener)
    void connect().catch(() => {})
  },
  once(channel: string, listener: Listener): void {
    const wrapper: Listener = (event, value) => {
      this.removeListener(channel, wrapper)
      listener(event, value)
    }
    onceWrappers.set(listener, wrapper)
    this.on(channel, wrapper)
  },
  removeListener(channel: string, listener: Listener): void {
    const actual = onceWrappers.get(listener) ?? listener
    listeners.get(channel)?.delete(actual)
    onceWrappers.delete(listener)
  },
  removeAllListeners(channel?: string): void {
    if (channel) listeners.delete(channel)
    else listeners.clear()
  },
}

export const webUtils = {
  getPathForFile(_file: File): string {
    console.warn('[Web Remote full-ui] webUtils.getPathForFile 在浏览器中返回空字符串')
    return ''
  },
}
