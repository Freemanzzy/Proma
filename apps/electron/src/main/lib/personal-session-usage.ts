/**
 * 会话用量统计；口径须与 scripts/personal/usage-cost-report.py 同步。
 * 本模块仅返回汇总，不读取渠道配置，也不暴露消息正文或文件路径。
 */
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs'
import { getAgentSessionMessagesPath, getAgentSessionsIndexPath } from './config-paths'

export interface SessionUsageTotals {
  requests: number; input: number; output: number; cacheRead: number; cacheWrite: number
  largeCacheRebuilds: number; relativeCostIndex: number; cacheHitRate: number
}
export interface SessionUsageSummary {
  session: SessionUsageTotals
  lastRequest: { cacheWrite: number; cacheHitRate: number; largeCacheRebuild: boolean } | null
  children: SessionUsageTotals | null
}
interface RequestRecord { id: string; input: number; output: number; cacheRead: number; cacheWrite: number }
interface FileState { offset: number; remainder: Buffer; identity: string; size: number; mtimeMs: number; records: RequestRecord[]; seen: Set<string> }
const states = new Map<string, FileState>()
const EMPTY: SessionUsageTotals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, largeCacheRebuilds: 0, relativeCostIndex: 0, cacheHitRate: 0 }
const aliases = {
  input: ['input_tokens', 'inputTokens', 'prompt_tokens'], output: ['output_tokens', 'outputTokens', 'completion_tokens'],
  cacheRead: ['cache_read_input_tokens', 'cacheReadInputTokens', 'cached_tokens'],
  cacheWrite: ['cache_creation_input_tokens', 'cacheCreationInputTokens', 'cache_creation_tokens'],
} as const
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0 }
function usageValues(usage: Record<string, unknown>) {
  const details = (usage.prompt_tokens_details || usage.input_tokens_details || {}) as Record<string, unknown>
  const values = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, num(names.map(n => usage[n]).find(v => v !== undefined) ?? (key === 'cacheRead' ? details.cached_tokens : 0))])) as Record<keyof typeof aliases, number>
  if (usage.input_tokens === undefined && usage.inputTokens === undefined && usage.prompt_tokens !== undefined) values.input = Math.max(0, values.input - values.cacheRead)
  return values
}
function resetState(identity: string): FileState { return { offset: 0, remainder: Buffer.alloc(0), identity, size: 0, mtimeMs: 0, records: [], seen: new Set() } }
function acceptCompleteLine(state: FileState, line: Buffer): void {
  if (!line.length) return
  let row: any
  try { row = JSON.parse(line.toString('utf8')) } catch { return }
  const message = row?.type === 'assistant' ? row.message : undefined
  if (!message || !message.usage || typeof message.usage !== 'object' || Array.isArray(message.usage) || Object.keys(message.usage).length === 0) return
  const v = usageValues(message.usage)
  if (message.id) {
    const key = `${message.id}:${v.input},${v.output},${v.cacheRead},${v.cacheWrite}`
    if (state.seen.has(key)) return
    state.seen.add(key)
  }
  state.records.push({ id: String(message.id || ''), ...v })
}
function recordsForPath(sessionId: string, filePath: string): RequestRecord[] {
  let fd: number
  try { fd = openSync(filePath, 'r') } catch { states.delete(sessionId); return [] }
  try {
    const stat = fstatSync(fd)
    const identity = `${stat.dev}:${stat.ino}`
    let state = states.get(sessionId)
    // Same-inode rewrite with unchanged/shorter length, replacement inode, or file disappearance resets all aggregates.
    if (!state || state.identity !== identity || stat.size < state.offset || (stat.size === state.offset && state.size === stat.size && stat.mtimeMs !== state.mtimeMs)) state = resetState(identity)
    if (stat.size > state.offset) {
      const buf = Buffer.alloc(stat.size - state.offset)
      const count = readSync(fd, buf, 0, buf.length, state.offset)
      const text = Buffer.concat([state.remainder, buf.subarray(0, count)])
      const newline = 0x0a
      let start = 0
      for (let i = 0; i < text.length; i++) if (text[i] === newline) { acceptCompleteLine(state, text.subarray(start, i)); start = i + 1 }
      state.remainder = Buffer.from(text.subarray(start))
      state.offset += count
    }
    state.size = stat.size
    state.mtimeMs = stat.mtimeMs
    states.set(sessionId, state)
    return state.records
  } finally { closeSync(fd) }
}
function totals(records: RequestRecord[]): SessionUsageTotals {
  const value = { ...EMPTY }
  for (const r of records) {
    value.requests++; value.input += r.input; value.output += r.output; value.cacheRead += r.cacheRead; value.cacheWrite += r.cacheWrite
    if (r.cacheWrite >= 300_000) value.largeCacheRebuilds++
    value.relativeCostIndex += r.input + r.cacheWrite * 1.25 + r.cacheRead * 0.1 + r.output * 5
  }
  const denom = value.input + value.cacheRead + value.cacheWrite
  value.cacheHitRate = denom ? value.cacheRead / denom : 0
  return value
}
function summarize(sessionId: string, own: RequestRecord[], childRecords: RequestRecord[]): SessionUsageSummary {
  const last = own.at(-1)
  const lastDenom = last ? last.input + last.cacheRead + last.cacheWrite : 0
  return { session: totals(own), lastRequest: last ? { cacheWrite: last.cacheWrite, cacheHitRate: lastDenom ? last.cacheRead / lastDenom : 0, largeCacheRebuild: last.cacheWrite >= 300_000 } : null, children: childRecords.length ? totals(childRecords) : null }
}
function summarizeFromIndex(sessionId: string, own: RequestRecord[], indexPath: string, messagesPathFor: (id: string) => string = getAgentSessionMessagesPath): SessionUsageSummary {
  const childRecords: RequestRecord[] = []
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8'))
    const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : []
    for (const meta of sessions) if (meta?.id && (meta.parentSessionId === sessionId || meta.rootSessionId === sessionId)) childRecords.push(...recordsForPath(String(meta.id), messagesPathFor(String(meta.id))))
  } catch { /* missing index means there are no discoverable children */ }
  return summarize(sessionId, own, childRecords)
}

/** Test seam for isolated fixture files; caller supplies no data outside its own fixture. */
export function getPersonalSessionUsageFromPaths(sessionId: string, messagesPath: string, indexPath: string, messagesPathFor?: (id: string) => string): SessionUsageSummary {
  return summarizeFromIndex(sessionId, recordsForPath(sessionId, messagesPath), indexPath, messagesPathFor)
}
export function resetPersonalSessionUsageCache(): void { states.clear() }
export function getPersonalSessionUsageCachedOffset(sessionId: string): number | undefined { return states.get(sessionId)?.offset }
export function getPersonalSessionUsage(sessionId: string): SessionUsageSummary {
  return getPersonalSessionUsageFromPaths(sessionId, getAgentSessionMessagesPath(sessionId), getAgentSessionsIndexPath())
}
