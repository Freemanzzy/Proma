/**
 * 会话用量统计；口径须与 scripts/personal/usage-cost-report.py 同步。
 * 本模块仅返回汇总，不读取渠道配置，也不暴露消息正文或文件路径。
 *
 * 读取方式：按会话缓存字节偏移，异步分块只读新增部分；只缓冲以 `{"type":"assistant"`
 * 开头的行，其余行（含 base64 图片等超大 user/tool 行）逐块跳过，内存占用与文件大小无关。
 */
import { open, stat } from 'node:fs/promises'
import { inferContextWindow } from '@proma/shared'
import { getAgentSessionMessagesPath, getAgentSessionsIndexPath } from './config-paths'

export interface SessionUsageTotals {
  requests: number; input: number; output: number; cacheRead: number; cacheWrite: number
  largeCacheRebuilds: number; relativeCostIndex: number; cacheHitRate: number
}
export interface SessionUsageSummary {
  session: SessionUsageTotals
  lastRequest: { cacheWrite: number; cacheHitRate: number; largeCacheRebuild: boolean } | null
  children: SessionUsageTotals | null
  /**
   * 最近一次请求的上下文占用（input + cacheRead + cacheWrite），用于启动后尚无实时用量时
   * 让压缩按钮仍可显示。最近一次请求之后发生过压缩时 compactedSinceLastRequest=true，tokens 不再可信。
   */
  context: { tokens: number; contextWindow: number | null; compactedSinceLastRequest: boolean } | null
}
interface RequestRecord { input: number; output: number; cacheRead: number; cacheWrite: number; model?: string }
interface FileState {
  offset: number; identity: string; size: number; mtimeMs: number
  records: RequestRecord[]; seen: Set<string>
  /** 最近一条带 usage 的 assistant 之后出现过 compact_boundary */
  compactedAfterLast: boolean
  /** 当前未结束行：null 表示正在跳过非 assistant 行 */
  pending: Buffer[] | null; pendingBytes: number; atLineStart: boolean
}

const CACHE_REBUILD_MIN_TOKENS = 300_000
const MAX_CACHED_FILES = 64
/** assistant 行实测最大约 48 KB；超过此上限的行视为异常并丢弃，避免无界缓冲 */
const MAX_ASSISTANT_LINE_BYTES = 8 * 1024 * 1024
const ASSISTANT_PREFIX = Buffer.from('{"type":"assistant"')
/** 压缩边界行只需识别前缀，不解析（其 summary 可能很长） */
const COMPACT_PREFIX = Buffer.from('{"type":"system","subtype":"compact_boundary"')
const DECIDE_BYTES = Math.max(ASSISTANT_PREFIX.length, COMPACT_PREFIX.length)
const NEWLINE = 0x0a
let chunkBytes = 4 * 1024 * 1024
/** 测试观测：缓冲过的最大未结束行字节数 */
let peakPendingBytes = 0

const states = new Map<string, FileState>()
const inflight = new Map<string, Promise<RequestRecord[]>>()
let indexCache: { key: string; sessions: Array<{ id?: unknown; parentSessionId?: unknown; rootSessionId?: unknown }> } | null = null

const EMPTY: SessionUsageTotals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, largeCacheRebuilds: 0, relativeCostIndex: 0, cacheHitRate: 0 }
const aliases = {
  input: ['input_tokens', 'inputTokens', 'prompt_tokens'], output: ['output_tokens', 'outputTokens', 'completion_tokens'],
  cacheRead: ['cache_read_input_tokens', 'cacheReadInputTokens', 'cached_tokens'],
  cacheWrite: ['cache_creation_input_tokens', 'cacheCreationInputTokens', 'cache_creation_tokens'],
} as const
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0 }
function usageValues(usage: Record<string, unknown>): RequestRecord {
  const details = (usage.prompt_tokens_details || usage.input_tokens_details || {}) as Record<string, unknown>
  const values = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, num(names.map(n => usage[n]).find(v => v !== undefined) ?? (key === 'cacheRead' ? details.cached_tokens : 0))])) as unknown as RequestRecord
  // OpenAI 风格 prompt_tokens 已包含缓存命中部分，换算为“未命中 input”
  if (usage.input_tokens === undefined && usage.inputTokens === undefined && usage.prompt_tokens !== undefined) values.input = Math.max(0, values.input - values.cacheRead)
  return values
}

