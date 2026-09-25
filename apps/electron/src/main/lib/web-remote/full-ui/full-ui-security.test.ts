import { describe, expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { getDeclaredWebRemoteChannels, getWebRemoteChannelPolicy, policySummary } from './channel-policy'

const fakeMainWindow = { webContents: { send: () => true } }
mock.module('../../main-window-store', () => ({
  getMainWindow: () => fakeMainWindow,
}))

const { WebRemoteIpcBridge } = await import('./web-remote-ipc')

class FakeWebSocket extends EventEmitter {
  readyState = 1
  sent: string[] = []
  send(payload: string): void { this.sent.push(payload) }
}

function client(bridge: InstanceType<typeof WebRemoteIpcBridge>): FakeWebSocket {
  const ws = new FakeWebSocket()
  bridge.attachWebSocket(ws as never, 'device-1')
  ws.sent = []
  return ws
}

async function invoke(ws: FakeWebSocket, channel: string, args: unknown[] = [], extra: Record<string, unknown> = {}): Promise<any> {
  const before = ws.sent.length
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'invoke', id: `id-${before}`, channel, args, ...extra })))
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    const response = ws.sent.slice(before).map((item) => JSON.parse(item)).find((item) => item.type === 'response')
    if (response) return response
  }
  throw new Error(`没有收到 ${channel} 响应`)
}

describe('Web Remote full-ui security policy', () => {
  const resolvers = {
    getSessionMeta: (id: string) => id === 's-1' ? { workspaceId: 'ws-1' } : id === 's-2' ? { workspaceId: 'ws-2' } : undefined,
    listWorkspaces: () => [{ id: 'ws-1', slug: 'one' }, { id: 'ws-2', slug: 'two' }],
  }

  test('登记通道 100% 有分级，未知通道不在白名单', () => {
    expect(getDeclaredWebRemoteChannels().every((channel) => !!getWebRemoteChannelPolicy(channel))).toBe(true)
    expect(getWebRemoteChannelPolicy('not-registered')).toBeUndefined()
    expect(policySummary().denied).toBeGreaterThan(0)
  })

  test('默认拒绝、denied 通道和 session/workspace 越权均生效', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    bridge.registerInvoke('agent:get-sdk-messages', async () => ['ok'])
    bridge.registerInvoke('agent:get-skills', async () => ['ok'])
    const ws = client(bridge)
    expect((await invoke(ws, 'not-registered')).error.denied).toBe(true)
    expect((await invoke(ws, 'channel:decrypt-key', ['x'])).error.denied).toBe(true)
    expect((await invoke(ws, 'agent:get-sdk-messages', ['s-2'])).error.denied).toBe(true)
    expect((await invoke(ws, 'agent:get-skills', [{ workspaceId: 'ws-2' }])).error.denied).toBe(true)
  })

  test('列表返回按工作区过滤，设置/渠道列表不泄露密钥字段', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    bridge.registerInvoke('agent:list-sessions', async () => [{ id: 's-1', workspaceId: 'ws-1' }, { id: 's-2', workspaceId: 'ws-2' }])
    bridge.registerInvoke('settings:get', async () => ({ theme: 'dark', apiKey: 'secret', nested: { token: 'secret-token', ok: true } }))
    const ws = client(bridge)
    expect((await invoke(ws, 'agent:list-sessions')).value).toEqual([{ id: 's-1', workspaceId: 'ws-1' }])
    const settings = (await invoke(ws, 'settings:get')).value
    expect(settings).toEqual({ theme: 'dark', nested: { ok: true } })
  })

  test('session 事件只发给有权限的设备', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    const ws = client(bridge)
    const mainWindow = (await import('../../main-window-store')).getMainWindow()!
    mainWindow.webContents.send('agent:title-updated', { sessionId: 's-1', title: 'allowed' })
    mainWindow.webContents.send('agent:title-updated', { sessionId: 's-2', title: 'blocked' })
    const events = ws.sent.map((item) => JSON.parse(item)).filter((item) => item.type === 'event')
    expect(events).toHaveLength(1)
    expect(events[0].value.title).toBe('allowed')
  })

  test('confirm 通道首次返回挑战，带一次性 token 才执行', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    let calls = 0
    bridge.registerInvoke('planning:delete-todo', async () => { calls++; return { deleted: true } })
    const ws = client(bridge)
    const first = await invoke(ws, 'planning:delete-todo', [{ id: 'todo-1' }])
    expect(first.error.needsConfirm).toBe(true)
    expect(calls).toBe(0)
    const second = await invoke(ws, 'planning:delete-todo', [{ id: 'todo-1' }], { confirmToken: first.error.token })
    expect(second.ok).toBe(true)
    expect(calls).toBe(1)
    const third = await invoke(ws, 'planning:delete-todo', [{ id: 'todo-1' }], { confirmToken: first.error.token })
    expect(third.error.needsConfirm).toBe(true)
    expect(calls).toBe(1)
  })
})
