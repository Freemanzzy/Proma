import { listAutomations } from './automation-manager'
import { getSchedulerLastTickAt, restartSchedulerTickTimer } from './automation-scheduler'
import { recordPersonalInfo } from './personal-log-writer'
import { getWebRemoteHealthState, startWebRemoteIfEnabled } from './web-remote/web-remote-service'
import { evaluatePersonalHealth, shouldAttemptWebRemoteRepair, shouldLogAutomationOverdue, type PersonalHealthFinding } from './personal-health-check-core'

const INITIAL_DELAY_MS = 2 * 60_000
const CHECK_INTERVAL_MS = 5 * 60_000
export { evaluatePersonalHealth, shouldAttemptWebRemoteRepair } from './personal-health-check-core'
export type { PersonalHealthFinding, PersonalHealthSnapshot } from './personal-health-check-core'

let startupTimer: NodeJS.Timeout | undefined
let checkTimer: NodeJS.Timeout | undefined
let lastWebRemoteRepairAt = Number.NEGATIVE_INFINITY
const lastAutomationOverdueAlertAt = new Map<string, number>()

export function runPersonalHealthCheck(now = Date.now()): PersonalHealthFinding[] {
  const remote = getWebRemoteHealthState()
  const automations = listAutomations()
  const findings = evaluatePersonalHealth({
    webRemoteEnabled: remote.enabled,
    webRemoteListening: remote.listening,
    webRemotePort: remote.port,
    schedulerLastTickAt: getSchedulerLastTickAt(),
    activeAutomations: automations.filter((automation) => automation.active).map(({ id, nextRunAt }) => ({ id, nextRunAt })),
  }, now)
  for (const finding of findings) {
    if (finding.type === 'web-remote-not-listening') {
      console.warn(`[服务诊断] event=web-remote-listener-missing port=${finding.port}`)
      if (shouldAttemptWebRemoteRepair(lastWebRemoteRepairAt, now)) {
        lastWebRemoteRepairAt = now
        recordPersonalInfo('服务诊断', `event=web-remote-repair-attempt port=${finding.port} cooldownMinutes=30`)
        void startWebRemoteIfEnabled().catch((error) => console.warn('[服务诊断] Web Remote 自愈启动失败', error))
      }
    } else if (finding.type === 'scheduler-tick-stale') {
      console.warn(`[服务诊断] event=scheduler-tick-stale ageMs=${Number.isFinite(finding.ageMs) ? finding.ageMs : 'never'} action=restart-timer`)
      restartSchedulerTickTimer()
    } else if (shouldLogAutomationOverdue(lastAutomationOverdueAlertAt, finding.id, now)) {
      console.warn(`[服务诊断] event=automation-overdue id=${finding.id} overdueMinutes=${finding.overdueMinutes} action=observe-only`)
    }
  }
  return findings
}

export function startPersonalHealthCheck(): void {
  if (startupTimer || checkTimer) return
  startupTimer = setTimeout(() => {
    startupTimer = undefined
    runPersonalHealthCheck()
    checkTimer = setInterval(() => runPersonalHealthCheck(), CHECK_INTERVAL_MS)
    checkTimer.unref?.()
  }, INITIAL_DELAY_MS)
  startupTimer.unref?.()
}

export function stopPersonalHealthCheck(): void {
  if (startupTimer) clearTimeout(startupTimer)
  if (checkTimer) clearInterval(checkTimer)
  startupTimer = undefined
  checkTimer = undefined
}
