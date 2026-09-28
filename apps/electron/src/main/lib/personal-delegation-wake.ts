import { join } from 'node:path'
import { getConfigDir } from './config-paths'
import { readJsonFileSafe } from './safe-file'

export interface DelegationWakeRecord {
  delegationId: string
  parentSessionId: string
  title: string
  status: string
  channelId: string
  modelId?: string
  workspaceId?: string
  permissionMode?: string
}

const WINDOW_MS = 60 * 60 * 1000
const COALESCE_MS = 30_000
const MAX_PER_HOUR = 10
const consumed = new Set<string>()
const pending = new Map<string, { records: DelegationWakeRecord[]; readyAt: number; running?: boolean; timer?: ReturnType<typeof setTimeout>; polling?: ReturnType<typeof setInterval> }>()
const wakeTimes = new Map<string, number[]>()

function dropPending(parentSessionId: string, item: NonNullable<ReturnType<typeof pending.get>>): void {
  if (item.timer) clearTimeout(item.timer)
  if (item.polling) clearInterval(item.polling)
  pending.delete(parentSessionId)
}

function enabled(): boolean {
  try {
    const settings = readJsonFileSafe<{ delegationAutoWake?: unknown }>(join(getConfigDir(), 'personal-settings.json'))
    return settings?.delegationAutoWake !== false
  } catch {
    return true
  }
}

export function markPersonalDelegationsConsumed(ids: string[]): void {
  for (const id of ids) consumed.add(id)
}

async function attempt(parentSessionId: string): Promise<void> {
  const item = pending.get(parentSessionId)
  if (!item || item.running) return
  if (Date.now() < item.readyAt) return
  item.running = true
  const log = (reason: string) => console.warn(`[子任务唤醒] ${reason}: parentSessionId=${parentSessionId}`)
  if (!enabled()) { log('disabled'); dropPending(parentSessionId, item); return }

  let getAgentSessionMeta: typeof import('./agent-session-manager').getAgentSessionMeta
  let isAgentSessionBusy: typeof import('./agent-service').isAgentSessionBusy
  let runAgentHeadless: typeof import('./agent-service').runAgentHeadless
  try {
    const [sessionManager, agentService] = await Promise.all([import('./agent-session-manager'), import('./agent-service')])
    getAgentSessionMeta = sessionManager.getAgentSessionMeta
    isAgentSessionBusy = agentService.isAgentSessionBusy
    runAgentHeadless = agentService.runAgentHeadless
  } catch (error) {
    item.running = false
    log(`dependency-error ${String(error).slice(0, 160)}`)
    if (!item.polling) item.polling = setInterval(() => { void attempt(parentSessionId) }, 1000)
    return
  }
  const meta = getAgentSessionMeta(parentSessionId)
  if (!meta || meta.archived || !meta.channelId) { log('missing-or-archived'); dropPending(parentSessionId, item); return }
  if (meta.stoppedByUser) { log('stopped'); dropPending(parentSessionId, item); return }
  const ready = item.records.filter((record) => !consumed.has(record.delegationId))
  if (ready.length === 0) { log('consumed'); dropPending(parentSessionId, item); return }
  if (isAgentSessionBusy(parentSessionId)) {
    item.running = false
    log('queued');
    if (!item.polling) item.polling = setInterval(() => { void attempt(parentSessionId) }, 1000)
    return
  }
  if (item.polling) clearInterval(item.polling)
  const now = Date.now()
  const recent = (wakeTimes.get(parentSessionId) ?? []).filter((time) => now - time < WINDOW_MS)
  wakeTimes.set(parentSessionId, recent)
  if (recent.length >= MAX_PER_HOUR) { log('rate-limited'); dropPending(parentSessionId, item); return }
  dropPending(parentSessionId, item)
  recent.push(now)
  const notices = ready.map((record) => `- ${record.title}（${record.status}，delegationId=${record.delegationId}）`).join('\n')
  const userMessage = `【子任务完成·自动通知】以下协作子任务已结束：\n${notices}\n请用 get_delegation_results 读取结果，按原计划复核并继续；若无需继续，简要说明即可。`
  log(`wake count=${ready.length}`)
  try {
    await runAgentHeadless({
      sessionId: parentSessionId,
      userMessage,
      channelId: meta.channelId,
      modelId: meta.modelId,
      workspaceId: meta.workspaceId,
      permissionModeOverride: meta.permissionMode,
      triggeredBy: 'delegation',
      startedAt: now,
    }, {
      source: 'delegation',
      originSessionId: parentSessionId,
      onError: (error) => console.warn(`[子任务唤醒] run-error: ${String(error).slice(0, 200)}`),
      onComplete: () => {},
      onTitleUpdated: () => {},
    })
  } catch (error) {
    console.warn(`[子任务唤醒] start-error: ${String(error).slice(0, 200)}`)
  }
}

export function notifyPersonalDelegationFinished(record: DelegationWakeRecord): void {
  if (!enabled()) { console.warn(`[子任务唤醒] disabled: delegationId=${record.delegationId}`); return }
  if (consumed.has(record.delegationId)) { console.warn(`[子任务唤醒] consumed: delegationId=${record.delegationId}`); return }
  let item = pending.get(record.parentSessionId)
  if (!item) {
    item = { records: [], readyAt: 0 }
    pending.set(record.parentSessionId, item)
  }
  if (!item.records.some((entry) => entry.delegationId === record.delegationId)) item.records.push(record)
  item.readyAt = Date.now() + COALESCE_MS
  if (item.timer) clearTimeout(item.timer)
  item.timer = setTimeout(() => { void attempt(record.parentSessionId) }, COALESCE_MS)
}
