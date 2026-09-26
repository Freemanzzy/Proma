import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, normalize, resolve } from 'node:path'
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
import { getConfigDirName } from '../config-paths'
import { resolveWebRemoteIconDir } from './web-remote-policy'
import { renderWebRemoteIcon, renderWebRemoteManifest, renderWebRemoteStatic } from './web-remote-static'
import type { WebRemoteIpcBridge } from './full-ui/web-remote-ipc'
import { renderWebRemoteMobilePatch } from './full-ui/mobile-patch'
import { WebRemotePushStore, mapPushNotice, shouldDedupePush, type PushKind } from './web-remote-push'

const MAX_BODY_BYTES = 100_000
const MAX_MESSAGE_CHARS = 50_000
const STATIC_CACHE_MAX_BYTES = 64 * 1024 * 1024
const HASHED_ASSET = /(?:^|[-_.])[a-z0-9]{8,}(?=\.)/i

// 手机主屏 PNG 图标：固定文件名白名单，路径不来自请求，杜绝路径穿越。
const WEB_REMOTE_PNG_ICON_FILES: Readonly<Record<string, string>> = Object.freeze({
  '/apple-touch-icon.png': 'apple-touch-icon.png',
  '/icon-192.png': 'icon-192.png',
  '/icon-512.png': 'icon-512.png',
  '/icon-512-maskable.png': 'icon-512-maskable.png',
})

// /app/ 的 renderer index.html 本身没有 manifest/apple-touch-icon 等 head 标签（只有根配对页 / 有），
// 导致「添加到主屏幕」在 Android/iOS 上读不到 manifest、拿不到新图标。渲染时补齐，与根页保持一致。
const WEB_REMOTE_APP_HEAD_LINKS = '<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Proma"><meta name="theme-color" content="#2563eb">'

type StaticEncoding = 'br' | 'gzip'

interface StaticCacheEntry {
  filePath: string
  mtimeMs: number
  size: number
  etag: string
  lastModified: string
  body: Buffer
  encoded: Map<StaticEncoding, Buffer>
  lastAccessAt: number
}

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
  iconDir?: string
  webPreloadPath?: string
  webPreloadSourcePaths?: string[]
  buildWebPreload?: () => { success: boolean; error?: string }
  pushDataDir?: string
  pushProxyUrl?: string
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

const WEB_REMOTE_SERVICE_WORKER = `self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.pathname.startsWith('/api/')||url.pathname==='/api/stream'||url.pathname==='/api/ipc')return;if(event.request.mode==='navigate')return;});self.addEventListener('push',event=>{let data={title:'Proma',body:'有一条新通知',url:'/app/'};try{data={...data,...event.data.json()}}catch{};event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icon-192.png',badge:'/icon-192.png',tag:data.sessionId+':'+data.kind,data:{url:data.url,sessionId:data.sessionId}}))});self.addEventListener('notificationclick',event=>{event.notification.close();const url=new URL(event.notification.data?.url||'/app/',self.location.origin).href;event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{for(const client of clients){if('focus'in client){client.navigate(url);return client.focus()}}return self.clients.openWindow(url)}))});`

export class WebRemoteServer {
  readonly httpServer: Server
  readonly wsServer: WebSocketServer
  private readonly auth: WebRemoteAuth
  private readonly eventHub: WebRemoteEventHub
  private readonly connections = new Map<WebSocket, () => void>()
  private revokeTimer?: ReturnType<typeof setInterval>
  private listening = false
  private readonly staticCache = new Map<string, StaticCacheEntry>()
  private staticCacheBytes = 0
  private renderedIndexCache?: { filePath: string; mtimeMs: number; size: number; body: Buffer; nonce: string }
  private readonly pushStore: WebRemotePushStore
  private readonly unsubscribePush: () => void
  private readonly failedRuns = new Map<string, number>()

