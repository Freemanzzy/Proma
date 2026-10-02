import { describe, expect, test } from 'bun:test'
import type { AgentStreamState } from '@/atoms/agent-atoms'
import { findMissingActiveAgentSessionIds, settleMissingAgentStreamState } from './web-remote-recovery'

describe('Web Remote stale stream recovery', () => {
  test('ends locally running sessions absent from the snapshot and keeps sessions still active', () => {
    const localStates = new Map<string, AgentStreamState>([
      ['finished-during-disconnect', { running: true, startedAt: 10 }],
      ['still-running', { running: true, startedAt: 20 }],
      ['retrying-during-disconnect', { running: false, retrying: { phase: 'retrying' } as never }],
      ['background-waiting-during-disconnect', { running: false, backgroundWaiting: true }],
      ['already-idle', { running: false }],
    ])
    const missingIds = findMissingActiveAgentSessionIds(localStates, new Set(['still-running']))

    expect(missingIds).toEqual([
      'finished-during-disconnect',
      'retrying-during-disconnect',
      'background-waiting-during-disconnect',
    ])
    expect(settleMissingAgentStreamState(localStates.get('finished-during-disconnect'))).toMatchObject({
      running: false,
      retrying: undefined,
      backgroundWaiting: false,
      startedAt: 10,
    })
    expect(localStates.get('still-running')?.running).toBe(true)
  })
})
