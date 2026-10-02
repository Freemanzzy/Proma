import type { AgentStreamState } from '@/atoms/agent-atoms'

export function findMissingActiveAgentSessionIds(
  localStates: ReadonlyMap<string, AgentStreamState>,
  activeSessionIds: ReadonlySet<string>,
): string[] {
  return [...localStates.entries()]
    .filter(([sessionId, state]) => (
      (state.running || state.retrying !== undefined || state.backgroundWaiting === true)
      && !activeSessionIds.has(sessionId)
    ))
    .map(([sessionId]) => sessionId)
}

export function settleMissingAgentStreamState(state: AgentStreamState | undefined): AgentStreamState | undefined {
  if (!state) return state
  return {
    ...state,
    running: false,
    retrying: undefined,
    backgroundWaiting: false,
  }
}