function resetState(identity: string): FileState {
  return { offset: 0, identity, size: 0, mtimeMs: 0, records: [], seen: new Set(), compactedAfterLast: false, pending: [], pendingBytes: 0, atLineStart: true }
}

function acceptLine(state: FileState, line: Buffer): void {
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
  const model = typeof row._channelModelId === 'string' ? row._channelModelId : typeof message.model === 'string' ? message.model : undefined
  state.records.push(model ? { ...v, model } : v)
  state.compactedAfterLast = false
}

function startsWith(buf: Buffer, prefix: Buffer): boolean {
  return buf.length >= prefix.length && buf.subarray(0, prefix.length).equals(prefix)
}

/** 行首判定：assistant 行继续缓冲；压缩边界只记标记；其余行跳过 */
function decideLine(state: FileState, head: Buffer): void {
  state.atLineStart = false
  if (startsWith(head, ASSISTANT_PREFIX)) return
  if (startsWith(head, COMPACT_PREFIX)) state.compactedAfterLast = true
  state.pending = null
  state.pendingBytes = 0
}

/** 把一段新字节喂给行状态机：只缓冲 assistant 候选行，其余字节直接跳过 */
function feed(state: FileState, chunk: Buffer): void {
  let pos = 0
  while (pos < chunk.length) {
    const nl = chunk.indexOf(NEWLINE, pos)
    const end = nl === -1 ? chunk.length : nl
    const segment = chunk.subarray(pos, end)
    // 行首且本段已够长：直接判前缀，非 assistant 行不复制任何字节
    if (state.pending && state.atLineStart && state.pendingBytes === 0 && segment.length >= DECIDE_BYTES) {
      decideLine(state, segment)
    }
    if (state.pending) {
      // 行首尚未判定或已判定为候选：继续缓冲（复制，避免引用整块 chunk）
      state.pending.push(Buffer.from(segment))
      state.pendingBytes += segment.length
      if (state.pendingBytes > peakPendingBytes) peakPendingBytes = state.pendingBytes
      if (state.atLineStart && state.pendingBytes >= DECIDE_BYTES) decideLine(state, Buffer.concat(state.pending, state.pendingBytes))
      if (state.pending && state.pendingBytes > MAX_ASSISTANT_LINE_BYTES) { state.pending = null; state.pendingBytes = 0 }
    }
    if (nl === -1) break
    // 行结束：短于判定长度的完整行（压缩边界行一定更长）按 assistant 前缀判断
    if (state.pending) {
      const line = Buffer.concat(state.pending, state.pendingBytes)
      if (startsWith(line, ASSISTANT_PREFIX)) acceptLine(state, line)
    }
    state.pending = []
    state.pendingBytes = 0
    state.atLineStart = true
    pos = nl + 1
  }
}

function touch(sessionId: string, state: FileState): void {
  states.delete(sessionId)
  states.set(sessionId, state)
  while (states.size > MAX_CACHED_FILES) {
    const oldest = states.keys().next().value
    if (oldest === undefined) break
    states.delete(oldest)
  }
}

async function readRecords(sessionId: string, filePath: string): Promise<RequestRecord[]> {
  let handle
  try { handle = await open(filePath, 'r') } catch { states.delete(sessionId); return [] }
  try {
    const info = await handle.stat()
    const identity = `${info.dev}:${info.ino}`
    let state = states.get(sessionId)
    // inode 变化、文件变短、或同长度但被改写（mtime 变化）时整体重算
    if (!state || state.identity !== identity || info.size < state.offset || (info.size === state.offset && state.size === info.size && info.mtimeMs !== state.mtimeMs)) state = resetState(identity)
    const buffer = Buffer.allocUnsafe(Math.min(chunkBytes, Math.max(1, info.size - state.offset)))
    while (state.offset < info.size) {
      const want = Math.min(buffer.length, info.size - state.offset)
      const { bytesRead } = await handle.read(buffer, 0, want, state.offset)
      if (bytesRead <= 0) break
      feed(state, buffer.subarray(0, bytesRead))
      state.offset += bytesRead
    }
    state.size = info.size
    state.mtimeMs = info.mtimeMs
    touch(sessionId, state)
    return state.records
  } finally { await handle.close() }
}

