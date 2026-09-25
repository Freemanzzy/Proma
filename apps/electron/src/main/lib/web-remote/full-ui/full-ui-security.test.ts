import { describe, expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDeclaredWebRemoteChannels, getWebRemoteChannelPolicy, policySummary, WEB_REMOTE_CHANNEL_POLICY } from './channel-policy'

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
  test('显式表覆盖登记表/导出常量，runtime file 通道也已登记', () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    const runtimeChannels = ['file:exists-batch', 'file:office-to-html', 'file:prepare-pdf-preview', 'file:read-binary-base64', 'file:resolve-and-read', 'file:resolve-html-preview-path', 'file:resolve-markdown-media', 'file:resolve-path', 'file:write-text', 'migration:open-data-folder']
    for (const channel of runtimeChannels) bridge.registerInvoke(channel, async () => null)
    expect(bridge.getUnclassifiedRegisteredChannels()).toEqual([])
    expect(Object.keys(WEB_REMOTE_CHANNEL_POLICY).every((channel) => getDeclaredWebRemoteChannels().includes(channel))).toBe(true)
    bridge.registerInvoke('future:unreviewed', async () => null)
    expect(bridge.getUnclassifiedRegisteredChannels()).toEqual(['future:unreviewed'])
  })

  test('file 通道必须位于 realpath 后的允许根，MCP env/headers 只保留键名', async () => {
    const root = mkdtempSync(join(tmpdir(), 'web-remote-file-root-'))
    const file = join(root, 'note.md')
    writeFileSync(file, '# ok')
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, { ...resolvers, getPathRoots: () => [{ path: root }] })
    bridge.registerInvoke('file:resolve-and-read', async () => ({ ok: true }))
    bridge.registerInvoke('agent:get-mcp-config', async () => ({ env: { TOKEN: 'super-secret' }, headers: { Authorization: 'Bearer super-secret' }, name: 'demo' }))
    const ws = client(bridge)
    expect((await invoke(ws, 'file:resolve-and-read', [file])).ok).toBe(true)
    expect((await invoke(ws, 'file:resolve-and-read', ['/tmp/outside-secret.md'])).error.denied).toBe(true)
    expect((await invoke(ws, 'agent:get-mcp-config', [{ workspaceId: 'ws-1' }])).value).toEqual({ env: { TOKEN: '[REDACTED]' }, headers: { Authorization: '[REDACTED]' }, name: 'demo' })
  })

  test('planning write 级无需确认，删除仍需确认，denied workspace-window 通道始终拒绝', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    bridge.registerInvoke('planning:create-todo', async () => ({ id: 'todo' }))
    bridge.registerInvoke('planning:delete-todo', async () => ({ deleted: true }))
    const ws = client(bridge)
    expect((await invoke(ws, 'planning:create-todo', [{ title: 'harness-confirm-test' }])).ok).toBe(true)
    expect((await invoke(ws, 'planning:delete-todo', [{ id: 'todo' }])).error.needsConfirm).toBe(true)
    expect((await invoke(ws, 'agent:open-workspace-memory-window', [{ workspaceId: 'ws-1' }])).error.denied).toBe(true)
  })

})