  constructor(private readonly options: WebRemoteServerOptions) {
    this.auth = options.auth
    this.eventHub = options.eventHub ?? new WebRemoteEventHub()
    this.pushStore = new WebRemotePushStore(options.pushDataDir ?? this.auth.getDataDir(), this.auth, (sessionId) => getAgentSessionMeta(sessionId)?.workspaceId, options.pushProxyUrl)
    this.unsubscribePush = agentEventBus.on((sessionId, payload) => { void this.handlePushEvent(sessionId, payload) })
    this.httpServer = createServer((req, res) => { void this.handleHttp(req, res) })
    this.wsServer = new WebSocketServer({ noServer: true })
    this.httpServer.on('upgrade', (req, socket, head) => { void this.handleUpgrade(req, socket, head) })
    this.wsServer.on('connection', (ws: WebSocket, req: IncomingMessage) => this.handleWebSocket(ws, req))
  }

  getConnectedDeviceCount(): number {
    return new Set([...this.connections.keys()].map((ws) => (ws as WebSocket & { webRemoteDeviceId?: string }).webRemoteDeviceId).filter((id): id is string => !!id)).size
  }

  getAuth(): WebRemoteAuth {
    return this.auth
  }

  getEventHub(): WebRemoteEventHub {
    return this.eventHub
  }

