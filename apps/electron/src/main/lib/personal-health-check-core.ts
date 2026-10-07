const SCHEDULER_HEARTBEAT_INTERVAL_MS = 10 * 60_000
const SCHEDULER_STALE_MS = 2 * 60_000
const AUTOMATION_OVERDUE_MS = 10 * 60_000
const WEB_REMOTE_REPAIR_COOLDOWN_MS = 30 * 60_000
const AUTOMATION_OVERDUE_ALERT_COOLDOWN_MS = 60 * 60_000

export interface PersonalHealthSnapshot {
  webRemoteEnabled: boolean
  webRemoteListening: boolean
  webRemotePort: number
  schedulerLastTickAt: number
  activeAutomations: Array<{ id: string; nextRunAt: number }>
}

export type PersonalHealthFinding =
  | { type: 'web-remote-not-listening'; port: number }
  | { type: 'scheduler-tick-stale'; ageMs: number }
  | { type: 'automation-overdue'; id: string; overdueMinutes: number }

export function evaluatePersonalHealth(snapshot: PersonalHealthSnapshot, now: number): PersonalHealthFinding[] {
  const findings: PersonalHealthFinding[] = []
  if (snapshot.webRemoteEnabled && !snapshot.webRemoteListening) {
    findings.push({ type: 'web-remote-not-listening', port: snapshot.webRemotePort })
  }
  const ageMs = snapshot.schedulerLastTickAt > 0 ? now - snapshot.schedulerLastTickAt : Number.POSITIVE_INFINITY
  if (ageMs > SCHEDULER_STALE_MS) findings.push({ type: 'scheduler-tick-stale', ageMs })
  for (const automation of snapshot.activeAutomations) {
    const overdueMs = now - automation.nextRunAt
    if (overdueMs > AUTOMATION_OVERDUE_MS) {
      findings.push({ type: 'automation-overdue', id: automation.id, overdueMinutes: Math.floor(overdueMs / 60_000) })
    }
  }
  return findings
}

export function shouldAttemptWebRemoteRepair(lastAttemptAt: number, now: number): boolean {
  return now - lastAttemptAt >= WEB_REMOTE_REPAIR_COOLDOWN_MS
}

export function shouldWriteSchedulerHeartbeat(lastHeartbeatAt: number, now: number, intervalMs = SCHEDULER_HEARTBEAT_INTERVAL_MS): boolean {
  return now - lastHeartbeatAt >= intervalMs
}

export function shouldLogAutomationOverdue(
  lastAlertAtById: Map<string, number>,
  automationId: string,
  now: number,
): boolean {
  const lastAlertAt = lastAlertAtById.get(automationId)
  if (lastAlertAt !== undefined && now - lastAlertAt < AUTOMATION_OVERDUE_ALERT_COOLDOWN_MS) return false
  lastAlertAtById.set(automationId, now)
  return true
}
