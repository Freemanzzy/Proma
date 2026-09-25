import { randomBytes } from 'node:crypto'
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import WebSocket from 'ws'
import { getMainWindow } from '../../main-window-store'
import type { WebRemoteConfig } from '../web-remote-auth'
import { decodeWebRemoteValue, encodeWebRemoteValue } from './serialization'
import { WebRemoteRegistrationTable } from './registration-table'
import { getWebRemoteChannelPolicy, getDeclaredWebRemoteChannels, type WebRemoteChannelLevel, type WebRemoteChannelPolicyEntry } from './channel-policy'

const REQUEST_TIMEOUT_MS = 30_000
const CONFIRM_TTL_MS = 60_000
const SENSITIVE_KEY = /(?:api.?key|token|secret|password|credential|authorization|private.?key|refresh|cookie|encrypted|decrypted)/i

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
type EventHandler = (event: IpcMainEvent, ...args: unknown[]) => void

interface IpcClient {
  ws: WebSocket
  deviceId: string
  confirmations: Map<string, { token: string; expiresAt: number }>
}

interface BridgeMessage {
  type?: string
  id?: string
  channel?: string
  args?: unknown[]
  confirmToken?: string
}

export interface WebRemoteAccessError {
  denied: true
  channel: string
  reason?: string
}

export interface WebRemoteConfirmError {
  needsConfirm: true
  channel: string
  summary: string
  token: string
}

let activeBridge: WebRemoteIpcBridge | null = null

function fakeEvent(sender: WebContents): IpcMainEvent & IpcMainInvokeEvent {
  return {
    sender,
    senderFrame: null,
    processId: 0,
    frameId: 0,
    returnValue: undefined,
    preventDefault() {},
    reply() {},
    ports: [],
  } as unknown as IpcMainEvent & IpcMainInvokeEvent
}

/** Validation hook installed before registerIpcHandlers(). */
export interface IpcMainCaptureTarget {
  handle(channel: string, listener: InvokeHandler): void
  on(channel: string, listener: EventHandler): unknown
}

export interface WebRemoteScopeResolvers {
  getSessionMeta(sessionId: string): { workspaceId?: string } | undefined
  listWorkspaces(): Array<{ id: string; slug: string }>
}

const EMPTY_SCOPE_RESOLVERS: WebRemoteScopeResolvers = { getSessionMeta: () => undefined, listWorkspaces: () => [] }

export function installWebRemoteIpcCapture(ipcMain: IpcMainCaptureTarget, config: WebRemoteConfig = {}, resolvers: WebRemoteScopeResolvers = EMPTY_SCOPE_RESOLVERS): WebRemoteIpcBridge {
  if (activeBridge) return activeBridge
  const bridge = new WebRemoteIpcBridge(config, resolvers)
  const target = ipcMain as unknown as IpcMainCaptureTarget
  const originalHandle = target.handle.bind(ipcMain)
  const originalOn = target.on.bind(ipcMain)
  target.handle = (channel, listener) => {
    bridge.registerInvoke(channel, listener)
    return originalHandle(channel, listener)
  }
  target.on = (channel, listener) => {
    bridge.registerEvent(channel, listener)
    return originalOn(channel, listener)
  }
  activeBridge = bridge
  return bridge
}

export function getWebRemoteIpcBridge(): WebRemoteIpcBridge | null { return activeBridge }

function walkValues(value: unknown, visitor: (value: unknown, key?: string) => void, key?: string): void {
  visitor(value, key)
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { for (const item of value) walkValues(item, visitor); return }
  for (const [childKey, child] of Object.entries(value)) walkValues(child, visitor, childKey)
}

function stringByKeys(args: unknown[], keys: string[]): string | undefined {
  let found: string | undefined
  walkValues(args, (value, key) => { if (!found && key && keys.includes(key) && typeof value === 'string' && value.trim()) found = value })
  return found
}

