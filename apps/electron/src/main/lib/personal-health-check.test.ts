import { describe, expect, test } from 'bun:test'
import { evaluatePersonalHealth, shouldAttemptWebRemoteRepair, shouldLogAutomationOverdue, shouldWriteSchedulerHeartbeat } from './personal-health-check-core'

describe('personal background health checks', () => {
  const now = 1_800_000_000_000
  const healthy = {
    webRemoteEnabled: false,
    webRemoteListening: true,
    webRemotePort: 17888,
    schedulerLastTickAt: now - 30_000,
    activeAutomations: [],
  }

  test('detects enabled Web Remote without a listener', () => {
    expect(evaluatePersonalHealth({ ...healthy, webRemoteEnabled: true, webRemoteListening: false }, now)).toEqual([
      { type: 'web-remote-not-listening', port: 17888 },
    ])
  })

  test('detects a scheduler tick older than two minutes without running tasks', () => {
    expect(evaluatePersonalHealth({ ...healthy, schedulerLastTickAt: now - 121_000 }, now)).toEqual([
      { type: 'scheduler-tick-stale', ageMs: 121_000 },
    ])
  })

  test('reports enabled tasks overdue by more than ten minutes without changing nextRunAt', () => {
    const nextRunAt = now - 11 * 60_000
    const tasks = [{ id: 'auto-1', nextRunAt }]
    const findings = evaluatePersonalHealth({ ...healthy, activeAutomations: tasks }, now)
    expect(findings).toEqual([{ type: 'automation-overdue', id: 'auto-1', overdueMinutes: 11 }])
    expect(tasks[0]?.nextRunAt).toBe(nextRunAt)
  })

  test('limits Web Remote repair to one attempt per thirty minutes', () => {
    expect(shouldAttemptWebRemoteRepair(now, now + 29 * 60_000)).toBe(false)
    expect(shouldAttemptWebRemoteRepair(now, now + 30 * 60_000)).toBe(true)
  })

  test('suppresses repeat overdue warnings for the same task until sixty minutes pass', () => {
    const lastAlertAtById = new Map<string, number>()
    expect(shouldLogAutomationOverdue(lastAlertAtById, 'auto-1', now)).toBe(true)
    expect(shouldLogAutomationOverdue(lastAlertAtById, 'auto-1', now + 5 * 60_000)).toBe(false)
    expect(shouldLogAutomationOverdue(lastAlertAtById, 'auto-2', now + 5 * 60_000)).toBe(true)
    expect(shouldLogAutomationOverdue(lastAlertAtById, 'auto-1', now + 60 * 60_000)).toBe(true)
  })

  test('scheduler heartbeat is suppressed until ten minutes have elapsed', () => {
    expect(shouldWriteSchedulerHeartbeat(now, now + 9 * 60_000)).toBe(false)
    expect(shouldWriteSchedulerHeartbeat(now, now + 10 * 60_000)).toBe(true)
  })
})
