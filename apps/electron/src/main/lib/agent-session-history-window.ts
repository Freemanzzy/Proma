import { closeSync, openSync, readSync, statSync } from 'node:fs'
import type { SDKMessage } from '@proma/shared'
import { getWebRemoteHistoryTurnStartIndices } from './web-remote/full-ui/sdk-history-window'

export interface AgentSessionSDKMessagesWindow<T = SDKMessage> {
  messages: T[]
  startIndex: number
  total: number
  hasEarlier: boolean
  omittedCount: number
}

export interface AgentSessionSDKMessagesWindowOptions {
  /** Exclusive upper bound for a previous page. */
  endIndex?: number
  /** Re-read the current visible suffix through EOF after a reply. */
  startIndex?: number
  budgetBytes?: number
}

interface FileFingerprint { size: number; mtimeMs: number; ranges: Array<[number, number]> }
const MAX_INDEXED_SESSION_FILES = 8
const lineIndexCache = new Map<string, FileFingerprint>()
const DEFAULT_HISTORY_BUDGET_BYTES = 2 * 1024 * 1024
const READ_BATCH_RECORDS = 128

function hasNonWhitespace(buffer: Buffer, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const byte = buffer[i]!
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0d) return true
  }
  return false
}

/** Build only byte boundaries; JSON is parsed later for the selected suffix. */
function getLineRanges(filePath: string, size: number, mtimeMs: number): Array<[number, number]> {
  const cached = lineIndexCache.get(filePath)
  if (cached?.size === size && cached.mtimeMs === mtimeMs) {
    lineIndexCache.delete(filePath)
    lineIndexCache.set(filePath, cached)
    return cached.ranges
  }

  const ranges: Array<[number, number]> = []
  const fd = openSync(filePath, 'r')
  const chunk = Buffer.allocUnsafe(1024 * 1024)
  let position = 0
  let lineStart = 0
  try {
    while (position < size) {
      const bytesRead = readSync(fd, chunk, 0, Math.min(chunk.length, size - position), position)
      if (bytesRead <= 0) break
      const end = position + bytesRead
      for (let i = 0; i < bytesRead; i++) {
        if (chunk[i] !== 0x0a) continue
        const lineEnd = position + i
        const localStart = lineStart - position
        if (lineStart < position || hasNonWhitespace(chunk, Math.max(0, localStart), i)) {
          if (lineStart >= position) ranges.push([lineStart, lineEnd])
          else {
            // A line spanning chunks is unusual (typically a large tool payload); scan only that line.
            const line = Buffer.alloc(lineEnd - lineStart)
            readSync(fd, line, 0, line.length, lineStart)
            if (hasNonWhitespace(line, 0, line.length)) ranges.push([lineStart, lineEnd])
          }
        }
        lineStart = lineEnd + 1
      }
      position = end
    }
    if (lineStart < size) {
      const tail = Buffer.alloc(size - lineStart)
      readSync(fd, tail, 0, tail.length, lineStart)
      if (hasNonWhitespace(tail, 0, tail.length)) ranges.push([lineStart, size])
    }
  } finally {
    closeSync(fd)
  }
  const entry = { size, mtimeMs, ranges }
  lineIndexCache.set(filePath, entry)
  while (lineIndexCache.size > MAX_INDEXED_SESSION_FILES) lineIndexCache.delete(lineIndexCache.keys().next().value!)
  return ranges
}

function readMessages<T>(fd: number, ranges: Array<[number, number]>, start: number, end: number, normalize: (value: unknown) => T): T[] {
  if (start >= end) return []
  const byteStart = ranges[start]![0]
  const byteEnd = ranges[end - 1]![1]
  const bytes = Buffer.allocUnsafe(byteEnd - byteStart)
  let bytesRead = 0
  while (bytesRead < bytes.length) {
    const count = readSync(fd, bytes, bytesRead, bytes.length - bytesRead, byteStart + bytesRead)
    if (count <= 0) throw new Error('会话历史窗口读取不完整')
    bytesRead += count
  }
  const output: T[] = []
  for (let i = start; i < end; i++) {
    const [lineStart, lineEnd] = ranges[i]!
    const line = bytes.toString('utf8', lineStart - byteStart, lineEnd - byteStart).trim()
    if (!line) continue
    try {
      output.push(normalize(JSON.parse(line)))
    } catch (error) {
      // Match the existing lenient display reader: keep valid records and skip malformed lines.
      console.warn(`[Agent 会话] 历史窗口 JSONL 第 ${i + 1} 行解析失败，已跳过:`, error instanceof Error ? error.message : String(error))
    }
  }
  return output
}