function resolveSessionId(args: unknown[], resolvers: WebRemoteScopeResolvers): string | undefined {
  const explicit = stringByKeys(args, ['sessionId', 'conversationId', 'agentSessionId'])
  if (explicit) return explicit
  for (const arg of args) {
    if (typeof arg === 'string' && resolvers.getSessionMeta(arg)) return arg
  }
  return undefined
}

function resolveWorkspaceId(args: unknown[], resolvers: WebRemoteScopeResolvers): string | undefined {
  const workspaces = resolvers.listWorkspaces()
  const bySlug = new Map(workspaces.map((workspace) => [workspace.slug, workspace.id]))
  const explicitId = stringByKeys(args, ['workspaceId'])
  if (explicitId) return explicitId
  const slug = stringByKeys(args, ['workspaceSlug', 'slug'])
  if (slug && bySlug.has(slug)) return bySlug.get(slug)
  const sessionId = resolveSessionId(args, resolvers)
  const session = sessionId ? resolvers.getSessionMeta(sessionId) : undefined
  return session?.workspaceId
}

function redactSensitive(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return undefined
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item)).filter((item) => item !== undefined)
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [childKey, child] of Object.entries(value)) {
    const next = redactSensitive(child, childKey)
    if (next !== undefined) output[childKey] = next
  }
  return output
}

function summarize(channel: string): string {
  const labels: Record<string, string> = {
    'automation:run-now': '确认立即运行定时任务',
    'agent:delete-session': '确认删除会话',
    'agent:delete-workspace': '确认删除工作区',
    'planning:delete-todo': '确认删除 Todo',
    'planning:delete-calendar-event': '确认删除日程',
    'planning:delete-group': '确认删除分组',
    'planning:delete-tag': '确认删除标签',
    'planning:delete-reminder': '确认删除提醒',
  }
  return labels[channel] ?? `确认执行远程操作：${channel}`
}

export class WebRemoteIpcBridge {
  private readonly invokeHandlers = new WebRemoteRegistrationTable<InvokeHandler>()
  private readonly eventHandlers = new WebRemoteRegistrationTable<EventHandler>()
  private readonly clients = new Set<IpcClient>()
  private wrappedContents?: WebContents
  private originalSend?: WebContents['send']
  private loggedUnknown = new Set<string>()

  constructor(private readonly config: WebRemoteConfig = {}, private readonly resolvers: WebRemoteScopeResolvers = EMPTY_SCOPE_RESOLVERS) {}

  registerInvoke(channel: string, handler: InvokeHandler): void { this.invokeHandlers.set(channel, handler) }
  registerEvent(channel: string, handler: EventHandler): void { this.eventHandlers.set(channel, handler) }
  getRegistrationCounts(): { invoke: number; event: number } { return { invoke: this.invokeHandlers.size, event: this.eventHandlers.size } }

  getUnclassifiedRegisteredChannels(): string[] {
    const known = new Set(getDeclaredWebRemoteChannels())
    return [...new Set([...this.invokeHandlersKeys(), ...this.eventHandlersKeys()].filter((channel) => !known.has(channel) || !getWebRemoteChannelPolicy(channel)))].sort()
  }

  reportCoverage(): void {
    const missing = this.getUnclassifiedRegisteredChannels()
    if (missing.length > 0) console.warn(`[Web Remote] full-ui 未分级通道 ${missing.length}: ${missing.join(', ')}`)
    else console.log(`[Web Remote] full-ui 分级覆盖率 100%（invoke=${this.invokeHandlers.size}, event=${this.eventHandlers.size}）`)
  }

  private *invokeHandlersKeys(): Iterable<string> { yield* this.invokeHandlers.keys() }
  private *eventHandlersKeys(): Iterable<string> { yield* this.eventHandlers.keys() }

  attachWebSocket(ws: WebSocket, deviceId: string): void {
    const client: IpcClient = { ws, deviceId, confirmations: new Map() }
    this.clients.add(client)
    this.ensureWrapped()
    this.sendRaw(ws, JSON.stringify({ type: 'ready' }))
    ws.on('message', (raw) => { void this.handleMessage(client, raw.toString()) })
    const remove = () => { this.clients.delete(client) }
    ws.once('close', remove)
    ws.once('error', remove)
  }

