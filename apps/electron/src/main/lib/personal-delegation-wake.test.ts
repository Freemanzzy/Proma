import { describe, expect, it } from 'bun:test'
import {
  createPersonalDelegationWakeController,
  type DelegationWakeDependencies,
  type DelegationWakeRecord,
} from './personal-delegation-wake'

const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
const record = (delegationId: string, status = 'completed'): DelegationWakeRecord => ({
  delegationId,
  parentSessionId: 'parent-1',
  title: `task-${delegationId}`,
  status,
  channelId: 'channel-1',
  modelId: 'model-1',
  workspaceId: 'workspace-1',
  permissionMode: 'bypassPermissions',
})

function makeHarness(overrides: Partial<DelegationWakeDependencies> = {}) {
  const calls: Array<{ input: Parameters<DelegationWakeDependencies['runAgentHeadless']>[0]; callbacks: Parameters<DelegationWakeDependencies['runAgentHeadless']>[1] }> = []
  const logs: string[] = []
  let busy = false
  let parent: NonNullable<Awaited<ReturnType<DelegationWakeDependencies['getParentSession']>>> = {
    channelId: 'channel-1', modelId: 'model-1', workspaceId: 'workspace-1', permissionMode: 'bypassPermissions',
  }
  let isEnabled = true
  const controller = createPersonalDelegationWakeController({
    enabled: () => isEnabled,
    getParentSession: () => parent,
    isBusy: () => busy,
    runAgentHeadless: async (input, callbacks) => { calls.push({ input, callbacks }) },
    coalesceMs: 8,
    pollMs: 4,
    log: (line) => logs.push(line),
    ...overrides,
  })
  return {
    controller,
    calls,
    logs,
    setBusy(value: boolean) { busy = value },
    setParent(value: typeof parent) { parent = value },
    setEnabled(value: boolean) { isEnabled = value },
  }
}

describe('personal delegation auto wake', () => {
  it('已收回终态结果时不唤醒', async () => {
    const h = makeHarness()
    h.controller.notifyFinished(record('consumed-id'))
    h.controller.markConsumed(['consumed-id'])
    await pause()
    expect(h.calls).toHaveLength(0)
    expect(h.logs.some((line) => line.includes('consumed:'))).toBe(true)
  })

  it('收回结果后 continue_delegation 重跑，再次完成时仍会唤醒', async () => {
    const h = makeHarness()
    h.controller.markConsumed(['continued-id'])
    h.controller.markRestarted('continued-id')
    h.controller.notifyFinished(record('continued-id'))
    await pause()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]?.input.userMessage).toContain('continued-id')
  })

  it('父会话 stoppedByUser 时不唤醒', async () => {
    const h = makeHarness()
    h.setParent({ channelId: 'channel-1', stoppedByUser: true })
    h.controller.notifyFinished(record('stopped-id'))
    await pause()
    expect(h.calls).toHaveLength(0)
    expect(h.logs.some((line) => line.includes('stopped:'))).toBe(true)
  })

  it('开关关闭时不唤醒', async () => {
    const h = makeHarness()
    h.setEnabled(false)
    h.controller.notifyFinished(record('disabled-id'))
    await pause()
    expect(h.calls).toHaveLength(0)
    expect(h.logs.some((line) => line.includes('disabled:'))).toBe(true)
  })

  it('父会话忙碌时延后到空闲再唤醒', async () => {
    const h = makeHarness()
    h.setBusy(true)
    h.controller.notifyFinished(record('busy-id'))
    await pause(14)
    expect(h.calls).toHaveLength(0)
    h.setBusy(false)
    await pause(14)
    expect(h.calls).toHaveLength(1)
    expect(h.logs.some((line) => line.includes('queued:'))).toBe(true)
  })

  it('合并同一父会话短时间内完成的委派', async () => {
    const h = makeHarness()
    h.controller.notifyFinished(record('batch-a'))
    await pause(3)
    h.controller.notifyFinished(record('batch-b', 'failed'))
    await pause(18)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]!.input.userMessage).toContain('batch-a')
    expect(h.calls[0]!.input.userMessage).toContain('batch-b')
    expect(h.calls[0]!.input.userMessage).toContain('failed')
  })

  it('每小时最多唤醒十次', async () => {
    const h = makeHarness()
    for (let index = 0; index < 11; index++) {
      h.controller.notifyFinished(record(`rate-${index}`))
      await pause(12)
    }
    expect(h.calls).toHaveLength(10)
    expect(h.logs.some((line) => line.includes('rate-limited:'))).toBe(true)
  })

  it('failed 与 cancelled 终态均唤醒并在消息中标明状态', async () => {
    const h = makeHarness()
    h.controller.notifyFinished(record('failed-id', 'failed'))
    await pause(12)
    h.controller.notifyFinished(record('cancelled-id', 'cancelled'))
    await pause(12)
    expect(h.calls).toHaveLength(2)
    expect(h.calls[0]!.input.userMessage).toContain('failed')
    expect(h.calls[1]!.input.userMessage).toContain('cancelled')
  })

  it('唤醒轮次使用 external 身份及普通 bridge 完成来源', async () => {
    const h = makeHarness()
    h.controller.notifyFinished(record('identity-id'))
    await pause(12)
    expect(h.calls[0]!.input.triggeredBy).toBe('external')
    expect(h.calls[0]!.callbacks.source).toBe('bridge')
    expect(h.calls[0]!.input).toMatchObject({
      sessionId: 'parent-1', channelId: 'channel-1', modelId: 'model-1',
      workspaceId: 'workspace-1', permissionModeOverride: 'bypassPermissions',
    })
  })
})