/** 同一会话的读取串行化，避免并发调用交错推进同一偏移 */
function recordsForPath(sessionId: string, filePath: string): Promise<RequestRecord[]> {
  const previous = inflight.get(sessionId) ?? Promise.resolve([])
  const next = previous.catch(() => []).then(() => readRecords(sessionId, filePath))
  inflight.set(sessionId, next)
  void next.finally(() => { if (inflight.get(sessionId) === next) inflight.delete(sessionId) }).catch(() => {})
  return next
}

async function childSessionIds(sessionId: string, indexPath: string): Promise<string[]> {
  try {
    const info = await stat(indexPath)
    const key = `${indexPath}:${info.size}:${info.mtimeMs}`
    if (indexCache?.key !== key) {
      const handle = await open(indexPath, 'r')
      let text: string
      try { text = await handle.readFile({ encoding: 'utf8' }) } finally { await handle.close() }
      const parsed = JSON.parse(text)
      indexCache = { key, sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [] }
    }
    return indexCache.sessions
      .filter(meta => meta?.id && (meta.parentSessionId === sessionId || meta.rootSessionId === sessionId))
      .map(meta => String(meta.id))
  } catch { return [] }
}

function totals(records: RequestRecord[]): SessionUsageTotals {
  const value = { ...EMPTY }
  for (const r of records) {
    value.requests++; value.input += r.input; value.output += r.output; value.cacheRead += r.cacheRead; value.cacheWrite += r.cacheWrite
    if (r.cacheWrite >= CACHE_REBUILD_MIN_TOKENS) value.largeCacheRebuilds++
    value.relativeCostIndex += r.input + r.cacheWrite * 1.25 + r.cacheRead * 0.1 + r.output * 5
  }
  const denom = value.input + value.cacheRead + value.cacheWrite
  value.cacheHitRate = denom ? value.cacheRead / denom : 0
  return value
}

function summarize(own: RequestRecord[], childRecords: RequestRecord[], compactedAfterLast = false): SessionUsageSummary {
  const last = own.at(-1)
  const lastDenom = last ? last.input + last.cacheRead + last.cacheWrite : 0
  return {
    session: totals(own),
    lastRequest: last ? { cacheWrite: last.cacheWrite, cacheHitRate: lastDenom ? last.cacheRead / lastDenom : 0, largeCacheRebuild: last.cacheWrite >= CACHE_REBUILD_MIN_TOKENS } : null,
    children: childRecords.length ? totals(childRecords) : null,
    context: last ? {
      tokens: last.input + last.cacheRead + last.cacheWrite,
      contextWindow: (last.model && inferContextWindow(last.model)) || null,
      compactedSinceLastRequest: compactedAfterLast,
    } : null,
  }
}

/** Test seam for isolated fixture files; caller supplies no data outside its own fixture. */
export async function getPersonalSessionUsageFromPaths(sessionId: string, messagesPath: string, indexPath: string, messagesPathFor: (id: string) => string = getAgentSessionMessagesPath, options: { childAllowed?: (id: string) => boolean } = {}): Promise<SessionUsageSummary> {
  const own = await recordsForPath(sessionId, messagesPath)
  const compactedAfterLast = states.get(sessionId)?.compactedAfterLast === true
  const childRecords: RequestRecord[] = []
  for (const childId of await childSessionIds(sessionId, indexPath)) {
    if (options.childAllowed && !options.childAllowed(childId)) continue
    childRecords.push(...await recordsForPath(childId, messagesPathFor(childId)))
  }
  return summarize(own, childRecords, compactedAfterLast)
}
export function resetPersonalSessionUsageCache(): void { states.clear(); inflight.clear(); indexCache = null; peakPendingBytes = 0 }
export function getPersonalSessionUsagePeakPendingBytesForTest(): number { return peakPendingBytes }
export function getPersonalSessionUsageCachedOffset(sessionId: string): number | undefined { return states.get(sessionId)?.offset }
export function getPersonalSessionUsageCachedFileCount(): number { return states.size }
/** 测试用：调小分块以覆盖跨块的行边界 */
export function setPersonalSessionUsageChunkBytesForTest(bytes: number): void { chunkBytes = Math.max(1, Math.trunc(bytes)) }
export function getPersonalSessionUsage(sessionId: string, options: { childAllowed?: (id: string) => boolean } = {}): Promise<SessionUsageSummary> {
  return getPersonalSessionUsageFromPaths(sessionId, getAgentSessionMessagesPath(sessionId), getAgentSessionsIndexPath(), getAgentSessionMessagesPath, options)
}