  private ensureWrapped(): void {
    const contents = getMainWindow()?.webContents
    if (!contents || contents === this.wrappedContents) return
    this.wrappedContents = contents
    this.originalSend = contents.send.bind(contents)
    const original = this.originalSend
    contents.send = ((channel: string, ...args: unknown[]) => {
      const result = original(channel, ...args)
      this.broadcast(channel, args.length <= 1 ? args[0] : args)
      return result
    }) as WebContents['send']
  }

  private policy(channel: string): WebRemoteChannelPolicyEntry | undefined {
    return getWebRemoteChannelPolicy(channel)
  }

  private deny(channel: string, reason: string): WebRemoteAccessError {
    return { denied: true, channel, reason }
  }

  private workspaceAllowed(workspaceId: string | undefined): boolean {
    if (!workspaceId) return false
    const workspace = this.resolvers.listWorkspaces().find((item) => item.id === workspaceId)
    if (!workspace) return false
    if (this.config.workspaceScope === 'all') return true
    const allowed = this.config.allowedWorkspaceIds
    return Array.isArray(allowed) && allowed.includes(workspaceId)
  }

  private sessionAllowed(sessionId: string | undefined): boolean {
    if (!sessionId) return false
    return this.workspaceAllowed(this.resolvers.getSessionMeta(sessionId)?.workspaceId)
  }

  private scopeAllowed(policy: WebRemoteChannelPolicyEntry, args: unknown[]): boolean {
    if (policy.scope === 'none') return true
    if (policy.scope === 'session') return this.sessionAllowed(resolveSessionId(args, this.resolvers))
    return this.workspaceAllowed(resolveWorkspaceId(args, this.resolvers))
  }

  private challenge(client: IpcClient, channel: string): WebRemoteConfirmError {
    const token = randomBytes(18).toString('base64url')
    client.confirmations.set(channel, { token, expiresAt: Date.now() + CONFIRM_TTL_MS })
    return { needsConfirm: true, channel, summary: summarize(channel), token }
  }

  private consumeConfirmation(client: IpcClient, channel: string, token: string | undefined): boolean {
    const pending = client.confirmations.get(channel)
    if (!pending || !token || pending.token !== token || pending.expiresAt < Date.now()) return false
    client.confirmations.delete(channel)
    return true
  }

  private async authorize(client: IpcClient, channel: string, policy: WebRemoteChannelPolicyEntry | undefined, args: unknown[], confirmToken?: string): Promise<WebRemoteAccessError | WebRemoteConfirmError | null> {
    if (!policy) {
      if (!this.loggedUnknown.has(channel)) { this.loggedUnknown.add(channel); console.warn(`[Web Remote] 未登记通道默认拒绝: ${channel}`) }
      return this.deny(channel, 'channel is not registered in the full-ui policy')
    }
    if (policy.level === 'denied') return this.deny(channel, policy.rationale)
    if (!this.scopeAllowed(policy, args)) return this.deny(channel, 'session/workspace is outside the allowed scope or missing')
    if (policy.level === 'confirm' && !this.consumeConfirmation(client, channel, confirmToken)) return this.challenge(client, channel)
    return null
  }

  private filterResult(channel: string, value: unknown): unknown {
    let filtered = channel === 'settings:get' || channel === 'channel:list' ? redactSensitive(value) : value
    if (channel === 'agent:list-workspaces' && Array.isArray(filtered)) {
      filtered = filtered.filter((workspace) => workspace && typeof workspace === 'object' && this.workspaceAllowed((workspace as { id?: string }).id)).map((workspace) => {
        if (!workspace || typeof workspace !== 'object') return workspace
        const copy = { ...(workspace as Record<string, unknown>) }
        delete copy.projectRootPath
        return copy
      })
    }
    if (Array.isArray(filtered)) {
      filtered = filtered.filter((item) => {
        if (!item || typeof item !== 'object') return true
        const record = item as Record<string, unknown>
        const sessionId = typeof record.sessionId === 'string' ? record.sessionId : typeof record.conversationId === 'string' ? record.conversationId : undefined
        const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId : undefined
        return (!sessionId || this.sessionAllowed(sessionId)) && (!workspaceId || this.workspaceAllowed(workspaceId))
      })
    }
    return filtered
  }

