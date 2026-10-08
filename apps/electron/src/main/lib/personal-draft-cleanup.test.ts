import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import { isUnusedDraftEligible, runUnusedDraftCleanup, UNUSED_DRAFT_MAX_AGE_MS, type DraftCleanupEvidence } from './personal-draft-cleanup-core'

const now = 1_800_000_000_000
const eligibleSession = (overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: '新 Agent 会话',
  createdAt: now - UNUSED_DRAFT_MAX_AGE_MS - 1,
  updatedAt: now - UNUSED_DRAFT_MAX_AGE_MS - 1,
  isDraft: true,
  ...overrides,
})
const emptyEvidence: DraftCleanupEvidence = { messageFileExists: false, workDirectoryState: 'missing' }

function eligible(session = eligibleSession(), evidence = emptyEvidence, clock = now): boolean {
  return isUnusedDraftEligible(session, evidence, clock, '新 Agent 会话')
}

describe('unused draft cleanup core', () => {
  test('removes an old empty default-title draft with no work directory', () => {
    expect(eligible()).toBe(true)
  })

  test('retains a non-draft session', () => expect(eligible(eligibleSession({ isDraft: false }))).toBe(false))
  test('retains a draft with a non-default title', () => expect(eligible(eligibleSession({ title: '用户命名' }))).toBe(false))
  test('retains a draft with a non-empty message file', () => expect(eligible(eligibleSession(), { messageFileExists: true, messageFileSize: 12, workDirectoryState: 'missing' })).toBe(false))
  test('retains a pinned draft', () => expect(eligible(eligibleSession({ pinned: true }))).toBe(false))
  test('retains an archived draft', () => expect(eligible(eligibleSession({ archived: true }))).toBe(false))
  test('retains a child session', () => expect(eligible(eligibleSession({ parentSessionId: 'parent' }))).toBe(false))
  test('retains a delegated session', () => expect(eligible(eligibleSession({ sourceDelegationId: 'delegation' }))).toBe(false))
  test('retains an automation session', () => expect(eligible(eligibleSession({ sourceAutomationId: 'automation' }))).toBe(false))
  test('retains a draft younger than 24 hours and uses the injected clock', () => {
    expect(eligible(eligibleSession({ createdAt: now - UNUSED_DRAFT_MAX_AGE_MS }), emptyEvidence, now)).toBe(false)
    expect(eligible(eligibleSession(), emptyEvidence, now + 2)).toBe(true)
  })
  test('retains a non-empty work directory and accepts an existing zero-byte JSONL', () => {
    expect(eligible(eligibleSession(), { messageFileExists: false, workDirectoryState: 'non-empty' })).toBe(false)
    expect(eligible(eligibleSession(), { messageFileExists: true, messageFileSize: 0, workDirectoryState: 'empty' })).toBe(true)
  })

  test('writes complete metadata to backup before deleting and reports failed deletion', () => {
    const removable = eligibleSession()
    const retainedByFailure = eligibleSession({ id: '22222222-2222-4222-8222-222222222222', workspaceId: 'ws', title: '' })
    const state = new Set([removable.id, retainedByFailure.id])
    let backup: AgentSessionMeta[] = []
    const logRows: Array<[number, number, string]> = []
    const result = runUnusedDraftCleanup({
      sessions: [removable, retainedByFailure],
      now,
      defaultTitle: '新 Agent 会话',
      inspect: () => emptyEvidence,
      writeBackup: (sessions, timestamp) => {
        expect(timestamp).toBe(now)
        backup = structuredClone(sessions)
        return 'draft-cleanup-test.json'
      },
      deleteSession: (id) => { if (id === removable.id) state.delete(id) },
      sessionStillExists: (id) => state.has(id),
      log: (removed, skipped, name) => logRows.push([removed, skipped, name]),
    })
    expect(backup).toEqual([removable, retainedByFailure])
    expect(result).toEqual({ removedIds: [removable.id], skippedIds: [retainedByFailure.id], backupName: 'draft-cleanup-test.json' })
    expect(logRows).toEqual([[1, 1, 'draft-cleanup-test.json']])
  })

  test('does not write a backup when no candidate exists', () => {
    let backupCalls = 0
    let logged = false
    const result = runUnusedDraftCleanup({
      sessions: [eligibleSession({ title: 'custom' })], now, defaultTitle: '新 Agent 会话',
      inspect: () => emptyEvidence,
      writeBackup: () => { backupCalls++; return 'never.json' },
      deleteSession: () => { throw new Error('must not delete') },
      sessionStillExists: () => true,
      log: (removed, skipped, name) => { logged = true; expect([removed, skipped, name]).toEqual([0, 0, '']) },
    })
    expect(result).toEqual({ removedIds: [], skippedIds: [] })
    expect(backupCalls).toBe(0)
    expect(logged).toBe(true)
  })
})
