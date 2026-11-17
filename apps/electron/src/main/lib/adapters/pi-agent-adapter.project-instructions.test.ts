import { spawnSync } from 'node:child_process'
import { expect, spyOn, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import type { AssistantMessage, Model } from '@earendil-works/pi-ai/compat'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { PiAgentAdapter, type PiAgentQueryOptions } from './pi-agent-adapter'
import { resolveProjectInstructions } from '../project-instruction-resolver'
import { PROJECT_INSTRUCTION_STATE_TYPE } from './pi-project-instruction-state'

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

  // Exercise the adapter's actual query()/cleanup/resume wiring. Replace only the
  // model runtime: never discover real credentials/config or contact a provider.
  test('PiAgentAdapter independent outer queries persist directory discovery and inject the real SDK prompt on resume', async () => {
    const base = mkdtempSync(join(tmpdir(), 'proma-adapter-instruction-'))
    const root = join(base, 'project')
    mkdirSync(join(root, 'child'), { recursive: true })
    mkdirSync(join(base, 'agent'))
    writeFileSync(join(root, 'AGENTS.md'), 'Adapter synthetic root')
    writeFileSync(join(root, 'child/AGENTS.md'), 'Adapter synthetic child instruction')
    writeFileSync(join(root, 'child/file.txt'), 'ADAPTER_SYNTHETIC_CONTENT')
    const requests: any[][] = []
    const runtimeSpy = spyOn(ModelRuntime, 'create').mockImplementation(async () => {
      const currentRequests: any[] = []
      requests.push(currentRequests)
      let model: Model<any>
      let calls = 0
      return {
        registerProvider(provider: string, config: any) { model = { ...config.models[0], provider } },
        getModel: () => model,
        getAvailableSnapshot: () => [model],
        hasConfiguredAuth: () => true,
        streamSimple(_model: unknown, context: unknown) {
          currentRequests.push(structuredClone(context))
          const stream = createAssistantMessageEventStream()
          const message: AssistantMessage = {
            role: 'assistant', api: model.api, provider: model.provider, model: model.id,
            content: calls++ === 0 ? [{ type: 'toolCall', id: `synthetic-${requests.length}`, name: 'read', arguments: { path: join(root, 'child/file.txt') } }] : [],
            stopReason: calls === 1 ? 'toolUse' : 'stop',
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now(),
          }
          stream.push({ type: 'done', reason: message.stopReason as 'toolUse' | 'stop', message })
          stream.end(message)
          return stream
        },
      } as unknown as ModelRuntime
    })
    const adapter = new PiAgentAdapter()
    try {
      let resumeSessionId: string | undefined
      let sessionFile: string | undefined
      const options: PiAgentQueryOptions = {
        sessionId: 'synthetic-owner', prompt: 'Synthetic request', model: 'synthetic-model', cwd: root,
        apiKey: 'synthetic-test-not-a-credential', provider: 'anthropic', baseUrl: 'https://synthetic.invalid',
        systemPrompt: 'Adapter synthetic root', permissionMode: 'bypassPermissions',
        projectInstructionScope: { projectRoot: root, initialSources: resolveProjectInstructions({ projectRoot: root }).sources },
        piAgentDir: join(base, 'agent'), piSessionDir: join(base, 'sessions'), thinkingLevel: 'off', maxTurns: 5,
        onSessionId(id, file) { resumeSessionId = id; sessionFile = file },
      }
      const first: unknown[] = []
      for await (const message of adapter.query(options)) first.push(message)
      expect(JSON.stringify(first)).toContain('下一轮')
      expect(JSON.stringify(first)).not.toContain('ADAPTER_SYNTHETIC_CONTENT')
      expect(requests[0]![0].messages[0].content).not.toContain('Adapter synthetic child instruction')
      expect(readFileSync(sessionFile!, 'utf8')).toContain(PROJECT_INSTRUCTION_STATE_TYPE)
      expect(resumeSessionId).toBeTruthy()
      const second: unknown[] = []
      for await (const message of adapter.query({ ...options, resumeSessionId })) second.push(message)
      expect(requests[1]![0].messages[0].role).toBe('system')
      expect(requests[1]![0].messages[0].content).toContain('Adapter synthetic child instruction')
      expect(JSON.stringify(second)).toContain('ADAPTER_SYNTHETIC_CONTENT')
      for await (const _message of adapter.query({ ...options, resumeSessionId })) { /* consume */ }
      expect(requests[2]![0].messages[0].content).toContain('Adapter synthetic child instruction')
      const reopened = SessionManager.open(sessionFile!)
      expect(reopened.getBranch().filter((entry) => entry.type === 'custom' && entry.customType === PROJECT_INSTRUCTION_STATE_TYPE)).toHaveLength(1)
      // Pi swallows a before_agent_start exception; adapter wiring must still
      // surface a terminal error before any provider transport is invoked.
      reopened.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, null)
      const corrupted: unknown[] = []
      for await (const message of adapter.query({ ...options, resumeSessionId })) corrupted.push(message)
      expect(requests[3]).toHaveLength(0)
      expect(JSON.stringify(corrupted)).toContain('未标记已加载')
    } finally {
      adapter.dispose()
      runtimeSpy.mockRestore()
      rmSync(base, { recursive: true, force: true })
    }
  })
}
