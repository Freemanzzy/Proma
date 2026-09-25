import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { connect } from 'node:net'
import WebSocket from 'ws'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebRemoteAuth } from './web-remote-auth'

const eventBus = { on: () => () => {}, emit: () => {} }
mock.module('../agent-service', () => ({
  agentEventBus: eventBus,
  isAgentSessionActive: () => false,
  listActiveAgentSessionSnapshots: () => [],
  queueAgentMessage: async () => {},
  runAgentHeadless: async () => {},
  stopAgent: () => {},
}))
mock.module('../agent-session-manager', () => ({
  getAgentSessionMeta: () => ({ id: 's-1', title: '测试', workspaceId: 'ws-1', updatedAt: 1, channelId: 'c-1' }),
  getAgentSessionSDKMessages: () => Array.from({ length: 1_200 }, (_, index) => ({ type: 'user', uuid: String(index), content: `message-${index}` })),
  listAgentSessions: () => [{ id: 's-1', title: '测试', workspaceId: 'ws-1', updatedAt: 1 }],
}))
mock.module('../agent-workspace-manager', () => ({ listAgentWorkspaces: () => [{ id: 'ws-1', name: '测试', slug: 'test', createdAt: 1, updatedAt: 1 }] }))
mock.module('../agent-permission-service', () => ({ permissionService: { getPendingRequests: () => [], respondToPermission: () => null } }))

let WebRemoteServer: typeof import('./web-remote-server').WebRemoteServer
let isWebRemoteEnabled: typeof import('./web-remote-service').isWebRemoteEnabled
let isWebRemoteConfigDirAllowed: typeof import('./web-remote-service').isWebRemoteConfigDirAllowed
let server: InstanceType<typeof WebRemoteServer>
let port: number
let cookie: string
let rendererDir: string

