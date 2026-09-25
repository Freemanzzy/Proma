import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import { agentEventBus, isAgentSessionActive, listActiveAgentSessionSnapshots, queueAgentMessage, runAgentHeadless, stopAgent } from '../agent-service'
import { getAgentSessionMeta, getAgentSessionSDKMessages, listAgentSessions } from '../agent-session-manager'
import { listAgentWorkspaces } from '../agent-workspace-manager'
import { permissionService } from '../agent-permission-service'
import { redactSensitiveLogValue } from '../bridge-log-redaction'
import type { PermissionRequest } from '@proma/shared'
import { WebRemoteAuth, expectedWebRemoteOrigin, makeAuthCookie, parseCookieHeader, type WebRemoteConfig } from './web-remote-auth'
import { WebRemoteEventHub } from './web-remote-events'
import { toWebRemoteHistory, toWebRemotePermissionRequest, type WebRemoteEvent } from './web-remote-dto'
import { renderWebRemoteIcon, renderWebRemoteManifest, renderWebRemoteStatic } from './web-remote-static'
import type { WebRemoteIpcBridge } from './full-ui/web-remote-ipc'

const MAX_BODY_BYTES = 100_000
const MAX_MESSAGE_CHARS = 50_000

interface AuthenticatedRequest {
  deviceId: string
}

export interface WebRemoteServerOptions {
  config: WebRemoteConfig
  auth: WebRemoteAuth
  eventHub?: WebRemoteEventHub
  sendMessage?: (sessionId: string, message: string) => Promise<'started' | 'injected'>
  stopSession?: (sessionId: string) => void
  ipcBridge?: WebRemoteIpcBridge
  rendererDir?: string
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', (chunk: Buffer | string) => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {}
        resolve(parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {})
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

function sendUpgradeError(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

export class WebRemoteServer {
  readonly httpServer: Server
  readonly wsServer: WebSocketServer
  private readonly auth: WebRemoteAuth
  private readonly eventHub: WebRemoteEventHub
  private readonly connections = new Map<WebSocket, () => void>()
  private revokeTimer?: ReturnType<typeof setInterval>
  private listening = false

  constructor(private readonly options: WebRemoteServerOptions) {
    this.auth = options.auth
    this.eventHub = options.eventHub ?? new WebRemoteEventHub()
    this.httpServer = createServer((req, res) => { void this.handleHttp(req, res) })
    this.wsServer = new WebSocketServer({ noServer: true })
    this.httpServer.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head))
    this.wsServer.on('connection', (ws: WebSocket, req: IncomingMessage) => this.handleWebSocket(ws, req))
  }

  getAuth(): WebRemoteAuth {
    return this.auth
  }

  getEventHub(): WebRemoteEventHub {
    return this.eventHub
  }

