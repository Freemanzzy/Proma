import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Web Remote listener recovery', () => {
  test('complete keeps the existing single history refresh path for mobile events', () => {
    const listenerSource = readFileSync(join(import.meta.dir, 'useGlobalAgentListeners.ts'), 'utf8')
    const viewSource = readFileSync(join(import.meta.dir, '../components/agent/AgentView.tsx'), 'utf8')
    const start = listenerSource.indexOf('const cleanupComplete = window.electronAPI.onAgentStreamComplete(')
    const end = listenerSource.indexOf('// ===== 3. 流式错误 =====', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const handler = listenerSource.slice(start, end)
    expect(handler).not.toContain('data.messages')
    expect((handler.match(/bumpRefresh\(\)\s*;?/g) ?? [])).toHaveLength(1)
    expect(viewSource).toContain('window.electronAPI.getAgentSessionSDKMessages(sessionId)')
    expect(viewSource).toContain('[sessionId, refreshVersion,')
  })
  test('leaves the reconnect list snapshot to the sidebar resync listener', () => {
    const source = readFileSync(join(import.meta.dir, 'useGlobalAgentListeners.ts'), 'utf8')
    const start = source.indexOf('const recoverWebRemoteState = async (): Promise<void> => {')
    const end = source.indexOf('\n    }', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const recovery = source.slice(start, end)
    expect(recovery).toContain('restoreActiveSnapshots()')
    expect(recovery).toContain('restoreQueuedMessages()')
    expect(recovery).toContain('restorePendingRequests()')
    expect(recovery).not.toContain('restoreStoppedSessions()')
    expect(recovery).not.toContain('fetchAndMergeAgentSessionSnapshot()')
    expect(recovery).not.toMatch(/list(?:Active|Archived)?AgentSessions\(/)
  })
})
