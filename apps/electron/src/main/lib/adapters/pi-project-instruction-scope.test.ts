import { spawnSync } from 'node:child_process'
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, unlinkSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager, createAgentSession, DefaultResourceLoader, SettingsManager, type ModelRuntime } from '@earendil-works/pi-coding-agent'
import { getModel, type AssistantMessage } from '@earendil-works/pi-ai/compat'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { createPromaManagedResourceLoaderOptions } from './pi-resource-loader-overrides'
import { PROJECT_INSTRUCTION_STATE_TYPE } from './pi-project-instruction-state'
import { ProjectInstructionScopeController } from './pi-project-instruction-scope'
import { resolveProjectInstructions } from '../project-instruction-resolver'

// Another repository suite globally mocks the SDK package. Run this real-SDK
// suite in its own Bun process so no test can silently substitute fake storage.
if (process.env.PROMA_PROJECT_INSTRUCTION_TEST_FILE !== import.meta.path) {
  test('real SDK project-instruction suite (isolated from global SDK mocks)', () => {
    const result = spawnSync(process.execPath, ['test', import.meta.path], {
      env: { ...process.env, PROMA_PROJECT_INSTRUCTION_TEST_FILE: import.meta.path },
      encoding: 'utf8', timeout: 60_000,
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error) throw result.error
    expect(result.status).toBe(0)
  }, 65_000)
} else {

  const temporary: string[] = []
  afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
  function fixture() {
    const base = mkdtempSync(join(tmpdir(), 'proma-instruction-resume-'))
    temporary.push(base)
    const root = join(base, 'project')
    mkdirSync(join(root, 'child'), { recursive: true })
    mkdirSync(join(base, 'sessions'))
    writeFileSync(join(root, 'AGENTS.md'), 'Synthetic root rule')
    writeFileSync(join(root, 'child/AGENTS.md'), 'Synthetic child rule v1')
    const manager = SessionManager.create(root, join(base, 'sessions'))
    // A real tool discovery follows an assistant tool-call message, which flushes SDK storage.
    manager.appendMessage({ role: 'assistant', content: [], timestamp: Date.now(), stopReason: 'stop' } as any)
    return { root, base, manager }
  }
  function outerQuery(root: string, manager: SessionManager, ownerSessionId = 'owner') {
    const controller = new ProjectInstructionScopeController({
      projectRoot: root, cwd: root, initialSources: resolveProjectInstructions({ projectRoot: root }).sources,
      ownerSessionId, sessionState: manager,
    })
    const hooks = new Map<string, (event: any) => any>()
    controller.createExtension()({ on: (name: string, handler: any) => hooks.set(name, handler) } as any)
    const start = () => hooks.get('before_agent_start')!({ systemPrompt: 'Synthetic root rule' })?.systemPrompt ?? 'Synthetic root rule'
    const access = () => hooks.get('tool_call')!({ toolName: 'read', input: { path: join(root, 'child/file.txt') } })
    return { controller, start, access }
  }

  test('independent outer queries reopen the real SDK file: first block, second trusted injection, third injection', () => {
    const { root, base, manager } = fixture()
    const first = outerQuery(root, manager)
    expect(first.start()).not.toContain('Synthetic child rule')
    expect(first.access()?.block).toBe(true)
    const reopened = SessionManager.open(manager.getSessionFile()!, join(base, 'sessions'), root)
    const second = outerQuery(root, reopened)
    expect(second.start()).toContain('Synthetic child rule v1')
    expect(second.access()).toBeUndefined()
    const third = outerQuery(root, SessionManager.open(manager.getSessionFile()!, join(base, 'sessions'), root))
    expect(third.start()).toContain('Synthetic child rule v1')
    expect(third.access()).toBeUndefined()
  })

  test('discovery stores references, not stale pending text between independent queries', () => {
    const { root, manager } = fixture()
    const first = outerQuery(root, manager)
    first.start()
    expect(first.access()?.block).toBe(true)
    writeFileSync(join(root, 'child/AGENTS.md'), 'Synthetic child rule v2')
    const second = outerQuery(root, SessionManager.open(manager.getSessionFile()!))
    expect(second.start()).toContain('Synthetic child rule v2')
    expect(second.access()).toBeUndefined()
  })

  // Real SDK prompt/extension/tool pipeline; only the provider transport is fake.
  // No auth/config discovery, global mutations, remote model calls or business fixtures.
  async function sdkQuery(root: string, base: string, manager: SessionManager, outcome: 'stop' | 'error' | 'aborted' | 'exception' = 'stop') {
    const controller = new ProjectInstructionScopeController({
      projectRoot: root, cwd: root, initialSources: resolveProjectInstructions({ projectRoot: root }).sources,
      ownerSessionId: 'owner', sessionState: manager,
    })
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' })
    const agentDir = join(base, 'isolated-agent')
    mkdirSync(agentDir, { recursive: true })
    const resourceLoader = new DefaultResourceLoader({
      cwd: root, agentDir, settingsManager, ...createPromaManagedResourceLoaderOptions(),
      noThemes: true, noPromptTemplates: true,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      systemPromptOverride: () => 'Synthetic root rule',
      extensionFactories: [controller.createExtension()],
    })
    await resourceLoader.reload()
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    const modelRuntime = { hasConfiguredAuth: () => true, getModel: () => model, getAvailableSnapshot: () => [model] } as unknown as ModelRuntime
    const { session } = await createAgentSession({ cwd: root, agentDir, sessionManager: manager, resourceLoader, settingsManager, model, modelRuntime, thinkingLevel: 'off', tools: ['read'] })
    const requests: unknown[] = []
    let calls = 0
    session.agent.streamFunction = async (_model, context) => {
      requests.push(structuredClone(context))
      calls++
      if (calls > 1 && outcome === 'exception') throw new Error('Synthetic transport exception')
      const stream = createAssistantMessageEventStream()
      const message: AssistantMessage = {
        role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: calls === 1 ? [{ type: 'toolCall', id: `synthetic-${Date.now()}`, name: 'read', arguments: { path: join(root, 'child/file.txt') } }] : [],
        stopReason: calls === 1 ? 'toolUse' : outcome === 'exception' ? 'error' : outcome,
        ...(calls > 1 && outcome !== 'stop' ? { errorMessage: `Synthetic ${outcome}` } : {}),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now(),
      }
      if (calls > 1 && outcome !== 'stop') stream.push({ type: 'error', reason: outcome === 'exception' ? 'error' : outcome, error: message })
      else stream.push({ type: 'done', reason: message.stopReason as 'toolUse' | 'stop', message })
      stream.end(message)
      return stream
    }
    try {
      const unsubscribe = outcome === 'aborted' ? session.subscribe((event) => {
        if (event.type === 'tool_execution_end') void session.abort()
      }) : () => {}
      try { await session.prompt('Synthetic request') } finally { unsubscribe() }
      const results = manager.getBranch().filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult')
      return { requests, results, prompt: session.systemPrompt }
    } finally { session.dispose() }
  }

  test.each(['stop', 'error', 'aborted', 'exception'] as const)('actual SDK provider prompt after %s completion and file reopen contains the child rule', async (outcome) => {
    const { root, base } = fixture()
    writeFileSync(join(root, 'child/file.txt'), 'SYNTHETIC_FILE_BODY')
    // Fresh SDK session with no assistant pre-seeding exercises first tool-call flush.
    const manager = SessionManager.create(root, join(base, 'sessions'))
    const first = await sdkQuery(root, base, manager, outcome)
    expect(JSON.stringify(first.requests[0])).not.toContain('Synthetic child rule v1')
    expect(JSON.stringify(first.results)).toContain('下一轮')
    expect(JSON.stringify(first.results)).not.toContain('SYNTHETIC_FILE_BODY')
    const file = manager.getSessionFile()!
    expect(readFileSync(file, 'utf8')).toContain(PROJECT_INSTRUCTION_STATE_TYPE)
    const second = await sdkQuery(root, base, SessionManager.open(file))
    // Check the actual provider-facing leading system message, not merely controller state.
    const head = (second.requests[0] as any).messages[0]
    expect(head.role).toBe('system')
    expect(head.content).toContain('Synthetic child rule v1')
    expect(JSON.stringify(second.results)).toContain('SYNTHETIC_FILE_BODY')
    const third = await sdkQuery(root, base, SessionManager.open(file))
    expect((third.requests[0] as any).messages[0].content).toContain('Synthetic child rule v1')
  })

  test('owner session, root switching and branches never inherit another scope', () => {
    const { root, base, manager } = fixture()
    const forkPoint = manager.getLeafId()!
    const first = outerQuery(root, manager)
    first.start(); first.access()
    const wrongOwner = outerQuery(root, manager, 'other-owner')
    expect(wrongOwner.start()).not.toContain('Synthetic child rule')
    expect(wrongOwner.access()?.block).toBe(true)
    const otherRoot = join(base, 'other-project')
    mkdirSync(join(otherRoot, 'child'), { recursive: true })
    writeFileSync(join(otherRoot, 'AGENTS.md'), 'Other root')
    writeFileSync(join(otherRoot, 'child/AGENTS.md'), 'Other child')
    const switched = outerQuery(otherRoot, manager)
    expect(switched.start()).not.toContain('Other child')
    expect(switched.access()?.block).toBe(true)
    manager.branch(forkPoint)
    const branch = outerQuery(root, manager)
    expect(branch.start()).not.toContain('Synthetic child rule')
    expect(branch.access()?.block).toBe(true)
  })

  test('compaction and file reopen restore references outside the retained message window', () => {
    const { root, manager } = fixture()
    const first = outerQuery(root, manager)
    first.start(); first.access()
    const kept = manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Kept synthetic message' }], timestamp: Date.now() })
    manager.appendCompaction('Synthetic summary', kept, 100)
    const resumed = outerQuery(root, SessionManager.open(manager.getSessionFile()!))
    expect(resumed.start()).toContain('Synthetic child rule v1')
    expect(resumed.access()).toBeUndefined()
  })

  test('nested scopes accumulate once, retain scope labels, and root initial sources are not duplicated', () => {
    const { root, manager } = fixture()
    mkdirSync(join(root, 'child/nested'))
    writeFileSync(join(root, 'child/nested/AGENTS.md'), 'Synthetic nested rule')
    const first = outerQuery(root, manager)
    expect(first.start()).toBe('Synthetic root rule')
    first.access(); first.access()
    expect(manager.getBranch().filter((entry) => entry.type === 'custom')).toHaveLength(1)
    const second = outerQuery(root, manager)
    second.start()
    expect(second.controller.beforeToolCall({ toolName: 'read', input: { path: join(root, 'child/nested/a.txt') } })?.block).toBe(true)
    const third = outerQuery(root, manager)
    const prompt = third.start()
    expect(prompt).toContain('scope="child"')
    expect(prompt).toContain('scope="child/nested"')
    expect(prompt.split('Synthetic root rule')).toHaveLength(2)
    expect(third.controller.beforeToolCall({ toolName: 'read', input: { path: join(root, 'child/nested/a.txt') } })).toBeUndefined()
    third.start(); third.access()
    expect(manager.getBranch().filter((entry) => entry.type === 'custom')).toHaveLength(2)
  })

  test('rules changed during a run block again; deleted rules and legacy replacement are re-resolved', () => {
    const { root, manager } = fixture()
    const first = outerQuery(root, manager)
    first.start(); first.access()
    const second = outerQuery(root, manager)
    second.start()
    writeFileSync(join(root, 'child/AGENTS.md'), 'Changed during run')
    expect(second.access()?.block).toBe(true)
    const third = outerQuery(root, manager)
    expect(third.start()).toContain('Changed during run')
    expect(third.access()).toBeUndefined()
    unlinkSync(join(root, 'child/AGENTS.md'))
    writeFileSync(join(root, 'child/CLAUDE.md'), 'Legacy child rule')
    const legacy = outerQuery(root, manager)
    expect(legacy.start()).toContain('Legacy child rule')
    expect(legacy.controller.beforeToolCall({ toolName: 'write', input: { path: join(root, 'child/new.txt') } })?.reason).toContain('legacy')
    expect(legacy.controller.beforeToolCall({ toolName: 'write', input: { path: join(root, 'child/AGENTS.md') } })).toBeUndefined()
    writeFileSync(join(root, 'child/AGENTS.md'), 'Replacement AGENTS')
    const agents = outerQuery(root, manager)
    expect(agents.start()).toContain('Replacement AGENTS')
    expect(agents.start()).not.toContain('Legacy child rule')
    expect(agents.controller.beforeToolCall({ toolName: 'write', input: { path: join(root, 'child/new.txt') } })).toBeUndefined()
    unlinkSync(join(root, 'child/AGENTS.md')); unlinkSync(join(root, 'child/CLAUDE.md'))
    const deleted = outerQuery(root, manager)
    expect(deleted.start()).not.toContain('Replacement AGENTS')
    expect(deleted.access()).toBeUndefined()
  })

  test('no delivery occurs before agent start and an injected reference does not itself grant access', () => {
    const { root, manager } = fixture()
    manager.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, { version: 1, ownerSessionId: 'owner', projectRoot: resolveProjectInstructions({ projectRoot: root }).projectRoot, directories: ['child'] })
    const query = outerQuery(root, manager)
    expect(query.access()?.block).toBe(true)
    expect(query.start()).toContain('Synthetic child rule v1')
    expect(query.access()).toBeUndefined()
    expect(query.controller.beforeToolCall({ toolName: 'bash', input: { command: 'not executed' } })).toBeUndefined()
  })

  test('merged independent scopes cannot exceed the existing 128 KB instruction budget', () => {
    const { root, manager } = fixture()
    writeFileSync(join(root, 'AGENTS.md'), 'R'.repeat(48 * 1024))
    for (const name of ['a', 'b']) { mkdirSync(join(root, name)); writeFileSync(join(root, name, 'AGENTS.md'), name.repeat(48 * 1024)) }
    const first = outerQuery(root, manager)
    first.start()
    for (const name of ['a', 'b']) expect(first.controller.beforeToolCall({ toolName: 'read', input: { path: join(root, name, 'x') } })?.block).toBe(true)
    const second = outerQuery(root, manager)
    expect(second.start).toThrow('128 KB')
    expect(second.controller.beforeToolCall({ toolName: 'read', input: { path: join(root, 'a/x') } })?.block).toBe(true)
  })

  test('malformed persisted state and symlink swaps fail closed with an explicit diagnostic', () => {
    const { root, base, manager } = fixture()
    const initial = outerQuery(root, manager)
    initial.start(); initial.access()
    const outside = join(base, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'AGENTS.md'), 'MUST_NOT_INJECT')
    rmSync(join(root, 'child'), { recursive: true })
    symlinkSync(outside, join(root, 'child'))
    const swapped = outerQuery(root, manager)
    expect(swapped.start).toThrow('符号链接越界')
    // An unrelated in-root file operation must also not be mistaken for successful restoration.
    expect(swapped.controller.beforeToolCall({ toolName: 'read', input: { path: join(root, 'safe.txt') } })?.reason).toContain('未标记已加载')
  })

  test('storage failures explicitly block instead of claiming the next request can recover', () => {
    const { root, manager } = fixture()
    const controller = new ProjectInstructionScopeController({
      projectRoot: root, cwd: root, initialSources: resolveProjectInstructions({ projectRoot: root }).sources,
      ownerSessionId: 'owner', sessionState: { getBranch: () => manager.getBranch(), appendCustomEntry: () => { throw new Error('Synthetic EACCES') } },
    })
    controller.appendPendingInstructions('Synthetic root rule')
    const access = () => controller.beforeToolCall({ toolName: 'read', input: { path: join(root, 'child/file.txt') } })
    expect(access()?.reason).toContain('无法保存')
    expect(access()?.reason).toContain('Synthetic EACCES')
    expect(() => controller.appendPendingInstructions('Synthetic root rule')).toThrow('Synthetic EACCES')
    expect(access()?.block).toBe(true)
  })


  test('instruction-file symlinks outside the root never enter the trusted prompt', () => {
    const { root, base, manager } = fixture()
    unlinkSync(join(root, 'child/AGENTS.md'))
    const outside = join(base, 'outside.md')
    writeFileSync(outside, 'EXTERNAL_RULE_MUST_NOT_APPEAR')
    symlinkSync(outside, join(root, 'child/AGENTS.md'))
    const query = outerQuery(root, manager)
    expect(query.start()).not.toContain('EXTERNAL_RULE_MUST_NOT_APPEAR')
    query.access()
    expect(query.start()).not.toContain('EXTERNAL_RULE_MUST_NOT_APPEAR')
    expect(manager.getBranch().filter((entry) => entry.type === 'custom')).toHaveLength(0)
  })

  test.each([null, { version: 2 }, { allow: true }])('malformed snapshots fail closed through controller hooks: %j', (data) => {
    const { root, manager } = fixture()
    manager.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, data)
    const query = outerQuery(root, manager)
    expect(query.start).toThrow('状态无效')
    expect(query.access()?.block).toBe(true)
    expect(query.access()?.reason).toContain('未标记已加载')
  })

  test('root hash changes after controller creation are injected before being marked delivered', () => {
    const { root, manager } = fixture()
    const query = outerQuery(root, manager)
    writeFileSync(join(root, 'AGENTS.md'), 'Updated synthetic root')
    expect(query.start()).toContain('Updated synthetic root')
    expect(query.controller.beforeToolCall({ toolName: 'read', input: { path: join(root, 'a.txt') } })).toBeUndefined()
  })


  test('project-root symlink replacement is never treated as the original authorized root', () => {
    const { root, base, manager } = fixture()
    const query = outerQuery(root, manager)
    query.start()
    renameSync(root, join(base, 'original-project'))
    const outside = join(base, 'outside-project')
    mkdirSync(outside)
    writeFileSync(join(outside, 'AGENTS.md'), 'MUST_NOT_INJECT_AFTER_ROOT_SWAP')
    symlinkSync(outside, root)
    expect(query.controller.beforeToolCall({ toolName: 'read', input: { path: join(root, 'a.txt') } })?.block).toBe(true)
    expect(query.start).toThrow('项目根真实路径已变化')
  })

  test('directory symlink escape discovered during an active run is explicitly blocked', () => {
    const { root, base, manager } = fixture()
    const query = outerQuery(root, manager)
    query.start()
    mkdirSync(join(base, 'outside'))
    symlinkSync(join(base, 'outside'), join(root, 'escape'))
    expect(query.controller.beforeToolCall({ toolName: 'read', input: { path: join(root, 'escape/file.txt') } })?.reason).toContain('符号链接')
  })

  test('SDK swallowing a restoration-hook exception cannot turn malformed state into tool permission', async () => {
    const { root, base, manager } = fixture()
    writeFileSync(join(root, 'child/file.txt'), 'SYNTHETIC_FILE_BODY')
    manager.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, null)
    const run = await sdkQuery(root, base, manager)
    expect(JSON.stringify(run.results)).toContain('未标记已加载')
    expect(JSON.stringify(run.results)).not.toContain('SYNTHETIC_FILE_BODY')
    expect(JSON.stringify(run.requests[0])).not.toContain('Synthetic child rule v1')
  })
}
