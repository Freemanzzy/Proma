import { join } from 'node:path'
import type { AgentExternalRunSource, AgentSendInput } from '@proma/shared'
import { getConfigDir } from './config-paths'
import { readJsonFileSafe } from './safe-file'
import { recordPersonalInfo } from './personal-log-writer'

export interface DelegationWakeRecord {
  delegationId: string
  parentSessionId: string
  title: string
  status: string
  channelId: string
  modelId?: string
  workspaceId?: string
  permissionMode?: AgentSendInput['permissionModeOverride']
}

interface ParentSession {
  channelId?: string
  modelId?: string
  workspaceId?: string
  permissionMode?: AgentSendInput['permissionModeOverride']
  archived?: boolean
  stoppedByUser?: boolean
}

interface WakeCallbacks {
  source: AgentExternalRunSource
  originSessionId: string
  onError: (error: string) => void
  onComplete: () => void
  onTitleUpdated: (title: string) => void
}

export interface DelegationWakeDependencies {
  enabled: () => boolean
  getParentSession: (sessionId: string) => ParentSession | undefined | Promise<ParentSession | undefined>
  isBusy: (sessionId: string) => boolean | Promise<boolean>
  runAgentHeadless: (input: AgentSendInput, callbacks: WakeCallbacks) => Promise<void>
  now?: () => number
  coalesceMs?: number
  pollMs?: number
  windowMs?: number
  maxPerHour?: number
  log?: (message: string) => void
}

const WINDOW_MS = 60 * 60 * 1000
const COALESCE_MS = 30_000
const MAX_PER_HOUR = 10