  private eventAllowed(channel: string, value: unknown): boolean {
    const policy = this.policy(channel)
    if (!policy || policy.level === 'denied') return false
    if (policy.scope === 'session') {
      const sessionId = resolveSessionId([value], this.resolvers)
      return this.sessionAllowed(sessionId)
    }
    if (policy.scope === 'workspace') return this.workspaceAllowed(resolveWorkspaceId([value], this.resolvers))
    return true
  }

  private broadcast(channel: string, value: unknown): void {
    if (!this.eventAllowed(channel, value)) {
      if (!this.loggedUnknown.has(channel) && !this.policy(channel)) { this.loggedUnknown.add(channel); console.warn(`[Web Remote] 未登记事件默认拒绝: ${channel}`) }
      return
    }
    let payload: unknown
    try { payload = encodeWebRemoteValue(value) } catch (error) {
      console.error('[Web Remote full-ui] 事件序列化失败:', channel, error instanceof Error ? error.message : String(error))
      payload = { __proma_web_remote_error: 'serialization_failed', channel }
    }
    const message = JSON.stringify({ type: 'event', channel, value: payload })
    for (const client of this.clients) if (client.ws.readyState === WebSocket.OPEN) this.sendRaw(client.ws, message)
  }

  private async handleMessage(client: IpcClient, raw: string): Promise<void> {
    let message: BridgeMessage
    try { message = JSON.parse(raw) as BridgeMessage } catch { this.send(client, { type: 'error', error: 'invalid json' }); return }
    const { type, id, channel } = message
    if (!channel || (type !== 'invoke' && type !== 'send')) { this.send(client, { type: 'error', id, error: 'unsupported message' }); return }
    const args = Array.isArray(message.args) ? message.args.map(decodeWebRemoteValue) : []
    const policy = this.policy(channel)
    const authorization = await this.authorize(client, channel, policy, args, message.confirmToken)
    if (authorization) { this.send(client, { type: 'response', id, ok: false, error: authorization }); return }
    this.ensureWrapped()
    const sender = getMainWindow()?.webContents
    if (!sender) { this.send(client, { type: 'response', id, ok: false, error: 'main window unavailable' }); return }
    if (type === 'send') {
      const handler = this.eventHandlers.get(channel)
      if (!handler) { this.send(client, { type: 'response', id, ok: false, error: `unknown channel: ${channel}` }); return }
      try { handler(fakeEvent(sender), ...args); if (id) this.send(client, { type: 'response', id, ok: true, value: null }) }
      catch (error) { this.send(client, { type: 'response', id, ok: false, error: serializeError(error) }) }
      return
    }
    const handler = this.invokeHandlers.get(channel)
    if (!handler) { this.send(client, { type: 'response', id, ok: false, error: `unknown channel: ${channel}` }); return }
    try {
      const value = await Promise.race([Promise.resolve(handler(fakeEvent(sender), ...args)), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('IPC 请求超时')), REQUEST_TIMEOUT_MS))])
      this.send(client, { type: 'response', id, ok: true, value: encodeWebRemoteValue(this.filterResult(channel, value)) })
    } catch (error) {
      try { this.send(client, { type: 'response', id, ok: false, error: serializeError(error) }) }
      catch (serializationError) { console.error('[Web Remote] 响应序列化失败:', serializationError) }
    }
  }

  private send(client: IpcClient, message: unknown): void { if (client.ws.readyState === WebSocket.OPEN) this.sendRaw(client.ws, JSON.stringify(message)) }
  private sendRaw(ws: WebSocket, message: string): void { ;(ws as unknown as { send(data: string): void }).send(message) }
}

function serializeError(error: unknown): unknown {
  if (error && typeof error === 'object' && ('denied' in error || 'needsConfirm' in error)) return error
  return { message: error instanceof Error ? error.message : String(error) }
}
