import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { connect } from 'node:net'
import { mkdtempSync } from 'node:fs'
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

beforeAll(async () => {
  WebRemoteServer = (await import('./web-remote-server')).WebRemoteServer
  isWebRemoteEnabled = (await import('./web-remote-service')).isWebRemoteEnabled
  isWebRemoteConfigDirAllowed = (await import('./web-remote-service')).isWebRemoteConfigDirAllowed
  const config = { enabled: true, allowedOrigin: 'https://proma.example', allowedWorkspaceIds: ['ws-1'], allowedTailscaleLogins: ['lee@example.com'] }
  const auth = new WebRemoteAuth(config, mkdtempSync(join(tmpdir(), 'proma-web-remote-server-')))
  const code = auth.createPairingCode().code
  const paired = auth.pair(code, 'test')!
  cookie = `proma_web_remote=${paired.token}`
  server = new WebRemoteServer({ config, auth })
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
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(html).not.toContain('onclick=')
    expect(html).not.toContain('confirm(')
    expect(html).toContain('allowedRoles')
    expect(html).toContain('run_completed')
    expect(html).toContain('visibilitychange')
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