export function createPersonalDelegationWakeController(dependencies: DelegationWakeDependencies) {
  const now = dependencies.now ?? Date.now
  const coalesceMs = dependencies.coalesceMs ?? COALESCE_MS
  const pollMs = dependencies.pollMs ?? 1000
  const windowMs = dependencies.windowMs ?? WINDOW_MS
  const maxPerHour = dependencies.maxPerHour ?? MAX_PER_HOUR
  // 正常流转（wake/consumed/queued/run-completed 等）记信息级；只有启动或运行失败记 WARN。
  const logger = dependencies.log ?? ((message: string) => {
    if (/^(?:run-error|start-error|dependency-error)\b/.test(message)) console.warn(`[子任务唤醒] ${message}`)
    else recordPersonalInfo('子任务唤醒', message)
  })
  const consumed = new Set<string>()
  const pending = new Map<string, {
    records: DelegationWakeRecord[]
    readyAt: number
    running: boolean
    timer?: ReturnType<typeof setTimeout>
    polling?: ReturnType<typeof setInterval>
  }>()
  const wakeTimes = new Map<string, number[]>()

  function dropPending(parentSessionId: string, item: NonNullable<ReturnType<typeof pending.get>>): void {
    if (item.timer) clearTimeout(item.timer)
    if (item.polling) clearInterval(item.polling)
    pending.delete(parentSessionId)
  }

  function markConsumed(ids: string[]): void {
    for (const id of ids) consumed.add(id)
  }

  async function attempt(parentSessionId: string): Promise<void> {
    const item = pending.get(parentSessionId)
    if (!item || item.running || now() < item.readyAt) return
    item.running = true
    const log = (reason: string) => logger(`${reason}: parentSessionId=${parentSessionId}`)
    if (!dependencies.enabled()) { log('disabled'); dropPending(parentSessionId, item); return }

    let meta: ParentSession | undefined
    let busy: boolean
    try {
      meta = await dependencies.getParentSession(parentSessionId)
      busy = await dependencies.isBusy(parentSessionId)
    } catch (error) {
      item.running = false
      log(`dependency-error ${String(error).slice(0, 160)}`)
      if (!item.polling) item.polling = setInterval(() => { void attempt(parentSessionId) }, pollMs)
      return
    }
    if (!meta || meta.archived || !meta.channelId) { log('missing-or-archived'); dropPending(parentSessionId, item); return }
    if (meta.stoppedByUser) { log('stopped'); dropPending(parentSessionId, item); return }
    const ready = item.records.filter((record) => !consumed.has(record.delegationId))
    if (ready.length === 0) { log('consumed'); dropPending(parentSessionId, item); return }
    if (busy) {
      item.running = false
      log('queued')
      if (!item.polling) item.polling = setInterval(() => { void attempt(parentSessionId) }, pollMs)
      return
    }
    if (item.polling) clearInterval(item.polling)
    const currentTime = now()
    const recent = (wakeTimes.get(parentSessionId) ?? []).filter((time) => currentTime - time < windowMs)
    wakeTimes.set(parentSessionId, recent)
    if (recent.length >= maxPerHour) { log('rate-limited'); dropPending(parentSessionId, item); return }
    dropPending(parentSessionId, item)
    recent.push(currentTime)
    const notices = ready.map((record) => `- ${record.title}（${record.status}，delegationId=${record.delegationId}）`).join('\n')
    const userMessage = `【子任务完成·自动通知】以下协作子任务已结束：\n${notices}\n请用 get_delegation_results 读取结果，按原计划复核并继续；若无需继续，简要说明即可。`
    log(`wake count=${ready.length}`)
    try {
      await dependencies.runAgentHeadless({
        sessionId: parentSessionId,
        userMessage,
        channelId: meta.channelId,
        modelId: meta.modelId,
        workspaceId: meta.workspaceId,
        permissionModeOverride: meta.permissionMode,
        // 自动通知是无人值守来源，但父会话不是子会话，必须保留父 Agent 的协作与 MCP 工具。
        triggeredBy: 'external',
        startedAt: currentTime,
      }, {
        // 'bridge' produces the regular run_completed event and generic completion push,
        // while keeping renderer routing independent from delegation-child attention logic.
        source: 'bridge',
        originSessionId: parentSessionId,
        onError: (error) => logger(`run-error: parentSessionId=${parentSessionId} error=${String(error).slice(0, 200)}`),
        onComplete: () => logger(`run-completed: parentSessionId=${parentSessionId}`),
        onTitleUpdated: () => {},
      })
    } catch (error) {
      logger(`start-error: parentSessionId=${parentSessionId} error=${String(error).slice(0, 200)}`)
    }
  }

  function notifyFinished(record: DelegationWakeRecord): void {
    if (!dependencies.enabled()) { logger(`disabled: delegationId=${record.delegationId}`); return }
    if (consumed.has(record.delegationId)) { logger(`consumed: delegationId=${record.delegationId}`); return }
    let item = pending.get(record.parentSessionId)
    if (!item) {
      item = { records: [], readyAt: 0, running: false }
      pending.set(record.parentSessionId, item)
    }
    if (!item.records.some((entry) => entry.delegationId === record.delegationId)) item.records.push(record)
    item.readyAt = now() + coalesceMs
    if (item.timer) clearTimeout(item.timer)
    item.timer = setTimeout(() => { void attempt(record.parentSessionId) }, coalesceMs)
  }

  return { markConsumed, notifyFinished }
}

function isPersonalDelegationAutoWakeEnabled(): boolean {
  try {
    const settings = readJsonFileSafe<{ delegationAutoWake?: unknown }>(join(getConfigDir(), 'personal-settings.json'))
    return settings?.delegationAutoWake !== false
  } catch {
    return true
  }
}

const personalController = createPersonalDelegationWakeController({
  enabled: isPersonalDelegationAutoWakeEnabled,
  getParentSession: async (sessionId) => (await import('./agent-session-manager')).getAgentSessionMeta(sessionId),
  isBusy: async (sessionId) => (await import('./agent-service')).isAgentSessionBusy(sessionId),
  runAgentHeadless: async (input, callbacks) => (await import('./agent-service')).runAgentHeadless(input, callbacks),
})

export function markPersonalDelegationsConsumed(ids: string[]): void {
  personalController.markConsumed(ids)
}

export function notifyPersonalDelegationFinished(record: DelegationWakeRecord): void {
  personalController.notifyFinished(record)
}
