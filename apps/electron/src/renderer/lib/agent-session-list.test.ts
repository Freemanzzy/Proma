import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta, AgentSessionMetadataChange } from '@proma/shared'
import {
  acceptAgentSessionMetadataChange,
  applyAgentSessionMetadataChange,
  getAgentSessionMetadataRevision,
  mergeAgentSessionSnapshotWithChanges,
  recordAgentSessionMetadataChange,
  resetAgentSessionMetadataEventCursor,
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
  test('accepts increasing sequence numbers, resets on a new main-process epoch, and resets for authority refresh', () => {
    const cursor: AgentSessionMetadataEventCursor = { epoch: null, sequence: 0 }
    expect(acceptAgentSessionMetadataChange(cursor, change({ sequence: 12 }))).toBe(true)
    expect(acceptAgentSessionMetadataChange(cursor, change({ sequence: 11 }))).toBe(false)
    expect(acceptAgentSessionMetadataChange(cursor, change({ epoch: 'boot-b', sequence: 1 }))).toBe(true)
    expect(cursor).toEqual({ epoch: 'boot-b', sequence: 1 })
    resetAgentSessionMetadataEventCursor(cursor)
    expect(cursor).toEqual({ epoch: null, sequence: 0 })
    expect(acceptAgentSessionMetadataChange(cursor, change({ epoch: 'boot-c', sequence: 1 }))).toBe(true)
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

  test('replaying changes received during a stale full snapshot preserves a later deletion', () => {
    const snapshotRevision = getAgentSessionMetadataRevision()
    recordAgentSessionMetadataChange(change({ action: 'remove', session: { id: 'session-1' }, sequence: 4 }))
    const staleSnapshot = [session()]
    const reconciled = mergeAgentSessionSnapshotWithChanges(staleSnapshot, staleSnapshot, snapshotRevision, false)
    expect(reconciled.some((item) => item.id === 'session-1')).toBe(false)
    expect(upsertAgentSession(staleSnapshot, session({ title: 'late stale upsert' })).some((item) => item.id === 'session-1')).toBe(false)
    recordAgentSessionMetadataChange(change({ epoch: 'retention-boot', sequence: 8_201, session: { ...change().session, title: 'recreated after authority event' } }))
    expect(upsertAgentSession([], session({ title: 'recreated after authority event' })).some((item) => item.id === 'session-1')).toBe(true)
  })

  test('LeftSidebar cursor and global journal accept the same event in either listener order', () => {
    const replayInOrder = (epoch: string, recordFirst: boolean): string | undefined => {
      const snapshotRevision = getAgentSessionMetadataRevision()
      const cursor: AgentSessionMetadataEventCursor = { epoch: null, sequence: 0 }
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