  async start(port: number, host = '127.0.0.1'): Promise<void> {
    if (this.listening) return
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { this.httpServer.off('listening', onListening); reject(error) }
      const onListening = () => { this.httpServer.off('error', onError); this.listening = true; resolve() }
      this.httpServer.once('error', onError)
      this.httpServer.once('listening', onListening)
      this.httpServer.listen(port, host)
    })
    this.revokeTimer = setInterval(() => {
      this.auth.refreshFromDisk()
      for (const deviceId of this.auth.getRevokedDeviceIds()) this.eventHub.disconnectDevice(deviceId)
    }, 1000)
    this.revokeTimer.unref?.()
  }

  async stop(): Promise<void> {
    if (this.revokeTimer) clearInterval(this.revokeTimer)
    this.revokeTimer = undefined
    for (const ws of this.connections.keys()) ws.close(1001, 'server stopping')
    this.connections.clear()
    if (!this.listening) return
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()))
    this.listening = false
  }

  private authenticate(req: IncomingMessage, requireOrigin: boolean): AuthenticatedRequest | null {
    const token = parseCookieHeader(req.headers.cookie)
    const device = this.auth.authenticateToken(token)
    if (!device) return null
    if (requireOrigin && !this.auth.isAllowedOrigin(typeof req.headers.origin === 'string' ? req.headers.origin : undefined)) return null
    if (!this.auth.isAllowedTailscaleLogin(typeof req.headers['tailscale-user-login'] === 'string' ? req.headers['tailscale-user-login'] : undefined)) return null
    return { deviceId: device.id }
  }

  private hasAllowedWorkspace(workspaceId: string | undefined): boolean {
    return this.auth.isWorkspaceAllowed(workspaceId)
  }

  private sessionAllowed(sessionId: string): ReturnType<typeof getAgentSessionMeta> {
    const session = getAgentSessionMeta(sessionId)
    return session && this.hasAllowedWorkspace(session.workspaceId) ? session : undefined
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname

    if (method === 'GET' && path === '/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(renderWebRemoteManifest())
      return
    }

    if (method === 'GET' && path === '/icon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(renderWebRemoteIcon())
      return
    }

    if (path === '/app' || path.startsWith('/app/')) {
      await this.handleAppRequest(req, res, path)
      return
    }

    if (method === 'GET' && path === '/') {
      const nonce = randomBytes(16).toString('base64url')
      const configuredOrigin = expectedWebRemoteOrigin(this.options.config)
      let websocketOrigin = ''
      if (configuredOrigin) {
        try { websocketOrigin = ` wss://${new URL(configuredOrigin).host}` } catch { websocketOrigin = '' }
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'${websocketOrigin}; img-src 'self' data:; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      })
      res.end(renderWebRemoteStatic(nonce))
      return
    }

    if (method === 'POST' && path === '/api/pair') {
      if (!this.auth.isAllowedOrigin(typeof req.headers.origin === 'string' ? req.headers.origin : undefined)
        || !this.auth.isAllowedTailscaleLogin(typeof req.headers['tailscale-user-login'] === 'string' ? req.headers['tailscale-user-login'] : undefined)) {
        json(res, 403, { error: 'origin or identity rejected' })
        return
      }
      try {
        const body = await readBody(req)
        const code = typeof body.code === 'string' ? body.code : ''
        const label = typeof body.label === 'string' ? body.label : 'Web Remote'
        const paired = this.auth.pair(code, label)
        if (!paired) { json(res, 401, { error: 'invalid or locked pairing code' }); return }
        json(res, 200, { deviceId: paired.deviceId }, { 'Set-Cookie': makeAuthCookie(paired.token) })
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : 'invalid request' })
      }
      return
    }

    const isWrite = method !== 'GET'
    const identity = this.authenticate(req, isWrite)
    if (!identity) {
      json(res, 401, { error: 'unauthorized' })
      return
    }
    if (!Array.isArray(this.options.config.allowedWorkspaceIds) || this.options.config.allowedWorkspaceIds.length === 0) {
      json(res, 403, { error: 'no workspaces allowed' })
      return
    }

    if (method === 'GET' && path === '/api/workspaces') {
      const workspaces = listAgentWorkspaces().filter((workspace) => this.hasAllowedWorkspace(workspace.id))
      json(res, 200, workspaces.map(({ projectRootPath: _path, ...workspace }) => workspace))
      return
    }

    if (method === 'GET' && path === '/api/sessions') {
      const snapshots = new Map(this.activeSnapshots())
      const pending = new Set(permissionService.getPendingRequests().map((request) => request.sessionId))
      const sessions = [...this.sessionMetas()].filter((session) => this.hasAllowedWorkspace(session.workspaceId)).map((session) => ({
        id: session.id,
        title: session.title,
        workspaceId: session.workspaceId,
        updatedAt: session.updatedAt,
        running: snapshots.has(session.id),
        hasPendingPermission: pending.has(session.id),
      }))
      json(res, 200, sessions)
      return
    }

    const messagesMatch = path.match(/^\/api\/sessions\/([^/]+)\/messages$/)
    if (method === 'GET' && messagesMatch) {
      const session = this.sessionAllowed(decodeURIComponent(messagesMatch[1]!))
      if (!session) { json(res, 404, { error: 'session not found' }); return }
      const rawLimit = Number(url.searchParams.get('limit') ?? '200')
      const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 1000 ? rawLimit : 200
      const messages = toWebRemoteHistory(getAgentSessionSDKMessages(session.id))
      json(res, 200, messages.slice(Math.max(0, messages.length - limit)) )
      return
    }

    const sendMatch = path.match(/^\/api\/sessions\/([^/]+)\/send$/)
    if (method === 'POST' && sendMatch) {
      const sessionId = decodeURIComponent(sendMatch[1]!)
      if (!this.sessionAllowed(sessionId)) { json(res, 404, { error: 'session not found' }); return }
      try {
        const body = await readBody(req)
        const message = typeof body.message === 'string' ? body.message.trim() : ''
        if (!message || message.length > MAX_MESSAGE_CHARS) { json(res, 400, { error: 'invalid message' }); return }
        const disposition = await this.sendMessage(sessionId, message)
        json(res, 202, { disposition })
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : 'send failed' })
      }
      return
    }

    const stopMatch = path.match(/^\/api\/sessions\/([^/]+)\/stop$/)
    if (method === 'POST' && stopMatch) {
      const sessionId = decodeURIComponent(stopMatch[1]!)
      if (!this.sessionAllowed(sessionId)) { json(res, 404, { error: 'session not found' }); return }
      ;(this.options.stopSession ?? stopAgent)(sessionId)
      json(res, 202, { stopped: true })
      return
    }

    const permissionMatch = path.match(/^\/api\/permissions\/([^/]+)$/)
    if (method === 'POST' && permissionMatch) {
      try {
        const requestId = decodeURIComponent(permissionMatch[1]!)
        const request = permissionService.getPendingRequests().find((candidate) => candidate.requestId === requestId)
        if (!request || !this.sessionAllowed(request.sessionId)) { json(res, 404, { error: 'permission request not found' }); return }
        const body = await readBody(req)
        const behavior = body.behavior === 'allow' || body.behavior === 'deny' ? body.behavior : null
        if (!behavior) { json(res, 400, { error: 'invalid behavior' }); return }
        const sessionId = permissionService.respondToPermission(requestId, behavior, false)
        if (!sessionId) { json(res, 409, { error: 'permission request already resolved' }); return }
        agentEventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'permission_resolved', requestId, behavior } })
        json(res, 200, { resolved: true })
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : 'permission response failed' })
      }
      return
    }

    json(res, 404, { error: 'not found' })
  }

  private async handleAppRequest(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (req.method !== 'GET') { json(res, 405, { error: 'method not allowed' }); return }
    if (!this.authenticate(req, false)) {
      res.writeHead(302, { Location: '/' })
      res.end()
      return
    }
    const root = this.options.rendererDir ?? join(__dirname, 'renderer')
    const relativePath = path === '/app' || path === '/app/' ? 'index.html' : decodeURIComponent(path.slice('/app/'.length))
    const safePath = normalize(relativePath).replace(/^([.][.][/\\])+/, '')
    const filePath = join(root, safePath)
    if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }
    let body = readFileSync(filePath)
    const isHtml = safePath === 'index.html'
    const nonce = randomBytes(16).toString('base64url')
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    if (isHtml) {
      let html = body.toString('utf8')
      html = html.replace(/<script>([\s\S]*?)<\/script>/, `<script nonce="${nonce}">$1</script>`)
      html = html.replace(/<script type="module"/, '<script src="/app/preload.js"></script><script type="module"')
      body = Buffer.from(html)
      headers['Content-Type'] = 'text/html; charset=utf-8'
      headers['Content-Security-Policy'] = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; font-src 'self' data:; base-uri 'none'; frame-ancestors 'none'`
    } else {
      const ext = safePath.split('.').pop()?.toLowerCase()
      headers['Content-Type'] = ({ js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream'
    }
    res.writeHead(200, headers)
    res.end(body)
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/api/stream' && url.pathname !== '/api/ipc') { sendUpgradeError(socket, 404, 'Not Found'); return }
    if (!this.authenticate(req, true)) { sendUpgradeError(socket, 401, 'Unauthorized'); return }
    this.wsServer.handleUpgrade(req, socket, head, (ws: WebSocket) => this.wsServer.emit('connection', ws, req))
  }

  private handleWebSocket(ws: WebSocket, req: IncomingMessage): void {
    const device = this.auth.authenticateToken(parseCookieHeader(req.headers.cookie))
    if (!device) { ws.close(1008, 'unauthorized'); return }
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname === '/api/ipc') {
      if (!this.options.ipcBridge) { ws.close(1013, 'full-ui disabled'); return }
      this.options.ipcBridge.attachWebSocket(ws, device.id)
      return
    }
    const connection = {
      deviceId: device.id,
      get bufferedAmount() { return (ws as unknown as { bufferedAmount: number }).bufferedAmount ?? 0 },
      send: (payload: string) => { if (ws.readyState !== WebSocket.OPEN) return false; (ws as unknown as { send(data: string): void }).send(payload); return true },
      close: (code?: number, reason?: string) => ws.close(code, reason),
    }
    const remove = this.eventHub.addConnection(connection)
    this.connections.set(ws, remove)
    ;(ws as unknown as { send(data: string): void }).send(JSON.stringify({ type: 'ready' }))
    ws.on('message', (raw: Buffer) => {
      try {
        const body = JSON.parse(raw.toString()) as Record<string, unknown>
        if (body.type === 'subscribe' && Array.isArray(body.sessionIds)) {
          const sessionIds = body.sessionIds.filter((id): id is string => typeof id === 'string' && !!this.sessionAllowed(id))
          this.eventHub.subscribe(connection, sessionIds)
        } else {
          connection.send(JSON.stringify({ type: 'error', message: 'unsupported message type' }))
        }
      } catch {
        connection.send(JSON.stringify({ type: 'error', message: 'invalid message' }))
      }
    })
    ws.on('close', () => { remove(); this.connections.delete(ws) })
    ws.on('error', () => { remove(); this.connections.delete(ws) })
  }

  private async sendMessage(sessionId: string, message: string): Promise<'started' | 'injected'> {
    if (this.options.sendMessage) return this.options.sendMessage(sessionId, message)
    const session = getAgentSessionMeta(sessionId)
    if (!session?.channelId) throw new Error('session has no channel')
    if (isAgentSessionActive(sessionId)) {
      await queueAgentMessage({ sessionId, userMessage: message, rawUserMessage: message }, undefined as never)
      return 'injected'
    }
    void runAgentHeadless({
      sessionId,
      userMessage: message,
      rawUserMessage: message,
      channelId: session.channelId,
      modelId: session.modelId,
      workspaceId: session.workspaceId,
      triggeredBy: 'external',
    }, {
      source: 'web-remote',
      onError: (error) => console.error('[Web Remote] Agent 运行失败:', redactSensitiveLogValue(error)),
      onComplete: () => {},
      onTitleUpdated: () => {},
    })
    return 'started'
  }

  private activeSnapshots(): Array<[string, { startedAt: number; runGeneration?: number }]> {
    return listActiveAgentSessionSnapshots().map((snapshot) => [snapshot.sessionId, snapshot] as const)
  }

  private sessionMetas(): Array<{ id: string; title: string; workspaceId?: string; updatedAt: number }> {
    return listAgentSessions()
  }
}
