/* Browser substitute for the small Electron surface imported by preload/index.ts. */
const TYPE_KEY = '__proma_web_remote_type'
if (typeof window !== 'undefined') (window as Window & { __PROMA_WEB_REMOTE__?: boolean }).__PROMA_WEB_REMOTE__ = true

interface Listener { (event: { sender: Window }, value: unknown): void }

const listeners = new Map<string, Set<Listener>>()
const onceWrappers = new Map<Listener, Listener>()
let socket: WebSocket | null = null
let socketPromise: Promise<WebSocket> | null = null
let reconnectTimer: number | undefined
let reconnectDelay = 250
let hasConnectedOnce = false
let nextId = 0
const pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void; timer: number }>()

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
      if (hasConnectedOnce) window.dispatchEvent(new CustomEvent('proma-web-remote-reconnected'))
      hasConnectedOnce = true
      resolve(next)
    }
    next.onmessage = (event) => {
      try {
        const message = JSON.parse(typeof event.data === 'string' ? event.data : '') as { type?: string; id?: string; ok?: boolean; value?: unknown; error?: unknown; channel?: string }
        if (message.type === 'response' && message.id) {
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
      if (socket === next) socket = null
      socketPromise = null
      scheduleReconnect()
      if (pending.size === 0) return
    }
    next.onerror = () => { reject(new Error('IPC WebSocket 连接失败')) }
  })
  return socketPromise
}

async function invokeWithToken(channel: string, args: unknown[], confirmToken?: string): Promise<unknown> {
  const ws = await connect()
  const id = `${Date.now()}-${nextId++}`
  const payload = JSON.stringify({ type: 'invoke', id, channel, args: args.map(encode), ...(confirmToken ? { confirmToken } : {}) })
  const response = await new Promise<unknown>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error(`IPC 请求超时: ${channel}`))
    }, 35_000)
    pending.set(id, { resolve, reject, timer })
    ws.send(payload)
  })
  return response
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  try {
    return await invokeWithToken(channel, args)
  } catch (error) {
    const challenge = error as { needsConfirm?: boolean; summary?: string; token?: string }
    if (!challenge?.needsConfirm || !challenge.token) throw error
    const accepted = window.confirm(challenge.summary || `确认执行远程操作：${channel}`)
    if (!accepted) throw new Error('用户取消远程操作')
    return invokeWithToken(channel, args, challenge.token)
  }
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__PROMA_WEB_REMOTE_INVOKE', { configurable: false, enumerable: false, value: invoke })
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