beforeAll(async () => {
  WebRemoteServer = (await import('./web-remote-server')).WebRemoteServer
  isWebRemoteEnabled = (await import('./web-remote-service')).isWebRemoteEnabled
  isWebRemoteConfigDirAllowed = (await import('./web-remote-service')).isWebRemoteConfigDirAllowed
  const config = { enabled: true, allowedOrigin: 'https://proma.example', allowedWorkspaceIds: ['ws-1'], allowedTailscaleLogins: ['lee@example.com'], trustedTailscaleNodes: ['trusted-phone'] }
  const auth = new WebRemoteAuth(config, mkdtempSync(join(tmpdir(), 'proma-web-remote-server-')), async () => ({ Node: { ComputedName: 'trusted-phone' }, UserProfile: { LoginName: 'lee@example.com' } }))
  const code = auth.createPairingCode().code
  const paired = auth.pair(code, 'test')!
  cookie = `proma_web_remote=${paired.token}`
  rendererDir = mkdtempSync(join(tmpdir(), 'proma-web-remote-renderer-'))
  mkdirSync(join(rendererDir, 'assets'))
  writeFileSync(join(rendererDir, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="./assets/main-12345678.js"></script></body></html>')
  writeFileSync(join(rendererDir, 'preload.js'), 'window.__PRELOAD__=true;'.repeat(200))
  writeFileSync(join(rendererDir, 'assets', 'main-12345678.js'), 'console.log("cached");'.repeat(200))
  server = new WebRemoteServer({ config, auth, rendererDir, ipcBridge: { attachWebSocket: (ws: WebSocket) => ws.send(Buffer.from(JSON.stringify({ type: 'ready' }))) } as never })
  await server.start(0)
  port = (server.httpServer.address() as { port: number }).port
})

afterAll(async () => { await server.stop() })

describe('WebRemoteServer loopback integration', () => {
  test('根页面返回随机 nonce 一致的 CSP 与安全头，且无内联事件属性', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/`)
    const html = await response.text()
    const csp = response.headers.get('content-security-policy') || ''
    const styleNonce = html.match(/<style nonce="([^"]+)"/)?.[1]
    const scriptNonce = html.match(/<script nonce="([^"]+)"/)?.[1]
    expect(styleNonce).toBeString()
    expect(scriptNonce).toBe(styleNonce)
    expect(csp).toContain(`script-src 'nonce-${scriptNonce}'`)
    expect(csp).toContain(`style-src 'nonce-${scriptNonce}'`)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain('wss://proma.example')
    expect(csp).toContain("manifest-src 'self'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(html).not.toContain('onclick=')
    expect(html).not.toContain('confirm(')
    expect(html).toContain('allowedRoles')
    expect(html).toContain('run_completed')
    expect(html).toContain('visibilitychange')
    const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)?.[1]
    expect(script).toBeString()
    expect(() => new Function(script!)).not.toThrow()
  })

  test('WS ready 使用文本帧而非二进制帧', async () => {
    const received = await new Promise<{ text: string; isBinary: boolean }>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/api/stream`, { headers: { Cookie: cookie, Origin: 'https://proma.example', 'Tailscale-User-Login': 'lee@example.com' } })
      const timer = setTimeout(() => { client.close(); reject(new Error('WS ready 超时')) }, 2_000)
      client.once('message', (data: Buffer, isBinary: boolean) => { clearTimeout(timer); resolve({ text: data.toString(), isBinary }); client.close() })
      client.once('error', reject)
    })
    expect(received.isBinary).toBe(false)
    expect(JSON.parse(received.text).type).toBe('ready')
  })

  test('受信 Tailnet 设备的 WS 升级与连接后再次鉴权均通过', async () => {
    const received = await new Promise<{ text: string; isBinary: boolean }>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/api/stream`, { headers: { Origin: 'https://proma.example', 'Tailscale-User-Login': 'lee@example.com', 'X-Forwarded-For': '100.90.1.2, 100.90.1.1' } })
      const timer = setTimeout(() => { client.close(); reject(new Error('受信设备 WS ready 超时')) }, 2_000)
      client.once('message', (data: Buffer, isBinary: boolean) => { clearTimeout(timer); resolve({ text: data.toString(), isBinary }); client.close() })
      client.once('error', reject)
    })
    expect(received.isBinary).toBe(false)
    expect(JSON.parse(received.text).type).toBe('ready')
  })

  test('受信 Tailnet 设备的 /api/ipc WebSocket 升级通过', async () => {
    const received = await new Promise<string>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/api/ipc`, { headers: { Origin: 'https://proma.example', 'Tailscale-User-Login': 'lee@example.com', 'X-Forwarded-For': '100.90.1.2' } })
      const timer = setTimeout(() => { client.close(); reject(new Error('受信设备 IPC WS ready 超时')) }, 2_000)
      client.once('message', (data: Buffer) => { clearTimeout(timer); resolve(data.toString()); client.close() })
      client.once('error', reject)
    })
    expect(JSON.parse(received).type).toBe('ready')
  })

  test('受信 Tailnet 设备的 API 与 /app/ 静态资源均通过，根页跳转到 /app/', async () => {
    const headers = { 'Tailscale-User-Login': 'lee@example.com', 'X-Forwarded-For': '100.90.1.2' }
    const api = await fetch(`http://127.0.0.1:${port}/api/sessions`, { headers })
    expect(api.status).toBe(200)
    const app = await fetch(`http://127.0.0.1:${port}/app/`, { headers })
    expect(app.status).toBe(200)
    const response = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', headers })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/app/')
  })

  test('完整界面静态资源提供压缩、长缓存和协商缓存', async () => {
    const headers = { Cookie: cookie, 'Tailscale-User-Login': 'lee@example.com' }
    const asset = await fetch(`http://127.0.0.1:${port}/app/assets/main-12345678.js`, { headers: { ...headers, 'Accept-Encoding': 'br' } })
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(asset.headers.get('content-encoding')).toBe('br')
    expect(asset.headers.get('etag')).toBeString()
    expect(asset.headers.get('last-modified')).toBeString()
    const cached = await fetch(`http://127.0.0.1:${port}/app/assets/main-12345678.js`, { headers: { ...headers, 'If-None-Match': asset.headers.get('etag')! } })
    expect(cached.status).toBe(304)
    const index = await fetch(`http://127.0.0.1:${port}/app/`, { headers })
    expect(index.status).toBe(200)
    expect(index.headers.get('cache-control')).toBe('no-cache')
    expect(index.headers.get('etag')).toBeString()
    expect(index.headers.get('last-modified')).toBeString()
    const preload = await fetch(`http://127.0.0.1:${port}/app/preload.js`, { headers: { ...headers, 'Accept-Encoding': 'gzip' } })
    expect(preload.status).toBe(200)
    expect(preload.headers.get('cache-control')).toBe('no-cache')
    expect(preload.headers.get('content-encoding')).toBe('gzip')
  })

  test('manifest 与图标路由无需登录且不泄露会话数据', async () => {
    const manifest = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`)
    expect(manifest.status).toBe(200)
    expect((await manifest.json()).name).toBe('Proma 远程')
    const icon = await fetch(`http://127.0.0.1:${port}/icon.svg`)
    expect(icon.status).toBe(200)
    expect(await icon.text()).toContain('<svg')
  })

  test('无令牌 API 返回 401', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions`)
    expect(response.status).toBe(401)
  })

  test('历史消息默认最后 200 条，limit 可限制到 1–1000', async () => {
    const headers = { Cookie: cookie, 'Tailscale-User-Login': 'lee@example.com' }
    const defaultResponse = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/messages`, { headers })
    expect((await defaultResponse.json()).length).toBe(200)
    const limitedResponse = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/messages?limit=3`, { headers })
    const messages = await limitedResponse.json()
    expect(messages.length).toBe(3)
    expect(messages[0].id).toBe('1197')
  })

  test('Tailscale-User-Login 使用无 X 前缀且身份不匹配时拒绝', async () => {
    const accepted = await fetch(`http://127.0.0.1:${port}/api/sessions`, { headers: { Cookie: cookie, 'Tailscale-User-Login': 'lee@example.com' } })
    expect(accepted.status).toBe(200)
    const rejected = await fetch(`http://127.0.0.1:${port}/api/sessions`, { headers: { Cookie: cookie, 'X-Tailscale-User-Login': 'lee@example.com' } })
    expect(rejected.status).toBe(401)
  })

  test('错误 Origin 的 WebSocket 握手被拒绝', async () => {
    const response = await new Promise<string>((resolve) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write([
          'GET /api/stream HTTP/1.1',
          'Host: 127.0.0.1',
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          'Origin: https://evil.example',
          `Cookie: ${cookie}`,
          '', '',
        ].join('\r\n'))
      })
      socket.once('data', (data) => { resolve(data.toString()); socket.destroy() })
    })
    expect(response).toContain('401')
  })

  test('从配置撤销 Tailnet 节点后数秒内关闭既有 WebSocket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-remote-revoke-'))
    const config = { allowedOrigin: 'https://proma.example', allowedTailscaleLogins: ['lee@example.com'], trustedTailscaleNodes: ['trusted-phone'] }
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config))
    const revokeAuth = new WebRemoteAuth(config, dir, async () => ({ Node: { ComputedName: 'trusted-phone' }, UserProfile: { LoginName: 'lee@example.com' } }))
    const revokeServer = new WebRemoteServer({ config, auth: revokeAuth })
    await revokeServer.start(0)
    const revokePort = (revokeServer.httpServer.address() as { port: number }).port
    try {
      const client = new WebSocket(`ws://127.0.0.1:${revokePort}/api/stream`, { headers: { Origin: 'https://proma.example', 'Tailscale-User-Login': 'lee@example.com', 'X-Forwarded-For': '100.90.1.2' } })
      await new Promise<void>((resolve, reject) => { client.once('message', () => resolve()); client.once('error', reject) })
      writeFileSync(join(dir, 'config.json'), JSON.stringify({ ...config, trustedTailscaleNodes: [] }))
      const closed = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => { client.terminate(); reject(new Error('撤销后 WS 未及时关闭')) }, 3_000)
        client.once('close', (code) => { clearTimeout(timer); resolve(code) })
      })
      expect(closed).toBe(1008)
    } finally {
      await revokeServer.stop()
    }
  })

  test('配置关闭时不满足启动条件', () => {
    const old = process.env.PROMA_WEB_REMOTE
    delete process.env.PROMA_WEB_REMOTE
    expect(isWebRemoteEnabled({ enabled: true })).toBe(false)
    expect(isWebRemoteEnabled({ enabled: false })).toBe(false)
    expect(isWebRemoteConfigDirAllowed('.proma')).toBe(false)
    expect(isWebRemoteConfigDirAllowed('.proma', true)).toBe(true)
    expect(isWebRemoteConfigDirAllowed('.proma-dev')).toBe(true)
    if (old === undefined) delete process.env.PROMA_WEB_REMOTE
    else process.env.PROMA_WEB_REMOTE = old
  })
})