function serializedBytes(messages: unknown[]): number {
  return Buffer.byteLength(JSON.stringify(messages), 'utf8')
}

function messageRole(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return typeof record.type === 'string' ? record.type : null
}

function hasToolResult(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasToolResult)
  const record = value as Record<string, unknown>
  if (record.type === 'tool_result') return true
  return Object.values(record).some(hasToolResult)
}

function selectWindowStart(messages: unknown[], budgetBytes: number): number {
  const starts = getWebRemoteHistoryTurnStartIndices(messages)
  let bytes = 0
  let selected = starts[starts.length - 1] ?? 0
  for (let turn = starts.length - 1; turn >= 0; turn--) {
    const turnStart = starts[turn]!
    const turnEnd = turn + 1 < starts.length ? starts[turn + 1]! : messages.length
    const turnBytes = serializedBytes(messages.slice(turnStart, turnEnd))
    if (bytes > 0 && bytes + turnBytes > budgetBytes) break
    bytes += turnBytes
    selected = turnStart
    if (bytes >= budgetBytes) break
  }
  return selected
}

/** Read a complete-turn tail window without parsing or serializing the whole JSONL history. */
export function readAgentSessionSDKMessagesWindowFromFile<T = SDKMessage>(
  filePath: string,
  options: AgentSessionSDKMessagesWindowOptions,
  normalize: (value: unknown) => T,
): AgentSessionSDKMessagesWindow<T> {
  let fileStat
  try { fileStat = statSync(filePath) } catch { return { messages: [], startIndex: 0, total: 0, hasEarlier: false, omittedCount: 0 } }
  const ranges = getLineRanges(filePath, fileStat.size, fileStat.mtimeMs)
  const total = ranges.length
  const budget = Number.isFinite(options.budgetBytes) ? Math.max(1, Math.floor(options.budgetBytes!)) : DEFAULT_HISTORY_BUDGET_BYTES
  const endIndex = Math.max(0, Math.min(total, Math.floor(options.endIndex ?? total)))
  const fd = openSync(filePath, 'r')
  try {
    if (options.startIndex !== undefined) {
      const startIndex = Math.max(0, Math.min(endIndex, Math.floor(options.startIndex)))
      const messages = readMessages(fd, ranges, startIndex, endIndex, normalize)
      return { messages, startIndex, total, hasEarlier: startIndex > 0, omittedCount: startIndex }
    }

    let batchEnd = endIndex
    let candidateStart = endIndex
    let candidate: T[] = []
    while (candidateStart > 0) {
      const batchStart = Math.max(0, candidateStart - READ_BATCH_RECORDS)
      const batch = readMessages(fd, ranges, batchStart, batchEnd, normalize)
      candidate = [...batch, ...candidate]
      candidateStart = batchStart
      batchEnd = batchStart
      const localStart = selectWindowStart(candidate, budget)
      const selectedStart = candidate[localStart]
      const hasResolvedTurnBoundary = messageRole(selectedStart) === 'user'
        && !hasToolResult(selectedStart)
      // A candidate chunk may begin mid-turn. A user tool_result can only be
      // recognized as a continuation after its earlier tool_use is in the scan.
      // Keep reading backwards until the selected turn starts at a user prompt
      // without unresolved tool-result ancestry (or reaches the file start).
      if ((localStart > 0 && hasResolvedTurnBoundary) || candidateStart === 0) {
        const startIndex = candidateStart + localStart
        const messages = candidate.slice(localStart)
        return { messages, startIndex, total, hasEarlier: startIndex > 0, omittedCount: startIndex }
      }
    }
    return { messages: candidate, startIndex: 0, total, hasEarlier: false, omittedCount: 0 }
  } finally {
    closeSync(fd)
  }
}

/** Clear cached byte boundaries after a session file is truncated or removed. */
export function invalidateAgentSessionHistoryWindowIndex(filePath: string): void {
  lineIndexCache.delete(filePath)
}
