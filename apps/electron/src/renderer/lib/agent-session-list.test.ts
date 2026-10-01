import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta, AgentSessionMetadataChange } from '@proma/shared'
import {
  acceptAgentSessionMetadataChange,
  applyAgentSessionMetadataChange,
  getAgentSessionMetadataRevision,
  mergeAgentSessionSnapshotWithChanges,
  recordAgentSessionMetadataChange,
  shouldRefreshUnknownAgentSession,
  upsertAgentSession,
  type AgentSessionMetadataEventCursor,
} from './agent-session-list'

const session = (overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta => ({
  id: 'session-1', title: 'before', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1, ...overrides,
})
const change = (overrides: Partial<AgentSessionMetadataChange> = {}): AgentSessionMetadataChange => ({
  epoch: 'boot-a', sequence: 1, action: 'upsert', workspaceId: 'workspace-a',
  session: { id: 'session-1', title: 'after', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 2 },
  ...overrides,
})

describe('Agent session metadata synchronization', () => {
  test('Web Remote throttles repeated unknown session refreshes and remembers invisible IDs', () => {
    const state = { lastAttemptAt: new Map<string, number>(), knownInvisibleSessionIds: new Set<string>() }
    const options = { sessionId: 'session-unknown', isWebRemote: true, state }
    expect(shouldRefreshUnknownAgentSession({ ...options, now: 1_000 })).toBe(true)
    expect(shouldRefreshUnknownAgentSession({ ...options, now: 60_999 })).toBe(false)
    expect(shouldRefreshUnknownAgentSession({ ...options, now: 61_000 })).toBe(true)
    state.knownInvisibleSessionIds.add('session-unknown')
    expect(shouldRefreshUnknownAgentSession({ ...options, now: 200_000 })).toBe(false)
  })

  test('desktop unknown session refresh path is not throttled by Web Remote state', () => {
    const state = { lastAttemptAt: new Map<string, number>(), knownInvisibleSessionIds: new Set<string>(['session-unknown']) }
    const options = { sessionId: 'session-unknown', isWebRemote: false, state }
    expect(shouldRefreshUnknownAgentSession({ ...options, now: 1_000 })).toBe(true)
    expect(shouldRefreshUnknownAgentSession({ ...options, now: 1_001 })).toBe(true)
    expect(state.lastAttemptAt.size).toBe(0)
  })
  test('accepts a new boot at sequence 1 but rejects delayed events from a retired epoch', () => {
    const cursor: AgentSessionMetadataEventCursor = { epoch: null, sequence: 0, retiredEpochs: new Set() }
    expect(acceptAgentSessionMetadataChange(cursor, change({ epoch: 'boot-a', sequence: 12 }))).toBe(true)
    expect(acceptAgentSessionMetadataChange(cursor, change({ epoch: 'boot-a', sequence: 11 }))).toBe(false)
    expect(acceptAgentSessionMetadataChange(cursor, change({ epoch: 'boot-b', sequence: 1 }))).toBe(true)
    expect(cursor).toMatchObject({ epoch: 'boot-b', sequence: 1 })
    expect(cursor.retiredEpochs.has('boot-a')).toBe(true)
    expect(acceptAgentSessionMetadataChange(cursor, change({ epoch: 'boot-a', sequence: 13 }))).toBe(false)
    expect(cursor).toMatchObject({ epoch: 'boot-b', sequence: 1 })
    expect(acceptAgentSessionMetadataChange(cursor, change({ epoch: 'boot-b', sequence: 2 }))).toBe(true)
  })

  test('upsert/archive/restore/remove deltas update the complete local sidebar cache', () => {
    const active = [session(), session({ id: 'session-2', title: 'other', createdAt: 2, updatedAt: 2 })]
    const renamed = applyAgentSessionMetadataChange(active, change(), false)
    expect(renamed.find((item) => item.id === 'session-1')?.title).toBe('after')
    const archived = applyAgentSessionMetadataChange(renamed, change({ session: { ...change().session, archived: true } }), false)
    expect(archived.some((item) => item.id === 'session-1')).toBe(false)
    const archiveView = applyAgentSessionMetadataChange(renamed, change({ session: { ...change().session, archived: true } }), true)
    expect(archiveView.find((item) => item.id === 'session-1')?.archived).toBe(true)
    const restored = applyAgentSessionMetadataChange(archiveView, change({ session: { ...change().session, archived: false, updatedAt: 3 } }), true)
    expect(restored.find((item) => item.id === 'session-1')?.archived).toBe(false)
    const removed = applyAgentSessionMetadataChange(restored, change({ action: 'remove', session: { id: 'session-1' } }), true)
    expect(removed.some((item) => item.id === 'session-1')).toBe(false)
    expect(removed.some((item) => item.id === 'session-2')).toBe(true)
  })

  test('cleared classification fields disappear instead of surviving the metadata merge', () => {
    const existing = [session({ sourceAutomationId: 'automation-1', parentSessionId: 'parent-1', sourceDelegationId: 'delegation-1' })]
    const update = change({ clearedFields: ['sourceAutomationId', 'parentSessionId', 'sourceDelegationId'] })
    const merged = applyAgentSessionMetadataChange(existing, update, false)
    expect(merged[0]).not.toHaveProperty('sourceAutomationId')
    expect(merged[0]).not.toHaveProperty('parentSessionId')
    expect(merged[0]).not.toHaveProperty('sourceDelegationId')
  })

  test('a rename received after snapshot start overrides the late old snapshot', () => {
    const snapshotRevision = getAgentSessionMetadataRevision()
    recordAgentSessionMetadataChange(change({ epoch: 'rename-after-snapshot', sequence: 1, session: { ...change().session, title: 'new title', updatedAt: 10 } }))
    const staleSnapshot = [session({ title: 'old title', updatedAt: 2 })]
    const reconciled = mergeAgentSessionSnapshotWithChanges([], staleSnapshot, snapshotRevision, true)
    expect(reconciled.find((item) => item.id === 'session-1')?.title).toBe('new title')
  })

  test('workspace-scope remove tombstone clears when the same session is restored', () => {
    const snapshotRevision = getAgentSessionMetadataRevision()
    recordAgentSessionMetadataChange(change({ epoch: 'move-out-boot', sequence: 1, action: 'remove', workspaceId: 'workspace-a', session: { id: 'session-1' } }))
    const staleSnapshot = [session()]
    const reconciled = mergeAgentSessionSnapshotWithChanges(staleSnapshot, staleSnapshot, snapshotRevision, false)
    expect(reconciled.some((item) => item.id === 'session-1')).toBe(false)
    expect(upsertAgentSession(staleSnapshot, session({ title: 'late stale upsert' })).some((item) => item.id === 'session-1')).toBe(false)
    recordAgentSessionMetadataChange(change({ epoch: 'move-back-boot', sequence: 1, session: { ...change().session, title: 'restored in authorized workspace' } }))
    const restored = mergeAgentSessionSnapshotWithChanges([], [], snapshotRevision, false)
    expect(restored.find((item) => item.id === 'session-1')?.title).toBe('restored in authorized workspace')
    expect(upsertAgentSession([], session({ title: 'restored in authorized workspace' })).some((item) => item.id === 'session-1')).toBe(true)
  })

  test('LeftSidebar cursor and global journal accept the same event in either listener order', () => {
    const replayInOrder = (epoch: string, recordFirst: boolean): string | undefined => {
      const snapshotRevision = getAgentSessionMetadataRevision()
      const cursor: AgentSessionMetadataEventCursor = { epoch: null, sequence: 0, retiredEpochs: new Set() }
      const event = change({ epoch, sequence: 1, session: { ...change().session, title: `title-${epoch}`, updatedAt: 2 } })
      if (recordFirst) {
        recordAgentSessionMetadataChange(event)
        expect(acceptAgentSessionMetadataChange(cursor, event)).toBe(true)
      } else {
        expect(acceptAgentSessionMetadataChange(cursor, event)).toBe(true)
        recordAgentSessionMetadataChange(event)
      }
      const reconciled = mergeAgentSessionSnapshotWithChanges([session({ title: 'stale' })], [session({ title: 'stale' })], snapshotRevision, true)
      return reconciled.find((item) => item.id === 'session-1')?.title
    }

    expect(replayInOrder('cursor-first', false)).toBe('title-cursor-first')
    expect(replayInOrder('journal-first', true)).toBe('title-journal-first')
  })

  test('bounded event/tombstone retention fails closed for snapshots older than the journal floor', () => {
    const snapshotRevision = getAgentSessionMetadataRevision()
    for (let sequence = 1; sequence <= 8_200; sequence++) {
      recordAgentSessionMetadataChange(change({
        epoch: 'retention-boot', sequence, action: 'remove',
        session: { id: `deleted-${sequence}` },
      }))
    }
    const staleSnapshot = [session({ id: 'stale-snapshot-only' })]
    const reconciled = mergeAgentSessionSnapshotWithChanges([], staleSnapshot, snapshotRevision, false)
    expect(reconciled.some((item) => item.id === 'stale-snapshot-only')).toBe(false)
  })

  test('draft upserts stay hidden until the main process promotes them', () => {
    const existing: AgentSessionMeta[] = [session({ id: 'session-2' })]
    const draft = change({ session: { ...change().session, isDraft: true } })
    const hidden = applyAgentSessionMetadataChange(existing, draft, false)
    expect(hidden.some((item) => item.id === 'session-1')).toBe(false)
    const promoted = applyAgentSessionMetadataChange(hidden, change({ session: { ...change().session, isDraft: false } }), false)
    expect(promoted.some((item) => item.id === 'session-1')).toBe(true)
  })
})
