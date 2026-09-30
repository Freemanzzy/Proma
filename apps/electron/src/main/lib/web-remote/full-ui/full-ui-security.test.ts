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

const { WebRemoteIpcBridge, getWebRemoteMetricsSnapshot, slimWebRemoteSessionMeta, splitUtf8BufferAtBoundaries } = await import('./web-remote-ipc')

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
  test('UTF-8 text chunk boundaries preserve CJK and emoji without replacement', () => {
    const source = '边界中文🙂🚀'.repeat(50_000)
    const chunks = splitUtf8BufferAtBoundaries(Buffer.from(source, 'utf8'), 180 * 1024)
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const parts = chunks.map((chunk) => decoder.decode(chunk))
    const frames = parts.map((data, seq) => JSON.stringify({ type: 'chunk', seq, total: parts.length, data }))
    expect(parts.length).toBeGreaterThan(1)
    expect(frames.map((frame) => JSON.parse(frame).data).join('')).toBe(source)
    expect(chunks.every((chunk) => chunk.byteLength <= 180 * 1024)).toBe(true)
  })
  const resolvers = {
    getSessionMeta: (id: string) => id === 's-1' ? { workspaceId: 'ws-1' } : id === 's-2' ? { workspaceId: 'ws-2' } : undefined,
    listWorkspaces: () => [{ id: 'ws-1', slug: 'one' }, { id: 'ws-2', slug: 'two' }],
  }

  test('ping 帧立即返回 pong，不经过通道分级', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    const ws = client(bridge)
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'ping', id: 'ping-1' })))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(ws.sent.map((item) => JSON.parse(item))).toContainEqual({ type: 'pong', id: 'ping-1' })
  })

  test('登记通道 100% 有分级，未知通道不在白名单', () => {
    expect(getDeclaredWebRemoteChannels().every((channel) => !!getWebRemoteChannelPolicy(channel))).toBe(true)
    expect(getWebRemoteChannelPolicy('not-registered')).toBeUndefined()
    expect(policySummary().denied).toBeGreaterThan(0)
  })

  test('新建会话仅允许指定授权工作区，不要求不存在的 sessionId', async () => {
    expect(getWebRemoteChannelPolicy('agent:create-session')).toMatchObject({ level: 'session', scope: 'workspace' })
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    bridge.registerInvoke('agent:create-session', async (_event, _title, _channelId, workspaceId) => ({ id: 'new-session', workspaceId }))
    const ws = client(bridge)
    expect((await invoke(ws, 'agent:create-session', ['web-remote-harness', undefined, 'ws-1'])).value.workspaceId).toBe('ws-1')
    expect((await invoke(ws, 'agent:create-session', ['web-remote-harness', undefined, 'ws-2'])).error.denied).toBe(true)
    expect((await invoke(ws, 'agent:create-session', ['web-remote-harness'])).error.denied).toBe(true)
  })

  test('AskUser/ExitPlan 响应按 requestId 解析 session 范围，pending 快照按工作区过滤', async () => {
    expect(getWebRemoteChannelPolicy('agent:ask-user:respond')?.scope).toBe('session')
    expect(getWebRemoteChannelPolicy('agent:exit-plan-mode:respond')?.scope).toBe('session')
    expect(getWebRemoteChannelPolicy('agent:get-pending-requests')?.level).toBe('read')
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, {
      ...resolvers,
      getInteractionSessionId: (requestId) => requestId === 'ask-1' ? 's-1' : requestId === 'plan-2' ? 's-2' : undefined,
    })
    bridge.registerInvoke('agent:ask-user:respond', async () => ({ answered: true }))
    bridge.registerInvoke('agent:exit-plan-mode:respond', async () => ({ approved: true }))
    bridge.registerInvoke('agent:get-pending-requests', async () => ({
      permissions: [{ requestId: 'p-1', sessionId: 's-1' }, { requestId: 'p-2', sessionId: 's-2' }],
      askUsers: [{ requestId: 'ask-1', sessionId: 's-1' }, { requestId: 'ask-2', sessionId: 's-2' }],
      exitPlans: [{ requestId: 'plan-1', sessionId: 's-1' }, { requestId: 'plan-2', sessionId: 's-2' }],
    }))
    const ws = client(bridge)
    expect((await invoke(ws, 'agent:ask-user:respond', [{ requestId: 'ask-1' }])).ok).toBe(true)
    expect((await invoke(ws, 'agent:exit-plan-mode:respond', [{ requestId: 'plan-2' }])).error.denied).toBe(true)
    const pending = (await invoke(ws, 'agent:get-pending-requests')).value
    expect(pending.permissions).toHaveLength(1)
    expect(pending.askUsers).toHaveLength(1)
    expect(pending.exitPlans).toHaveLength(1)
    expect(pending.exitPlans[0].sessionId).toBe('s-1')
  })

  test('手机访问桌面管理 IPC 全部显式分级为 denied', () => {
    for (const channel of ['web-remote:admin-get', 'web-remote:admin-save', 'web-remote:admin-pair', 'web-remote:admin-revoke', 'web-remote:admin-push-test', 'web-remote:admin-push-delete']) {
      expect(getWebRemoteChannelPolicy(channel)).toMatchObject({ level: 'denied', scope: 'none' })
    }
  })

  test('历史媒体只读通道显式为 session scope 并拒绝未授权会话', async () => {
    expect(getWebRemoteChannelPolicy('web-remote:get-history-media')).toMatchObject({ level: 'read', scope: 'session' })
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    bridge.registerInvoke('web-remote:get-history-media', async (_event, input) => ({ text: (input as { sessionId: string }).sessionId }))
    const ws = client(bridge)
    expect((await invoke(ws, 'web-remote:get-history-media', [{ sessionId: 's-1' }])).value.text).toBe('s-1')
    expect((await invoke(ws, 'web-remote:get-history-media', [{ sessionId: 's-2' }])).error.denied).toBe(true)
    expect((await invoke(ws, 'web-remote:get-history-media', [{ sessionId: 'missing' }])).error.denied).toBe(true)
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

  test('大 IPC 响应切成有限大小 UTF-8 分块，序号可完整重组', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    bridge.registerInvoke('agent:get-sdk-messages', async () => Array.from({ length: 40 }, (_, index) => ({ type: index % 2 === 0 ? 'user' : 'assistant', text: '块界🎐'.repeat(1_000) })))
    const ws = client(bridge)
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'invoke', id: 'chunked', channel: 'agent:get-sdk-messages', args: ['s-1'] })))
    for (let i = 0; i < 100 && !ws.sent.some((frame) => JSON.parse(frame).type === 'chunk'); i++) await new Promise((resolve) => setTimeout(resolve, 2))
    const chunks = ws.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === 'chunk').sort((a, b) => a.seq - b.seq)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((frame) => frame.total === chunks.length && frame.requestId === 'chunked')).toBe(true)
    const assembled = chunks.map((frame) => frame.data).join('')
    const response = JSON.parse(assembled)
    expect(response.type).toBe('response')
    expect(response.ok).toBe(true)
    expect(response.value.messages).toHaveLength(40)
    expect(chunks.every((frame) => Buffer.byteLength(JSON.stringify(frame)) < 256 * 1024)).toBe(true)
  })

  test('SDK 历史仅对 Web Remote 返回尾部完整轮次窗口并按 session 授权', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    bridge.registerInvoke('agent:get-sdk-messages', async () => [
      { type: 'user', content: 'one' },
      { type: 'assistant', content: 'answer one' },
      { type: 'user', content: 'two' },
      { type: 'assistant', content: 'answer two' },
    ])
    const ws = client(bridge)
    const response = await invoke(ws, 'agent:get-sdk-messages', ['s-1', { budgetBytes: 1 }])
    expect(response.ok).toBe(true)
    expect(response.value.__webRemoteHistoryWindow).toBe(true)
    expect(response.value.messages.map((message: { type: string }) => message.type)).toEqual(['user', 'assistant'])
    expect(response.value.hasEarlier).toBe(true)
    expect((await invoke(ws, 'agent:get-sdk-messages', ['s-2'])).error.denied).toBe(true)
  })

  test('手机会话 meta 剔除运行时大字段，Pi 回复节点映射改为按需读取', () => {
    const synthetic = Array.from({ length: 925 }, (_, index) => {
      const bindingIndex = index < 350 ? 19 : index < 385 ? 240 : index === 385 ? 2_372 : index < 698 ? 100 : 132
      return {
        id: `${String(index).padStart(4, '0')}-${'i'.repeat(32)}`,
        title: `Synthetic session ${String(index).padStart(4, '0')}`,
        workspaceId: 'workspace-synthetic-00000000000000000001',
        channelId: 'channel-synthetic-000000000000000000001',
        modelId: 'claude-sonnet-4-5',
        createdAt: 1_790_000_000_000 + index,
        updatedAt: 1_790_000_000_000 + index,
        ...(index < 633 ? { sourceAutomationId: `automation-${String(index).padStart(4, '0')}-${'a'.repeat(24)}` } : {}),
        ...(index < 194 ? { parentSessionId: `parent-${'p'.repeat(29)}`, rootSessionId: `root-${'r'.repeat(31)}`, sourceDelegationId: `delegation-${'d'.repeat(25)}`, delegationGoal: 'synthetic goal '.padEnd(1_020, 'g'), delegationStatus: 'completed', delegationRole: 'explore', delegationDepth: 1 } : {}),
        ...(index < 915 ? { stoppedByUser: false } : {}),
        ...(index < 793 ? { archived: false } : {}),
        ...(index < 586 ? { agentCwdMode: 'workspace', reasoningLevel: 'high' } : {}),
        ...(index < 498 ? { sessionWorkbenchLayout: 'split' } : {}),
        ...(index < 287 ? { completedButUnconfirmed: false } : {}),
        ...(index < 197 ? { legacyTranscript: { imported: true } } : {}),
        ...(index < 152 ? { automationGraduated: false } : {}),
        ...(index < 117 ? { openAIThinkingLevel: 'high' } : {}),
        ...(index < 95 ? { isDraft: false } : {}),
        ...(index < 33 ? { starred: false } : {}),
        ...(index < 28 ? { pinned: false } : {}),
        ...(index < 14 ? { explorationParentSessionId: `explore-${'e'.repeat(28)}`, explorationSourceMessageId: `message-${'m'.repeat(28)}`, explorationSourceLabel: 'synthetic label' } : {}),
        ...(index < 15 ? { forkSourceDir: `/synthetic/${'f'.repeat(70)}` } : {}),
        ...(index < 4 ? { attachedDirectories: ['/synthetic/dir'] } : {}),
        ...(index < 194 ? { permissionMode: 'bypassPermissions' } : {}),
        ...(index < 700 ? { piSessionFile: `/synthetic/${'p'.repeat(102)}` } : {}),
        ...(index < 699 ? { piEntryBindings: Object.fromEntries(Array.from({ length: bindingIndex }, (_, key) => [`${String(index).padStart(4, '0')}-${String(key).padStart(4, '0')}-${'k'.repeat(28)}`, 'entry-id'])) } : {}),
      }
    })
    const slim = slimWebRemoteSessionMeta(synthetic) as Array<Record<string, unknown>>
    const before = Buffer.byteLength(JSON.stringify(synthetic))
    const oldStyleSlim = synthetic.map((row): Record<string, unknown> => {
      const copy: Record<string, unknown> = { ...row }
      delete copy.delegationGoal
      delete copy.piSessionFile
      const bindings = copy.piEntryBindings
      if (bindings && typeof bindings === 'object') copy.piEntryBindings = Object.fromEntries(Object.keys(bindings).map((key) => [key, true]))
      return copy
    })
    const oldStyleBytes = Buffer.byteLength(JSON.stringify(oldStyleSlim))
    const after = Buffer.byteLength(JSON.stringify(slim))
    expect(synthetic).toHaveLength(925)
    expect(before).toBeGreaterThan(3_000_000)
    expect(oldStyleBytes).toBeGreaterThan(2_400_000)
    expect(after).toBeGreaterThan(200_000)
    expect(after).toBeLessThan(600_000)
    expect(slim[0]).not.toHaveProperty('delegationGoal')
    expect(slim[0]).not.toHaveProperty('piSessionFile')
    expect(slim[0]).not.toHaveProperty('piEntryBindings')
  })

  test('IPC metrics aggregate response bytes/count without retaining payload content', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    bridge.registerInvoke('agent:list-sessions', async () => [{ id: 's-1', workspaceId: 'ws-1', delegationGoal: 'private text', piSessionFile: '/private/path', piEntryBindings: { 'message-1': 'entry-value' } }])
    const ws = client(bridge)
    const response = await invoke(ws, 'agent:list-sessions')
    expect(response.value[0]).not.toHaveProperty('delegationGoal')
    expect(response.value[0]).not.toHaveProperty('piSessionFile')
    expect(response.value[0]).not.toHaveProperty('piEntryBindings')
    const metric = getWebRemoteMetricsSnapshot().devices['device-1']?.byChannel['agent:list-sessions']
    expect(metric).toMatchObject({ calls: 1 })
    expect(metric?.responseUtf8Bytes).toBeGreaterThan(0)
    expect(metric?.appSentBytes).toBeGreaterThan(0)
    expect(metric?.estimatedDeflateRawBytes).toBeGreaterThan(0)
    expect(JSON.stringify(getWebRemoteMetricsSnapshot())).not.toContain('private text')
  })

  test('活动与归档会话列表使用与全列表相同的按需元数据瘦身', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    const rows = [{ id: 's-1', workspaceId: 'ws-1', piEntryBindings: { 'reply-1': 'entry' }, delegationGoal: 'private', piSessionFile: '/private/session' }]
    bridge.registerInvoke('agent:list-active-sessions', async () => rows)
    bridge.registerInvoke('agent:list-archived-sessions', async () => rows)
    const ws = client(bridge)
    for (const channel of ['agent:list-active-sessions', 'agent:list-archived-sessions']) {
      const result = await invoke(ws, channel)
      expect(result.value[0]).not.toHaveProperty('piEntryBindings')
      expect(result.value[0]).not.toHaveProperty('delegationGoal')
      expect(result.value[0]).not.toHaveProperty('piSessionFile')
    }
  })

  test('按需 Pi 节点查询受 session 工作区授权保护', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    bridge.registerInvoke('web-remote:get-session-entry-bindings', async (_event, input) => {
      const sessionId = (input as { sessionId: string }).sessionId
      return { 'reply-1': sessionId === 's-1' }
    })
    const ws = client(bridge)
    expect((await invoke(ws, 'web-remote:get-session-entry-bindings', [{ sessionId: 's-1' }])).value).toEqual({ 'reply-1': true })
    expect((await invoke(ws, 'web-remote:get-session-entry-bindings', [{ sessionId: 's-2' }])).error.denied).toBe(true)
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

  test('会话元数据事件按工作区过滤、脱敏并将越权迁移降为移除通知', async () => {
    expect(getWebRemoteChannelPolicy('agent:session-metadata-changed')).toMatchObject({ level: 'read', scope: 'workspace' })
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    const ws = client(bridge)
    const mainWindow = (await import('../../main-window-store')).getMainWindow()!
    const channel = 'agent:session-metadata-changed'
    mainWindow.webContents.send(channel, { epoch: 'boot-1', sequence: 1, action: 'upsert', workspaceId: 'ws-1', clearedFields: ['parentSessionId', 'piSessionFile', 'delegationGoal'], session: { id: 's-1', title: 'renamed', workspaceId: 'ws-1', createdAt: 1, updatedAt: 2, parentSessionId: 'parent-1', rootSessionId: 'root-1', sourceDelegationId: 'delegation-1', delegationStatus: 'running', sourceAutomationId: 'automation-1', piEntryBindings: { private: 'binding' }, delegationGoal: 'secret goal', piSessionFile: '/private/session', apiKey: 'secret' } })
    mainWindow.webContents.send(channel, { epoch: 'boot-1', sequence: 2, action: 'upsert', workspaceId: 'ws-2', session: { id: 's-2', title: 'unauthorized', workspaceId: 'ws-2', createdAt: 1, updatedAt: 2 } })
    mainWindow.webContents.send(channel, { epoch: 'boot-1', sequence: 3, action: 'upsert', workspaceId: 'ws-2', previousWorkspaceId: 'ws-1', session: { id: 's-1', title: 'renamed', workspaceId: 'ws-2', createdAt: 1, updatedAt: 3, piSessionFile: '/private/session' } })
    mainWindow.webContents.send(channel, { epoch: 'boot-1', sequence: 4, action: 'remove', workspaceId: 'ws-1', session: { id: 's-1', title: 'deleted title', workspaceId: 'ws-1', createdAt: 1, updatedAt: 4, piSessionFile: '/private/session' } })
    const events = ws.sent.map((item) => JSON.parse(item)).filter((item) => item.type === 'event' && item.channel === channel)
    expect(events).toHaveLength(3)
    expect(events[0].value).toMatchObject({ epoch: 'boot-1', sequence: 1, action: 'upsert' })
    expect(events[0].value.session).toMatchObject({
      id: 's-1', title: 'renamed', workspaceId: 'ws-1', parentSessionId: 'parent-1', rootSessionId: 'root-1',
      sourceDelegationId: 'delegation-1', delegationStatus: 'running', sourceAutomationId: 'automation-1',
    })
    expect(events[0].value.clearedFields).toEqual(['parentSessionId'])
    for (const key of ['piEntryBindings', 'delegationGoal', 'piSessionFile', 'apiKey']) expect(events[0].value.session).not.toHaveProperty(key)
    expect(events[1].value).toEqual({ epoch: 'boot-1', sequence: 3, action: 'remove', workspaceId: 'ws-1', session: { id: 's-1' } })
    expect(events[2].value).toEqual({ epoch: 'boot-1', sequence: 4, action: 'remove', workspaceId: 'ws-1', session: { id: 's-1' } })
    expect(events.map((event) => event.value.sequence)).toEqual([1, 3, 4])
  })

  test('会话流事件只镜像给授权工作区，含 SDK 内容与交互事件', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    bridge.registerInvoke('agent:list-workspaces', async () => [])
    const ws = client(bridge)
    await invoke(ws, 'agent:list-workspaces') // ensure main window send is mirrored
    const mainWindow = (await import('../../main-window-store')).getMainWindow()!
    const sendInteraction = (sessionId: string, type: string, requestId: string) => mainWindow.webContents.send('agent:stream:event', {
      sessionId,
      payload: { kind: 'proma_event', event: { type, request: { requestId, sessionId, questions: [], allowedPrompts: [], planDocument: { filePath: '/session/plan/plan.md', displayName: 'plan.md', contentHash: 'hash' } } } },
    })
    sendInteraction('s-1', 'ask_user_request', 'ask-1')
    sendInteraction('s-1', 'exit_plan_mode_request', 'plan-1')
    sendInteraction('s-2', 'exit_plan_mode_request', 'plan-2')
    mainWindow.webContents.send('agent:stream:event', { sessionId: 's-1', payload: { kind: 'sdk_message', message: { type: 'assistant', message: { content: 'visible response' } } } })
    mainWindow.webContents.send('agent:stream:event', { sessionId: 's-2', payload: { kind: 'sdk_message', message: { type: 'assistant', message: { content: 'other workspace' } } } })
    const events = ws.sent.map((item) => JSON.parse(item)).filter((item) => item.type === 'event' && item.channel === 'agent:stream:event')
    expect(events).toHaveLength(3)
    expect(events.every((item) => item.value.sessionId === 's-1')).toBe(true)
    expect(events.map((item) => item.value.payload.kind === 'proma_event' ? item.value.payload.event.type : item.value.payload.kind)).toEqual(['ask_user_request', 'exit_plan_mode_request', 'sdk_message'])
    expect(events[1].value.payload.event.request.planDocument.filePath).toBe('/session/plan/plan.md')
  })

  test('手机附件拒绝路径穿越、25MB 超限和未授权会话，合法附件正常写入', async () => {
    const bridge = new WebRemoteIpcBridge({ allowedWorkspaceIds: ['ws-1'] }, resolvers)
    let saved: unknown
    bridge.registerInvoke('agent:save-files-to-session', async (_event, input) => { saved = input; return [{ filename: 'note.txt', targetPath: '/sessions/s-1/attachments/note.txt' }] })
    const ws = client(bridge)
    const base = { workspaceSlug: 'one', sessionId: 's-1', files: [{ filename: 'note.txt', data: Buffer.from('hello').toString('base64') }] }
    const traversal = await invoke(ws, 'agent:save-files-to-session', [{ ...base, files: [{ filename: '../escape.txt', data: 'aGVsbG8=' }] }])
    expect(traversal.error.denied).toBe(true)
    expect(traversal.error.reason).toContain('文件名不安全')

    const oversizedData = Buffer.alloc(25 * 1024 * 1024 + 1).toString('base64')
    const oversized = await invoke(ws, 'agent:save-files-to-session', [{ ...base, files: [{ filename: 'large.bin', data: oversizedData }] }])
    expect(oversized.error.denied).toBe(true)
    expect(oversized.error.reason).toContain('25MB')

    const unauthorized = await invoke(ws, 'agent:save-files-to-session', [{ ...base, sessionId: 's-2' }])
    expect(unauthorized.error.denied).toBe(true)
    expect(unauthorized.error.reason).toContain('授权范围')

    const normal = await invoke(ws, 'agent:save-files-to-session', [base])
    expect(normal.ok).toBe(true)
    expect(normal.value[0].targetPath).toContain('/sessions/s-1/')
    expect(saved).toEqual(base)
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
    expect((await invoke(ws, 'agent:get-mcp-config', ['one'])).ok).toBe(true)
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
