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
  getAgentSessionSDKMessages: () => [],
  listAgentSessions: () => [{ id: 's-1', title: '测试', workspaceId: 'ws-1', updatedAt: 1 }],
}))
mock.module('../agent-workspace-manager', () => ({ listAgentWorkspaces: () => [{ id: 'ws-1', name: '测试', slug: 'test', createdAt: 1, updatedAt: 1 }] }))
mock.module('../agent-permission-service', () => ({ permissionService: { getPendingRequests: () => [], respondToPermission: () => null } }))

let WebRemoteServer: typeof import('./web-remote-server').WebRemoteServer
let isWebRemoteEnabled: typeof import('./web-remote-service').isWebRemoteEnabled
let server: InstanceType<typeof WebRemoteServer>
let port: number
let cookie: string

beforeAll(async () => {
  WebRemoteServer = (await import('./web-remote-server')).WebRemoteServer
  isWebRemoteEnabled = (await import('./web-remote-service')).isWebRemoteEnabled
  const config = { enabled: true, allowedOrigin: 'https://proma.example', allowedWorkspaceIds: ['ws-1'] }
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
  test('无令牌 API 返回 401', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions`)
    expect(response.status).toBe(401)
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
    if (old === undefined) delete process.env.PROMA_WEB_REMOTE
    else process.env.PROMA_WEB_REMOTE = old
  })
})
