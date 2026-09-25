import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import WebSocket from 'ws'
import { getMainWindow } from '../../main-window-store'
import { getWebRemoteDeniedError } from './denied-channels'
import { decodeWebRemoteValue, encodeWebRemoteValue } from './serialization'
import { WebRemoteRegistrationTable } from './registration-table'

const REQUEST_TIMEOUT_MS = 30_000

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

type EventHandler = (event: IpcMainEvent, ...args: unknown[]) => void

interface IpcClient {
  ws: WebSocket
  deviceId: string
}

interface BridgeMessage {
  type?: string
  id?: string
  channel?: string
  args?: unknown[]
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

/** Captures existing ipcMain registrations while preserving normal Electron behavior. */
export function installWebRemoteIpcCapture(): WebRemoteIpcBridge {
  if (activeBridge) return activeBridge
  const bridge = new WebRemoteIpcBridge()
  const target = ipcMain as unknown as {
    handle: (channel: string, listener: InvokeHandler) => void
    on: (channel: string, listener: EventHandler) => unknown
  }
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

export function getWebRemoteIpcBridge(): WebRemoteIpcBridge | null {
  return activeBridge
}

export class WebRemoteIpcBridge {
  private readonly invokeHandlers = new WebRemoteRegistrationTable<InvokeHandler>()
  private readonly eventHandlers = new WebRemoteRegistrationTable<EventHandler>()
  private readonly clients = new Set<IpcClient>()
  private wrappedContents?: WebContents
  private originalSend?: WebContents['send']

  registerInvoke(channel: string, handler: InvokeHandler): void {
    this.invokeHandlers.set(channel, handler)
  }

  registerEvent(channel: string, handler: EventHandler): void {
    this.eventHandlers.set(channel, handler)
  }

  getRegistrationCounts(): { invoke: number; event: number } {
    return { invoke: this.invokeHandlers.size, event: this.eventHandlers.size }
  }

  attachWebSocket(ws: WebSocket, deviceId: string): void {
    const client: IpcClient = { ws, deviceId }
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

  private broadcast(channel: string, value: unknown): void {
    let payload: unknown
    try {
      payload = encodeWebRemoteValue(value)
    } catch (error) {
      console.error('[Web Remote full-ui] 事件序列化失败:', channel, error instanceof Error ? error.message : String(error))
      payload = { __proma_web_remote_error: 'serialization_failed', channel }
    }
    const message = JSON.stringify({ type: 'event', channel, value: payload })
    for (const client of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) this.sendRaw(client.ws, message)
    }
  }

  private async handleMessage(client: IpcClient, raw: string): Promise<void> {
    let message: BridgeMessage
    try { message = JSON.parse(raw) as BridgeMessage } catch {
      this.send(client, { type: 'error', error: 'invalid json' })
      return
    }
    const { type, id, channel } = message
    if (!channel || (type !== 'invoke' && type !== 'send')) {
      this.send(client, { type: 'error', id, error: 'unsupported message' })
      return
    }
    const denied = getWebRemoteDeniedError(channel)
    if (denied) {
      this.send(client, { type: 'response', id, ok: false, error: denied })
      return
    }
    const args = Array.isArray(message.args) ? message.args.map(decodeWebRemoteValue) : []
    this.ensureWrapped()
    const sender = getMainWindow()?.webContents
    if (!sender) {
      this.send(client, { type: 'response', id, ok: false, error: 'main window unavailable' })
      return
    }
    if (type === 'send') {
      const handler = this.eventHandlers.get(channel)
      if (!handler) {
        this.send(client, { type: 'response', id, ok: false, error: `unknown channel: ${channel}` })
        return
      }
      try {
        handler(fakeEvent(sender), ...args)
        if (id) this.send(client, { type: 'response', id, ok: true, value: null })
      } catch (error) {
        this.send(client, { type: 'response', id, ok: false, error: serializeError(error) })
      }
      return
    }
    const handler = this.invokeHandlers.get(channel)
    if (!handler) {
      this.send(client, { type: 'response', id, ok: false, error: `unknown channel: ${channel}` })
      return
    }
    try {
      const value = await Promise.race([
        Promise.resolve(handler(fakeEvent(sender), ...args)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('IPC 请求超时')), REQUEST_TIMEOUT_MS)),
      ])
      this.send(client, { type: 'response', id, ok: true, value: encodeWebRemoteValue(value) })
    } catch (error) {
      try {
        this.send(client, { type: 'response', id, ok: false, error: serializeError(error) })
      } catch (serializationError) {
        console.error('[Web Remote full-ui] 响应序列化失败:', serializationError)
      }
    }
  }

  private send(client: IpcClient, message: unknown): void {
    if (client.ws.readyState !== WebSocket.OPEN) return
    this.sendRaw(client.ws, JSON.stringify(message))
  }

  private sendRaw(ws: WebSocket, message: string): void {
    ;(ws as unknown as { send(data: string): void }).send(message)
  }
}

function serializeError(error: unknown): unknown {
  if (error && typeof error === 'object' && 'denied' in error) return error
  return { message: error instanceof Error ? error.message : String(error) }
}