  getPushStore(): WebRemotePushStore { return this.pushStore }

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
      for (const deviceId of this.auth.getRevokedDeviceIds()) { this.eventHub.disconnectDevice(deviceId); this.pushStore.remove(deviceId) }
      for (const [ws, remove] of this.connections) {
        const deviceId = (ws as WebSocket & { webRemoteDeviceId?: string }).webRemoteDeviceId
        if (deviceId?.startsWith('tailnet:') && !this.auth.isTrustedTailscaleNode(deviceId.slice('tailnet:'.length))) {
          remove()
          this.connections.delete(ws)
          ws.close(1008, 'trusted device removed')
        }
      }
    }, 1000)
    this.revokeTimer.unref?.()
  }

  async stop(): Promise<void> {
    this.unsubscribePush()
    if (this.revokeTimer) clearInterval(this.revokeTimer)
    this.revokeTimer = undefined
    for (const ws of this.connections.keys()) ws.close(1001, 'server stopping')
    this.connections.clear()
    if (!this.listening) return
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()))
    this.listening = false
  }

  private async authenticate(req: IncomingMessage, requireOrigin: boolean): Promise<AuthenticatedRequest | null> {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
    if (requireOrigin && !this.auth.isAllowedOrigin(origin)) return null
    const tailscaleLogin = typeof req.headers['tailscale-user-login'] === 'string' ? req.headers['tailscale-user-login'] : undefined
    if (!this.auth.isAllowedTailscaleLogin(tailscaleLogin)) return null
    const device = this.auth.authenticateToken(parseCookieHeader(req.headers.cookie))
      ?? await this.auth.authenticateTrustedTailscale(tailscaleLogin, typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : undefined)
    return device ? { deviceId: device.id } : null
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

    // Public, data-free service worker. Its scope is limited to /app/ and it never caches API/WS or authenticated HTML.
    if (method === 'GET' && path === '/app/sw.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/app/', 'X-Content-Type-Options': 'nosniff' })
      res.end(WEB_REMOTE_SERVICE_WORKER)
      return
    }

    if (method === 'GET' && path === '/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(renderWebRemoteManifest())
      return
    }

    if (method === 'GET' && (path === '/icon-192.svg' || path === '/icon-512.svg')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(renderWebRemoteIcon())
      return
    }

    if (method === 'GET' && path === '/icon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(renderWebRemoteIcon())
      return
    }

    if (method === 'GET' && Object.prototype.hasOwnProperty.call(WEB_REMOTE_PNG_ICON_FILES, path)) {
      this.servePngIcon(res, WEB_REMOTE_PNG_ICON_FILES[path]!)
      return
    }

    if (path === '/app' || path.startsWith('/app/')) {
      await this.handleAppRequest(req, res, path)
      return
    }

    if (method === 'GET' && path === '/') {
      const login = typeof req.headers['tailscale-user-login'] === 'string' ? req.headers['tailscale-user-login'] : undefined
      const trusted = await this.auth.authenticateTrustedTailscale(login, typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : undefined)
      if (trusted) { res.writeHead(302, { Location: '/app/' }); res.end(); return }
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
      const pairOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
      const pairLogin = typeof req.headers['tailscale-user-login'] === 'string' ? req.headers['tailscale-user-login'] : undefined
      if (!this.auth.isAllowedOrigin(pairOrigin) || !this.auth.isAllowedTailscaleLogin(pairLogin)) {
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
    const identity = await this.authenticate(req, isWrite)
    if (!identity) {
      json(res, 401, { error: 'unauthorized' })
      return
    }
    if (this.options.config.workspaceScope !== 'all'
      && (!Array.isArray(this.options.config.allowedWorkspaceIds) || this.options.config.allowedWorkspaceIds.length === 0)) {
      json(res, 403, { error: 'no workspaces allowed' })
      return
    }

    if (method === 'GET' && path === '/api/push/key') { json(res, 200, { publicKey: this.pushStore.getPublicKey() }); return }
    if (method === 'GET' && path === '/api/push/subscription') { json(res, 200, { subscribed: this.pushStore.has(identity.deviceId) }); return }
    if (method === 'POST' && path === '/api/push/subscription') {
      try { const body = await readBody(req); this.pushStore.register(identity.deviceId, typeof body.label === 'string' ? body.label : '手机设备', body.subscription); json(res, 201, { subscribed: true }) }
      catch (error) { json(res, 400, { error: error instanceof Error ? error.message : 'invalid subscription' }) }
      return
    }
    if (method === 'DELETE' && path === '/api/push/subscription') { this.pushStore.remove(identity.deviceId); json(res, 200, { subscribed: false }); return }
    if (method === 'POST' && path === '/api/push/presence') {
      try { const body = await readBody(req); const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null; const visible = body.visible === true; if (sessionId && !this.sessionAllowed(sessionId)) { json(res, 404, { error: 'session not found' }); return } this.pushStore.setPresence(identity.deviceId, sessionId, visible); json(res, 204, {}) }
      catch (error) { json(res, 400, { error: error instanceof Error ? error.message : 'invalid presence' }) }
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
    if (!await this.authenticate(req, false)) {
      res.writeHead(302, { Location: '/' })
      res.end()
      return
    }
    const root = this.options.rendererDir ?? join(__dirname, 'renderer')
    const relativePath = path === '/app' || path === '/app/' ? 'index.html' : decodeURIComponent(path.slice('/app/'.length))
    const safePath = normalize(relativePath).replace(/^([.][.][/\\])+/, '')
    const isHtml = safePath === 'index.html'
    if (isHtml) {
      const preload = this.ensureWebPreload(root)
      if (!preload.ready) {
        const reason = preload.error ?? '独立 web preload 产物缺失或过期。'
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        res.end(this.renderPreloadErrorPage(reason))
        return
      }
    }
    const filePath = safePath === 'preload.js' ? this.getWebPreloadPath(root) : join(root, safePath)
    if (!filePath.startsWith(root) && safePath !== 'preload.js' || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }

    const sourceStat = statSync(filePath) as { mtimeMs: number; size: number; mtime: Date }
    const isPreload = safePath === 'preload.js'
    const isHashedAsset = safePath.startsWith('assets/') && HASHED_ASSET.test(safePath.split('/').pop() ?? '')
    const etag = `"${createHash('sha1').update(`${sourceStat.size}:${sourceStat.mtimeMs}`).digest('hex')}"`
    const lastModified = sourceStat.mtime.toUTCString()
    const conditionalMatch = req.headers['if-none-match'] === etag
      || (typeof req.headers['if-modified-since'] === 'string' && req.headers['if-modified-since'] === lastModified)
    const headers: Record<string, string> = {
      'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      ETag: etag,
      'Last-Modified': lastModified,
      Vary: 'Accept-Encoding',
      'X-Content-Type-Options': 'nosniff',
    }
    if (!isHtml && conditionalMatch) {
      res.writeHead(304, headers)
      res.end()
      return
    }

    let body: Buffer = readFileSync(filePath) as Buffer
    let nonce = ''
    if (isHtml) {
      const rendered = this.getRenderedIndex(filePath, sourceStat, body)
      body = rendered.body
      nonce = rendered.nonce
      headers['Content-Type'] = 'text/html; charset=utf-8'
      headers['Content-Security-Policy'] = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; worker-src 'self'; manifest-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; font-src 'self' data:; base-uri 'none'; frame-ancestors 'none'`
    } else {
      const ext = safePath.split('.').pop()?.toLowerCase()
      headers['Content-Type'] = ({ js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream'
    }
    const cached = isHtml ? undefined : this.getStaticCache(filePath, sourceStat, etag, lastModified, body)
    const representation = cached ? this.selectStaticRepresentation(cached, req.headers['accept-encoding']) : this.compressStaticBody(body, req.headers['accept-encoding'])
    if (representation.encoding) headers['Content-Encoding'] = representation.encoding
    headers['Content-Length'] = String(representation.body.byteLength)
    if ((isHtml || isPreload) && conditionalMatch) {
      res.writeHead(304, headers)
      res.end()
      return
    }
    res.writeHead(200, headers)
    res.end(representation.body)
  }

  private async handlePushEvent(sessionId: string, payload: { kind?: string; event?: Record<string, unknown> }): Promise<void> {
    const session = this.sessionAllowed(sessionId)
    if (!session) return
    const event = payload.kind === 'proma_event' ? payload.event : undefined
    if (!event || typeof event.type !== 'string') return
    let kind: PushKind | undefined
    let summary = ''
    if (event.type === 'run_completed') { if ((this.failedRuns.get(sessionId) ?? 0) > Date.now()) { this.failedRuns.delete(sessionId); return }; kind = event.stoppedByUser === true ? undefined : event.source === 'automation' ? 'automation' : 'completed'; summary = event.source === 'automation' ? '定时任务执行结束' : '本轮任务已结束' }
    else if (event.type === 'web_remote_push_error' || (event.type === 'retry' && event.status === 'failed')) { this.failedRuns.set(sessionId, Date.now() + 30_000); kind = 'failed'; summary = 'Agent 执行遇到错误' }
    else if (event.type === 'permission_request') { kind = 'permission'; summary = '需要处理工具权限审批' }
    else if (event.type === 'ask_user_request') { kind = 'question'; summary = 'Agent 正在等待你的回答' }
    else if (event.type === 'exit_plan_mode_request') { kind = 'plan'; summary = 'Agent 正在等待计划审批' }
    else if (event.type === 'task_notification' && (event.status === 'completed' || event.status === 'failed')) { kind = 'automation'; summary = '定时任务执行结束' }
    if (!kind || !shouldDedupePush(sessionId, kind)) return
    const notice = mapPushNotice(sessionId, session.title || '未命名会话', kind, summary)
    const result = await this.pushStore.sendToAll(notice)
    for (const item of result) console.info(`[Web Remote Push] kind=${kind} status=${item.status ?? 'error'}${item.error ? ` detail=${item.error}` : ''}`)
  }

  private latestAssistantSummary(sessionId: string): string {
    try {
      const messages = getAgentSessionSDKMessages(sessionId)
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i] as { type?: string; message?: { content?: unknown }; content?: unknown }
        if (message.type !== 'assistant') continue
        const content = message.message?.content ?? message.content
        if (typeof content === 'string') return content
        if (Array.isArray(content)) return content.filter((block): block is { type: string; text: string } => !!block && typeof block === 'object' && (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string').map((block) => block.text).join(' ')
      }
    } catch {}
    return ''
  }

  private getIconDir(): string {
    return this.options.iconDir ?? resolveWebRemoteIconDir({ packaged: false, resourcesPath: '', moduleDir: __dirname })
  }

  private servePngIcon(res: ServerResponse, filename: string): void {
    const filePath = join(this.getIconDir(), filename)
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('Not Found')
      return
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' })
    res.end(readFileSync(filePath))
  }

  private getWebPreloadPath(rendererRoot: string): string {
    return this.options.webPreloadPath ?? resolve(rendererRoot, '../web-remote/preload.js')
  }

  private ensureWebPreload(rendererRoot: string): { ready: boolean; error?: string } {
    const output = this.getWebPreloadPath(rendererRoot)
    const sources = this.options.webPreloadSourcePaths ?? [
      resolve(__dirname, '../src/preload/index.ts'),
      resolve(__dirname, '../src/main/lib/web-remote/full-ui/web-electron-shim.ts'),
    ]
    if (!sources.every((source) => existsSync(source))) {
      // 安装包（app.asar）内没有源文件，只有构建产物：不存在“开发模式自动重建”的前提，直接看产物是否可用。
      if (existsSync(output) && statSync(output).size > 0) return { ready: true }
      return { ready: false, error: '安装包中缺少 web preload（dist/web-remote/preload.js）；请重新执行 package-personal.sh 打包。' }
    }
    const isCurrent = (): boolean => {
      try {
        const outputTime = statSync(output).mtimeMs
        return outputTime >= Math.max(...sources.map((source) => statSync(source).mtimeMs))
      } catch { return false }
    }
    if (isCurrent()) return { ready: true }
    if (process.env.NODE_ENV === 'production' && getConfigDirName() !== '.proma-dev') return { ready: false, error: '正式构建中的独立 web preload 缺失或早于源文件；请重新执行完整构建。' }

    try {
      const build = this.options.buildWebPreload?.() ?? (() => {
        const script = resolve(__dirname, '../../../scripts/personal/build-web-preload.ts')
        const result = spawnSync('bun', [script], { cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 30_000 })
        return { success: result.status === 0, error: result.error?.message || result.stderr || `退出码 ${result.status ?? '未知'}` }
      })()
      if (build.success && isCurrent()) return { ready: true }
      return { ready: false, error: `开发模式尝试自动重建 web preload 失败。${build.error ? `原因：${String(build.error).trim()}` : ''}` }
    } catch (error) {
      return { ready: false, error: `开发模式尝试自动重建 web preload 时出错：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  private renderPreloadErrorPage(reason: string): string {
    const safeReason = reason.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proma 手机界面暂不可用</title><body style="font:16px system-ui,sans-serif;max-width:680px;margin:12vh auto;padding:24px;color:#172033;background:#f4f6fb"><main style="background:white;border:1px solid #d9dfeb;border-radius:16px;padding:24px"><h1 style="font-size:22px">手机界面暂不可用</h1><p>手机端加载所需的 web preload 文件缺失或过期，页面已阻止继续加载，避免显示空白。</p><p>${safeReason}</p><p>请在项目根目录运行以下命令后刷新页面：</p><pre style="white-space:pre-wrap;background:#eef1f7;padding:12px;border-radius:8px">bun scripts/personal/build-web-preload.ts</pre></main></body></html>`
  }

  private getRenderedIndex(filePath: string, sourceStat: { mtimeMs: number; size: number; mtime: Date }, sourceBody: Buffer): { body: Buffer; nonce: string } {
    const existing = this.renderedIndexCache
    if (existing && existing.filePath === filePath && existing.mtimeMs === sourceStat.mtimeMs && existing.size === sourceStat.size) return existing
    const nonce = randomBytes(16).toString('base64url')
    let html = sourceBody.toString('utf8')
    html = html.replace('</head>', `${WEB_REMOTE_APP_HEAD_LINKS}</head>`)
    html = html.replace(/<script>([\s\S]*?)<\/script>/, `<script nonce="${nonce}">$1</script>`)
    html = html.replace(/<script type="module"/, '<script src="/app/preload.js"></script><script type="module"')
    html = html.replace('</body>', renderWebRemoteMobilePatch().replaceAll('__PROMA_NONCE__', nonce) + '</body>')
    const rendered = { filePath, mtimeMs: sourceStat.mtimeMs, size: sourceStat.size, body: Buffer.from(html), nonce }
    this.renderedIndexCache = rendered
    return rendered
  }

  private getStaticCache(filePath: string, sourceStat: { mtimeMs: number; size: number; mtime: Date }, etag: string, lastModified: string, body: Buffer): StaticCacheEntry {
    const existing = this.staticCache.get(filePath)
    if (existing && existing.mtimeMs === sourceStat.mtimeMs && existing.size === sourceStat.size) {
      existing.lastAccessAt = Date.now()
      return existing
    }
    if (existing) this.removeStaticCache(filePath)
    const entry: StaticCacheEntry = { filePath, mtimeMs: sourceStat.mtimeMs, size: sourceStat.size, etag, lastModified, body, encoded: new Map(), lastAccessAt: Date.now() }
    if (body.byteLength <= STATIC_CACHE_MAX_BYTES) {
      this.staticCache.set(filePath, entry)
      this.staticCacheBytes += body.byteLength
      this.evictStaticCache()
    }
    return entry
  }

  private removeStaticCache(filePath: string): void {
    const entry = this.staticCache.get(filePath)
    if (!entry) return
    this.staticCache.delete(filePath)
    this.staticCacheBytes -= entry.body.byteLength + [...entry.encoded.values()].reduce((sum, item) => sum + item.byteLength, 0)
  }

  private evictStaticCache(): void {
    while (this.staticCacheBytes > STATIC_CACHE_MAX_BYTES && this.staticCache.size > 0) {
      const oldest = [...this.staticCache.values()].sort((a, b) => a.lastAccessAt - b.lastAccessAt)[0]
      if (!oldest) break
      this.removeStaticCache(oldest.filePath)
    }
  }

  private compressStaticBody(body: Buffer, acceptEncoding: string | undefined): { body: Buffer; encoding?: StaticEncoding } {
    if (acceptEncoding?.includes('br')) {
      const encoded = brotliCompressSync(body)
      if (encoded.byteLength < body.byteLength) return { body: encoded, encoding: 'br' }
    }
    if (acceptEncoding?.includes('gzip')) {
      const encoded = gzipSync(body)
      if (encoded.byteLength < body.byteLength) return { body: encoded, encoding: 'gzip' }
    }
    return { body }
  }

  private selectStaticRepresentation(entry: StaticCacheEntry, acceptEncoding: string | undefined): { body: Buffer; encoding?: StaticEncoding } {
    const encoding: StaticEncoding | undefined = acceptEncoding?.includes('br') ? 'br' : acceptEncoding?.includes('gzip') ? 'gzip' : undefined
    if (!encoding) return { body: entry.body }
    let encoded = entry.encoded.get(encoding)
    if (!encoded) {
      encoded = encoding === 'br' ? brotliCompressSync(entry.body) : gzipSync(entry.body)
      if (encoded.byteLength >= entry.body.byteLength) return { body: entry.body }
      entry.encoded.set(encoding, encoded)
      this.staticCacheBytes += encoded.byteLength
      this.evictStaticCache()
      if (!this.staticCache.has(entry.filePath)) return { body: encoded, encoding }
    }
    entry.lastAccessAt = Date.now()
    return { body: encoded, encoding }
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/api/stream' && url.pathname !== '/api/ipc') { sendUpgradeError(socket, 404, 'Not Found'); return }
    if (!await this.authenticate(req, true)) { sendUpgradeError(socket, 401, 'Unauthorized'); return }
    this.wsServer.handleUpgrade(req, socket, head, (ws: WebSocket) => this.wsServer.emit('connection', ws, req))
  }

  private async handleWebSocket(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const auth = await this.authenticate(req, true)
    if (!auth) { ws.close(1008, 'unauthorized'); return }
    const device = { id: auth.deviceId }
    ;(ws as WebSocket & { webRemoteDeviceId?: string }).webRemoteDeviceId = device.id
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname === '/api/ipc') {
      if (!this.options.ipcBridge) { ws.close(1013, 'full-ui disabled'); return }
      this.connections.set(ws, () => {})
      ws.once('close', () => this.connections.delete(ws))
      ws.once('error', () => this.connections.delete(ws))
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
