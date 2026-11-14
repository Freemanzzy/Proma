import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfinedToolDecision } from './personal-confined-workspace'
import { validateToolInput } from './agent-tool-input-validator'
import { resolveExternalWorkspaceToolDecision } from './workspace-readonly-policy'

const source = readFileSync(new URL('./agent-orchestrator.ts', import.meta.url), 'utf8')
// Execute the actual closure body, not a second implementation of permission
// ordering. Isolation avoids importing Electron services or accessing real data.
const start = source.indexOf('      const canUseTool = async (')
const end = source.indexOf('      // 13. 构建 Adapter', start)
const closure = source.slice(start, end)
const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })
let root: string; let project: string; let session: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'confined-integration-'))
  project = join(root, 'workspace-files'); session = join(root, 'session-1')
  mkdirSync(project); mkdirSync(session)
  writeFileSync(join(root, 'confined-policy.json'), JSON.stringify({ version: 1, commands: ['/approved/entry'] }))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

function actualCanUseTool(mode: string, confined = true) {
  const names = ['getPermissionMode', 'validateToolInput', 'confined', 'resolveConfinedToolDecision', 'workspaceSlug', 'getProjectFilesPath', 'getAgentSessionWorkspacePath', 'sessionId', 'agentCwd', 'getAgentWorkspacePath', 'workspace', 'resolveExternalWorkspaceToolDecision']
  const values = [() => mode, validateToolInput, confined, resolveConfinedToolDecision, 'fixture', () => project, () => session, 'session-1', project, () => root, { externalAccess: confined ? 'confined' : 'read-only' }, resolveExternalWorkspaceToolDecision]
  return new Function(...names, `${transpiler.transformSync(closure)}\nreturn canUseTool`)(...values) as (tool: string, input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<{ behavior: string; message?: string; updatedInput?: Record<string, unknown> }>
}

for (const mode of ['bypassPermissions', 'auto', 'plan']) {
  test(`real orchestrator closure: confined restrictions precede permission branch (${mode})`, async () => {
    const canUseTool = actualCanUseTool(mode)
    const options = { signal: new AbortController().signal }
    for (const [tool, input] of [
      ['Bash', { command: 'cat ~/.zshrc' }], ['Read', { file_path: '~/.proma/settings.json' }], ['Write', { file_path: '~/x', content: 'x' }],
      ['LS', { path: '~' }], ['Bash', { command: 'node -e "1"' }], ['EgoBrowser', { script: 'return 1' }],
      ['Read', { file_path: join(root, 'other-workspace', 'x') }], ['Bash', { command: '/approved/entry --file=/etc/passwd' }],
      ['mcp__planning__list_todos', {}], ['TerminalExecute', { command: 'pwd' }], ['FutureTool', {}],
    ] as Array<[string, Record<string, unknown>]>) {
      const result = await canUseTool(tool, input, options)
      expect(result.behavior).toBe('deny')
      expect(result.message).toContain('外部受限')
    }
    expect((await canUseTool('Write', { file_path: 'ok', content: 'x' }, options)).behavior).toBe('allow')
    const result = await canUseTool('Bash', { command: '/approved/entry "hello world"' }, options)
    expect(result.behavior).toBe('allow')
    expect(result.updatedInput?.command).toContain("'/usr/bin/env' '-i'")
  })
}
test('real closure still applies input validation before confined and existing readonly fix before bypass', async () => {
  const opts = { signal: new AbortController().signal }
  const invalid = await actualCanUseTool('bypassPermissions')('Write', { path: 'x' }, opts)
  expect(invalid.behavior).toBe('deny')
  expect(invalid.message).not.toContain('外部受限')
  expect((await actualCanUseTool('bypassPermissions', false)('Write', { file_path: '~/x', content: 'x' }, opts)).behavior).toBe('deny')
})
test('orchestrator and adapter keep all resource injection gates closed', () => {
  expect(source).toContain('confined ? {} : await this.buildMcpServers')
  expect(source).toContain('confined ? { tools: [], collaborationAvailable: false } : await buildPiBuiltinTools')
  expect(source).toContain('const attachedDirectories = confined ? []')
  expect(source).toContain('const projectInstructions = !confined && workspaceSlug')
  expect(source).toContain('const systemPromptAppend = confined ? buildConfinedSystemPrompt')
  const adapter = readFileSync(new URL('./adapters/pi-agent-adapter.ts', import.meta.url), 'utf8')
  expect(adapter).toContain('input.confined ? [] : input.additionalSkillPaths')
  expect(adapter).toContain('input.confined ? () => ({ skills: [], diagnostics: [] })')
  expect(adapter).toContain('!input.confined || isConfinedToolNameAllowed(tool.name)')
  expect(adapter).toContain("shellPath: '/bin/bash', spawnHook: ({ command, cwd }) => ({ command, cwd, env: confinedShellEnvironment() })")
})

import { confinedBridgeWorkspaceId, isConfinedBridgeCommandAllowed, CONFINED_HELP, CONFINED_BRIDGE_DENIED } from './personal-confined-workspace'
interface TestBinding { chatId?: string; sessionId: string; workspaceId?: string }
type TestChat = string | { chatId: string; senderOpenId?: string; chatType?: string }
interface BridgeHarness {
  handleListCommand(chat: TestChat): Promise<void>
  handleSwitchCommand(chat: TestChat, arg: string): Promise<void>
  createNewSession(chat: TestChat): Promise<void>
  handleCommand(chat: TestChat, command: string): Promise<void>
  getScopedBinding(chatId: string): TestBinding | undefined
  getValidBinding(chatId: string): TestBinding | undefined
  chatBindings: Map<string, TestBinding>
  sessionToChat: Map<string, string>
  confinedIgnoredBindings: TestBinding[]
}
function actualBridgeMethods(file: string, names: string[], dependencies: Record<string, unknown>) {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8')
  const methods = names.map((name) => {
    const match = new RegExp(`  private (?:async )?${name}\\(`).exec(text)
    if (!match) throw new Error(`Method missing: ${name}`)
    const next = text.indexOf('\n  private ', match.index + match[0].length)
    return text.slice(match.index, next < 0 ? text.length : next)
  }).join('\n')
  const code = transpiler.transformSync(`class BridgeUnderTest { ${methods}\n }`)
  const Ctor = new Function(...Object.keys(dependencies), `${code}; return BridgeUnderTest`)(...Object.values(dependencies))
  return new (Ctor as new () => BridgeHarness)()
}
for (const file of ['./feishu-bridge.ts', './bridge-command-handler.ts']) {
  test(`real Bridge list/switch/new methods cannot leave confined workspace: ${file}`, async () => {
    const feishu = file.includes('feishu')
    const sessions = [{ id: 'admin-session', title: 'PRIVATE ADMIN TITLE', workspaceId: 'admin' }, { id: 'customer-session', title: 'Customer conversation', workspaceId: 'customer', confinedOrigin: true }]
    const workspaces = [{ id: 'admin', name: 'PRIVATE ADMIN WORKSPACE' }, { id: 'customer', name: 'Customer' }]
    const sent: unknown[] = []; const created: string[] = []
    const bridge = actualBridgeMethods(file, ['handleListCommand', 'handleSwitchCommand', 'createNewSession'], {
      listAgentSessions: () => sessions,
      listAgentWorkspacesByUpdatedAt: () => workspaces,
      getSettings: () => ({ agentChannelId: 'api', agentWorkspaceId: 'admin' }),
      createAgentSession: (_title: unknown, _channel: unknown, workspaceId: string) => { created.push(workspaceId); return { id: 'new-session', title: 'New' } },
      getMainWindow: () => null,
      buildSessionListCard: (items: unknown) => items,
    })
    Object.assign(bridge, {
      chatBindings: new Map([['group', { sessionId: 'customer-session', workspaceId: 'customer' }]]),
      sessionToChat: new Map(), botConfig: {}, config: {},
      confinedWorkspaceId: () => 'customer',
      getScopedBinding(chatId: string) { return this.chatBindings.get(chatId) },
      send: async (_chat: string, message: unknown) => { sent.push(message) },
      sendMessage: async (_chat: string, message: unknown) => { sent.push(message) },
      sendCardMessage: async (_chat: string, message: unknown) => { sent.push(message) },
      saveBindings: () => {}, updateStatus: () => {}, getActiveBindingCount: () => 1, notifySessionCreated: () => {},
      resolveValidWorkspaceId: () => 'admin', effectiveDefaultWorkspaceId: () => 'admin',
    })
    const arg = feishu ? { chatId: 'group', senderOpenId: 'sender', chatType: 'group' } : 'group'
    await bridge.handleListCommand(arg)
    expect(JSON.stringify(sent)).toContain('Customer')
    expect(JSON.stringify(sent)).not.toContain('PRIVATE ADMIN')
    await bridge.handleSwitchCommand(arg, 'admin-session')
    expect(bridge.chatBindings.get('group')!.sessionId).toBe('customer-session')
    await bridge.handleSwitchCommand(arg, '1')
    expect(bridge.chatBindings.get('group')!.sessionId).toBe('customer-session')
    await bridge.createNewSession(arg)
    expect(created).toEqual(['customer'])
  })
  test(`real Bridge default lock ignores old cross-workspace binding without deleting preserved data: ${file}`, () => {
    const feishu = file.includes('feishu')
    const old = { chatId: 'group', sessionId: 'admin-session', workspaceId: 'admin' }
    const bridge = actualBridgeMethods(file, [feishu ? 'getScopedBinding' : 'getValidBinding'], {
      confinedBridgeWorkspaceId,
      getAgentWorkspace: (id: string) => ({ id, externalAccess: id === 'customer' ? 'confined' : 'read-write' }),
      getAgentSessionMeta: () => ({ workspaceId: 'admin' }),
    })
    Object.assign(bridge, {
      effectiveDefaultWorkspaceId: () => 'customer', botConfig: { defaultWorkspaceId: 'customer' }, config: { getDefaultWorkspaceId: () => 'customer' },
      chatBindings: new Map([['group', old]]), sessionToChat: new Map([['admin-session', 'group']]), confinedIgnoredBindings: [],
      removeBinding(chatId: string, binding: { sessionId: string }) { this.chatBindings.delete(chatId); this.sessionToChat.delete(binding.sessionId) },
    })
    expect(bridge[feishu ? 'getScopedBinding' : 'getValidBinding']('group')).toBeUndefined()
    expect(bridge.confinedIgnoredBindings).toEqual([old])
    expect(bridge.chatBindings.size).toBe(0)
    expect(bridge.sessionToChat.size).toBe(0)
  })
  test(`real Bridge command router denies workspace/model/now/mirror and unknown in confined: ${file}`, async () => {
    const feishu = file.includes('feishu'); const sent: string[] = []
    const bridge = actualBridgeMethods(file, ['handleCommand'], { isConfinedBridgeCommandAllowed, CONFINED_HELP, CONFINED_BRIDGE_DENIED })
    Object.assign(bridge, {
      getScopedBinding: () => {}, getValidBinding: () => {}, confinedWorkspaceId: () => 'customer',
      send: async (_chat: string, text: string) => { sent.push(text) }, sendMessage: async (_chat: string, text: string) => { sent.push(text) },
    })
    const arg = feishu ? { chatId: 'group' } : 'group'
    for (const command of ['/workspace', '/ws', '/model', '/m', '/now', '/mirror on', '/unknown']) await bridge.handleCommand(arg, command)
    expect(sent).toEqual(Array(7).fill(CONFINED_BRIDGE_DENIED))
    await bridge.handleCommand(arg, '/help')
    expect(sent.at(-1)).toBe(CONFINED_HELP)
  })
}

test('actual workspace update validator accepts confined and rejects unknown externalAccess', async () => {
  const text = readFileSync(new URL('./agent-workspace-manager.ts', import.meta.url), 'utf8')
  const start = text.indexOf('export async function updateAgentWorkspace(')
  const end = text.indexOf('/** 将本地项目重新关联', start)
  const code = transpiler.transformSync(text.slice(start, end).replace('export ', ''))
  const index = { workspaces: [{ id: 'customer', name: 'Customer', externalAccess: 'read-write' }] }
  let writes = 0
  const update = new Function('readIndex', 'writeIndex', 'getLocalProjectRootStatus', `${code}; return updateAgentWorkspace`)(() => index, () => { writes += 1 }, async () => undefined) as (id: string, updates: { externalAccess: string }) => Promise<{ externalAccess: string }>
  expect((await update('customer', { externalAccess: 'confined' })).externalAccess).toBe('confined')
  expect(writes).toBe(1)
  await expect(update('customer', { externalAccess: 'unknown' })).rejects.toThrow('工作区外部访问模式无效')
  expect(writes).toBe(1)
})

import { writeJsonFileAtomic } from './safe-file'
for (const file of ['./feishu-bridge.ts', './bridge-command-handler.ts']) {
  test(`actual binding persistence retains ignored old rows with active confined row: ${file}`, () => {
    const target = join(root, file.includes('feishu') ? 'feishu-bindings.json' : 'bridge-bindings.json')
    const old = { chatId: 'group', sessionId: 'admin-session', workspaceId: 'admin' }
    const active = { chatId: 'group', sessionId: 'customer-session', workspaceId: 'customer' }
    const bridge = actualBridgeMethods(file, ['saveBindings'], { getFeishuBotBindingsPath: () => target, writeJsonFileAtomic })
    Object.assign(bridge, { botConfig: { id: 'bot' }, confinedIgnoredBindings: [old], chatBindings: new Map([['group', active]]),
      config: { bindingStore: { save: (bindings: unknown[]) => writeJsonFileAtomic(target, bindings) } } })
    ;(bridge as unknown as { saveBindings(): void }).saveBindings()
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual([old, active])
  })
}

for (const file of ['./feishu-bridge.ts', './bridge-command-handler.ts']) {
  for (const fallback of (file.includes('feishu') ? ['settings', 'first', 'default-slug'] : ['settings', 'first'])) {
    test(`R2 real Bridge fallback ${fallback} confines unbound group: ${file}`, async () => {
      const feishu = file.includes('feishu')
      const workspaces = [{ id: 'customer', slug: 'default', name: 'Customer', externalAccess: 'confined' }, { id: 'admin', slug: 'admin', name: 'PRIVATE ADMIN' }]
      const sessions = [{ id: 'admin-session', workspaceId: 'admin', title: 'PRIVATE ADMIN' }, { id: 'legacy-session', workspaceId: 'customer', title: 'LEGACY SECRET' }, { id: 'customer-session', workspaceId: 'customer', title: 'Customer', confinedOrigin: true }]
      if (fallback === 'default-slug') workspaces.reverse()
      const settings = { agentChannelId: 'api', agentWorkspaceId: fallback === 'settings' ? 'customer' : undefined }
      const text = readFileSync(new URL(file, import.meta.url), 'utf8')
      const names = ['confinedWorkspaceId', 'handleListCommand', 'handleSwitchCommand', 'createNewSession']
      // Use the existing method before the fix and the shared resolver once added.
      if (text.includes('private effectiveDefaultWorkspaceId(')) names.push('effectiveDefaultWorkspaceId')
      if (!feishu) names.push('resolveValidWorkspaceId')
      const sent: unknown[] = []; const created: unknown[] = []
      const bridge = actualBridgeMethods(file, names, {
        confinedBridgeWorkspaceId, getSettings: () => settings,
        getAgentWorkspace: (id: string) => workspaces.find(w => w.id === id),
        getAgentSessionMeta: (id: string) => sessions.find(s => s.id === id),
        listAgentSessions: () => sessions, listAgentWorkspacesByUpdatedAt: () => workspaces,
        createAgentSession: (_title: unknown, _channel: unknown, workspaceId: string) => { created.push(workspaceId); return { id: 'new', title: 'New' } },
        getMainWindow: () => null, buildSessionListCard: (items: unknown) => items,
      })
      Object.assign(bridge, { botConfig: {}, config: {}, chatBindings: new Map(), sessionToChat: new Map(), confinedIgnoredBindings: [],
        getScopedBinding: () => undefined, send: async (_chat: string, msg: unknown) => sent.push(msg),
        sendMessage: async (_chat: string, msg: unknown) => sent.push(msg), sendCardMessage: async (_chat: string, msg: unknown) => sent.push(msg),
        saveBindings: () => {}, updateStatus: () => {}, getActiveBindingCount: () => 1, notifySessionCreated: () => {} })
      const arg = feishu ? { chatId: 'group', senderOpenId: 'sender', chatType: 'group' } : 'group'
      await bridge.handleListCommand(arg)
      expect(JSON.stringify(sent)).not.toContain('PRIVATE ADMIN')
      expect(JSON.stringify(sent)).not.toContain('LEGACY SECRET')
      await bridge.handleSwitchCommand(arg, 'admin-session')
      expect(bridge.chatBindings.size).toBe(0)
      await bridge.handleSwitchCommand(arg, 'legacy-session')
      expect(bridge.chatBindings.size).toBe(0)
      await bridge.createNewSession(arg)
      expect(created).toEqual(['customer'])
    })
  }
}
test('R2 real orchestrator preflight rejects legacy confined session before model or transcript use', async () => {
  const begin = source.indexOf('    const workspaceId = sessionMeta?.workspaceId ?? requestedWorkspaceId')
  const finish = source.indexOf('    // Windows 缺少', begin)
  const run = new Function('sessionMeta', 'requestedWorkspaceId', 'getAgentWorkspace', 'getLocalProjectRootStatus', 'reportPreflightError', transpiler.transformSync(`return (async()=>{${source.slice(begin, finish)};return 'model';})()`))
  for (const meta of [{ workspaceId: 'customer' }, { workspaceId: 'customer', confinedOrigin: false }, { workspaceId: 'customer', confinedOrigin: true }]) {
    const errors: unknown[] = []
    const result = await run(meta, 'customer', () => ({ externalAccess: 'confined' }), async () => undefined, (error: unknown) => errors.push(error))
    expect(errors.length).toBe(meta.confinedOrigin ? 0 : 1)
    expect(result).toBe(meta.confinedOrigin ? 'model' : undefined)
  }
})
test('R2 confined first prompt and recovery never backfill old transcript text', () => {
  const begin = source.indexOf('      const finalPrompt = isCompactCommand')
  const finish = source.indexOf('\n\n', begin)
  const prompt = new Function('isCompactCommand', 'existingSdkSessionId', 'contextualMessage', 'sessionId', 'confined', 'agentCwd', 'workspaceSlug', 'buildContextPrompt', `${transpiler.transformSync(source.slice(begin, finish))};return finalPrompt`)
  expect(prompt(false, undefined, 'CURRENT', 'session', true, '.', 'customer', () => 'OLD PRIVATE CANARY')).toBe('CURRENT')
  expect(source).toContain('queryOptions.prompt = confined ? contextualMessage : buildRecoveryPrompt')
})

for (const file of ['./feishu-bridge.ts', './bridge-command-handler.ts']) {
  for (const currentWorkspace of ['customer', 'admin']) {
  test(`R2 legacy binding (${currentWorkspace}) keeps confined workspace lock after being ignored: ${file}`, () => {
    const feishu = file.includes('feishu')
    const old = { chatId: 'group', sessionId: 'legacy', workspaceId: 'customer' }
    const bridge = actualBridgeMethods(file, ['confinedWorkspaceId', feishu ? 'getScopedBinding' : 'getValidBinding'], {
      confinedBridgeWorkspaceId,
      getAgentWorkspace: (id: string) => ({ id, externalAccess: id === 'customer' ? 'confined' : 'read-write' }),
      getAgentSessionMeta: () => ({ workspaceId: currentWorkspace }),
    })
    Object.assign(bridge, { effectiveDefaultWorkspaceId: () => 'admin', chatBindings: new Map([['group', old]]), sessionToChat: new Map(), confinedIgnoredBindings: [],
      removeBinding(chatId: string) { this.chatBindings.delete(chatId) },
    })
    expect(bridge[feishu ? 'getScopedBinding' : 'getValidBinding']('group')).toBeUndefined()
    expect((bridge as unknown as { confinedWorkspaceId(id: string): string }).confinedWorkspaceId('group')).toBe('customer')
  })
}
}

test('R2 running a formerly confined session in ordinary mode revokes provenance before later reuse', async () => {
  const begin = source.indexOf('    const workspaceId = sessionMeta?.workspaceId ?? requestedWorkspaceId')
  const finish = source.indexOf('    // Windows 缺少', begin)
  const code = transpiler.transformSync(`return (async()=>{${source.slice(begin, finish)}})()`)
  const meta = { id: 'safe-origin', workspaceId: 'customer', confinedOrigin: true as boolean | undefined }
  const run = new Function('sessionMeta', 'requestedWorkspaceId', 'getAgentWorkspace', 'getLocalProjectRootStatus', 'reportPreflightError', 'updateAgentSessionMeta', code)
  await run(meta, 'customer', () => ({ externalAccess: 'read-write' }), async () => undefined, () => { throw new Error('Unexpected rejection') }, (_id: string, updates: object) => Object.assign(meta, updates))
  expect(meta.confinedOrigin).toBeUndefined()
})
