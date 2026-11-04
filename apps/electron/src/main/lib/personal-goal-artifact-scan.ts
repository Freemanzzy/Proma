import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as pathApi from 'node:path'

export const GOAL_ARTIFACT_SCAN_MAX_BYTES = 128 * 1024 * 1024
export const GOAL_ARTIFACT_MAX_ENTRIES = 50_000
export const GOAL_ARTIFACT_MAX_LINE_BYTES = 256 * 1024
export const GOAL_ARTIFACT_PAGE_BYTES = 512 * 1024

export interface GoalEvidenceSnapshotEntry {
  id: string
  sha256: string
  matched: boolean
}

export interface ArtifactScanOptions {
  captureEvidenceSnapshot: boolean
  fixedEvidenceMatchIds?: string[]
}

export interface ArtifactScanResult {
  status: 'ok' | 'not-found' | 'changed' | 'invalid' | 'too-large'
  lines: string[]
  nextOffset?: number
  entryHashes?: Record<string, string>
  snapshotEntries?: GoalEvidenceSnapshotEntry[]
  incomplete?: boolean
}

export interface ArtifactSourceSnapshot {
  dev: number
  ino: number
  size: number
  mtimeMs: number
}

export interface ArtifactScanWorkerPayload {
  result: ArtifactScanResult
  sourceSnapshot?: ArtifactSourceSnapshot
}

export interface ArtifactScanJob {
  binding: { path: string; sessionsDirectory: string }
  branchEntryIds: string[]
  leafId: string
  mode: 'entry' | 'keyword' | 'toolCall'
  query: string
  offset: number
  limit: number
  requiredIds: string[]
  expectedHashes: Record<string, string>
  hashOnly: boolean
  allowUnpersistedSuffix: boolean
  options: ArtifactScanOptions
}

type ArtifactMeta = { id: string; parentId: string | null; offset: number; length: number; tooLarge: boolean; toolCallIds: string[]; sha256?: string }
type LiteralSearchBudget = { nodes: number; exhausted: boolean }

export function containsArtifactLiteral(value: unknown, needle: string, depth = 0, budget: LiteralSearchBudget = { nodes: 10_000, exhausted: false }): boolean {
  if (value == null) return false
  if (depth > 16 || budget.nodes <= 0) { budget.exhausted = true; return false }
  budget.nodes -= 1
  if (typeof value === 'string') return value.toLocaleLowerCase().includes(needle.toLocaleLowerCase())
  if (Array.isArray(value)) return value.some((item) => containsArtifactLiteral(item, needle, depth + 1, budget))
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => containsArtifactLiteral(item, needle, depth + 1, budget))
  return false
}

/** Runs only inside personal-goal-artifact-worker.cjs; caller cancellation terminates this worker. */
export async function scanArtifact(job: ArtifactScanJob): Promise<ArtifactScanWorkerPayload> {
  let sourceSnapshot:ArtifactSourceSnapshot|undefined
  const result=await scanArtifactResult(job,(stat)=>{
    const snapshot={dev:Number(stat.dev),ino:Number(stat.ino),size:Number(stat.size),mtimeMs:Number(stat.mtimeMs)}
    if(!Number.isSafeInteger(snapshot.dev)||!Number.isSafeInteger(snapshot.ino)||!Number.isSafeInteger(snapshot.size)||!Number.isFinite(snapshot.mtimeMs))throw new Error('Goal artifact source stat is outside exact numeric range')
    sourceSnapshot=snapshot
  })
  return {result,...(sourceSnapshot?{sourceSnapshot}:{})}
}

async function scanArtifactResult(job: ArtifactScanJob, captureSourceSnapshot:(stat:Awaited<ReturnType<typeof fsp.stat>>)=>void): Promise<ArtifactScanResult> {
  const { binding, branchEntryIds, leafId, mode, query, offset, limit, requiredIds, expectedHashes, hashOnly, allowUnpersistedSuffix, options } = job
  if (!Array.isArray(branchEntryIds) || branchEntryIds.length < 1 || branchEntryIds.length > GOAL_ARTIFACT_MAX_ENTRIES || branchEntryIds.at(-1) !== leafId || !Number.isSafeInteger(offset) || offset < 0 || !query || query.length > 500) return { status: 'invalid', lines: [] }
  let canonicalPath: string
  let before: Awaited<ReturnType<typeof fsp.stat>>
  let root: string
  try {
    if ((await fsp.lstat(binding.path)).isSymbolicLink()) return { status: 'invalid', lines: [] }
    canonicalPath = await fsp.realpath(binding.path)
    root = await fsp.realpath(binding.sessionsDirectory)
    const relative = pathApi.relative(root, canonicalPath)
    if (!relative || relative.startsWith('..') || pathApi.isAbsolute(relative) || canonicalPath !== binding.path) return { status: 'invalid', lines: [] }
    before = await fsp.stat(canonicalPath)
    if (before.size > GOAL_ARTIFACT_SCAN_MAX_BYTES) return { status: 'too-large', lines: [] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ELOOP') return { status: 'not-found', lines: [] }
    throw error
  }
  const index = new Map<string, ArtifactMeta>()
  const branchSet = new Set(branchEntryIds)
  const hits: string[] = []
  const fixedEvidenceMatchIds = options.fixedEvidenceMatchIds === undefined ? undefined : new Set(options.fixedEvidenceMatchIds)
  const sourceHandle = await fsp.open(canonicalPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  let stream: ReturnType<typeof sourceHandle.createReadStream> | undefined
  let absolute = 0, lineStart = 0, lineLength = 0
  let parts: Buffer[] = [], prefix: Buffer[] = []
  let lineDigest = createHash('sha256')
  let tooLargeLine = false, oversizedBranch = false, scanFailed = false, keywordScanIncomplete = false, toolCallScanIncomplete = false
  const processLine = (raw: Buffer, start: number, length: number, oversized: boolean, lineHash: string): void => {
    let row: Record<string, unknown> | undefined
    if (!oversized) {
      try {
        const parsed = JSON.parse(raw.toString('utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) row = parsed
      } catch { return }
    } else {
      const head = Buffer.concat(prefix).toString('utf8')
      const id = head.match(/"id"\s*:\s*"([A-Za-z0-9_-]{1,160})"/)?.[1]
      const parentId = head.match(/"parentId"\s*:\s*(?:"([A-Za-z0-9_-]{1,160})"|null)/)
      if (id) row = { id, parentId: parentId?.[1] ?? null, type: 'oversized' }
    }
    if (typeof row?.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(row.id)) return
    if (index.has(row.id) || index.size >= GOAL_ARTIFACT_MAX_ENTRIES) { scanFailed = true; return }
    const toolCallIds: string[] = []
    const visit = (value: unknown, depth = 0, budget = { nodes: 10_000 }): void => {
      if (value == null) return
      if (depth > 16 || budget.nodes <= 0 || toolCallIds.length >= 100) { toolCallScanIncomplete = true; return }
      budget.nodes -= 1
      if (Array.isArray(value)) for (const item of value) visit(item, depth + 1, budget)
      else if (typeof value === 'object') {
        const object = value as Record<string, unknown>
        if (typeof object.toolCallId === 'string') toolCallIds.push(object.toolCallId)
        if (object.type === 'toolCall' && typeof object.id === 'string') toolCallIds.push(object.id)
        for (const item of Object.values(object)) visit(item, depth + 1, budget)
      }
    }
    const parent = typeof row.parentId === 'string' ? row.parentId : null
    const meta: ArtifactMeta = { id: row.id, parentId: parent, offset: start, length, tooLarge: oversized, toolCallIds, sha256: lineHash }
    index.set(row.id, meta)
    if (branchSet.has(row.id)) {
      if (oversized) oversizedBranch = true
      else if (fixedEvidenceMatchIds === undefined) visit(row)
      const budget: LiteralSearchBudget = { nodes: 10_000, exhausted: false }
      const matched = fixedEvidenceMatchIds !== undefined
        ? fixedEvidenceMatchIds.has(row.id)
        : mode === 'entry' ? row.id === query : mode === 'toolCall' ? toolCallIds.includes(query) : !oversized && containsArtifactLiteral(row, query, 0, budget)
      if (budget.exhausted && fixedEvidenceMatchIds === undefined) keywordScanIncomplete = true
      if (matched) hits.push(row.id)
    }
  }
  const pushBytes = (buffer: Buffer): void => {
    if (buffer.length === 0) return
    lineDigest.update(buffer)
    const wasSmall = !tooLargeLine
    lineLength += buffer.length
    if (wasSmall && lineLength <= GOAL_ARTIFACT_MAX_LINE_BYTES) parts.push(buffer)
    else {
      if (wasSmall) { prefix = parts.slice(); parts = []; tooLargeLine = true }
      const have = prefix.reduce((total, item) => total + item.length, 0)
      if (have < 16 * 1024) prefix.push(buffer.subarray(0, Math.max(0, 16 * 1024 - have)))
    }
  }
  try {
    stream = sourceHandle.createReadStream({ highWaterMark: 64 * 1024, autoClose: false })
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      const chunkBase = absolute
      let position = 0
      while (position < chunk.length) {
        const newline = chunk.indexOf(10, position)
        const end = newline < 0 ? chunk.length : newline
        pushBytes(chunk.subarray(position, end))
        if (newline >= 0) {
          processLine(tooLargeLine ? Buffer.alloc(0) : Buffer.concat(parts), lineStart, lineLength, tooLargeLine, lineDigest.digest('hex'))
          lineStart = chunkBase + newline + 1
          lineLength = 0; parts = []; prefix = []; lineDigest = createHash('sha256'); tooLargeLine = false
          position = newline + 1
        } else position = chunk.length
      }
      absolute = chunkBase + chunk.length
    }
    if (lineLength > 0) processLine(tooLargeLine ? Buffer.alloc(0) : Buffer.concat(parts), lineStart, lineLength, tooLargeLine, lineDigest.digest('hex'))
  } finally { stream?.destroy(); await sourceHandle.close().catch(() => {}) }
  if (scanFailed) return { status: 'too-large', lines: [] }
  if (fixedEvidenceMatchIds === undefined && (keywordScanIncomplete || mode === 'toolCall' && toolCallScanIncomplete)) return { status: 'too-large', lines: [], incomplete: true }
  const after = await fsp.stat(canonicalPath)
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return { status: 'changed', lines: [] }
  let missingBranchSuffix = false
  const persistedBranchIds: string[] = []
  for (let indexAt = 0; indexAt < branchEntryIds.length; indexAt++) {
    const id = branchEntryIds[indexAt]!
    const item = index.get(id)
    if (!item) { if (allowUnpersistedSuffix) { missingBranchSuffix = true; continue } return { status: 'invalid', lines: [] } }
    if (missingBranchSuffix) return { status: 'invalid', lines: [] }
    if (indexAt > 0 && item.parentId !== branchEntryIds[indexAt - 1]) return { status: 'invalid', lines: [] }
    persistedBranchIds.push(id)
  }
  if (!persistedBranchIds.length && !allowUnpersistedSuffix) return { status: 'invalid', lines: [] }
  for (const [id, expected] of Object.entries(expectedHashes)) {
    const meta = index.get(id)
    if (!branchSet.has(id) || !meta) return { status: 'invalid', lines: [] }
    if (!meta.sha256 || meta.sha256 !== expected) return { status: 'changed', lines: [] }
  }
  if (oversizedBranch && mode !== 'entry' && !hashOnly && fixedEvidenceMatchIds === undefined) return { status: 'too-large', lines: [] }
  const entryHashes: Record<string, string> = {}
  for (const id of requiredIds) {
    const meta = index.get(id)
    if (!meta) { if (allowUnpersistedSuffix && missingBranchSuffix) continue; return { status: 'invalid', lines: [] } }
    if (!branchSet.has(id) || !meta.sha256) return { status: 'invalid', lines: [] }
    entryHashes[id] = meta.sha256
  }
  if (hashOnly) {
    captureSourceSnapshot(after)
    return { status: 'ok', lines: [], ...(requiredIds.length ? { entryHashes } : {}) }
  }
  let snapshotEntries: GoalEvidenceSnapshotEntry[] | undefined
  if (options.captureEvidenceSnapshot) {
    const matchedIds = new Set(hits)
    snapshotEntries = []
    for (const id of persistedBranchIds) {
      const sha256 = index.get(id)?.sha256
      if (!sha256) return { status: 'invalid', lines: [] }
      snapshotEntries.push({ id, sha256, matched: matchedIds.has(id) })
    }
  }
  const selected = hits.slice(offset, offset + Math.min(Math.max(limit, 1), 20))
  if (!selected.length) {
    captureSourceSnapshot(after)
    return { status: 'not-found', lines: [], ...(requiredIds.length ? { entryHashes } : {}), ...(snapshotEntries ? { snapshotEntries } : {}) }
  }
  for (const id of selected) {
    const meta = index.get(id)!
    if (meta.tooLarge) return { status: 'too-large', lines: [] }
    if (expectedHashes[id] && meta.sha256 !== expectedHashes[id]) return { status: 'changed', lines: [] }
  }
  const lines: string[] = []
  let total = 0
  for (const id of selected) {
    const item = index.get(id)!
    if (item.tooLarge || item.length > GOAL_ARTIFACT_MAX_LINE_BYTES || total + item.length > GOAL_ARTIFACT_PAGE_BYTES) {
      if (lines.length === 0) return { status: 'too-large', lines: [] }
      break
    }
    const chunks: Buffer[] = []
    let bytesRead = 0
    const pageHandle = await fsp.open(canonicalPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    let pageStream: ReturnType<typeof pageHandle.createReadStream> | undefined
    try {
      pageStream = pageHandle.createReadStream({ start: item.offset, end: item.offset + item.length - 1, autoClose: false })
      for await (const chunk of pageStream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytesRead += buffer.length
        if (bytesRead > GOAL_ARTIFACT_MAX_LINE_BYTES) return { status: 'too-large', lines: [] }
        chunks.push(buffer)
      }
    } finally { pageStream?.destroy(); await pageHandle.close().catch(() => {}) }
    if (bytesRead !== item.length) return { status: 'changed', lines: [] }
    const rawLine = Buffer.concat(chunks)
    if (item.sha256 !== createHash('sha256').update(rawLine).digest('hex')) return { status: 'changed', lines: [] }
    lines.push(rawLine.toString('utf8'))
    total += bytesRead
  }
  const finalStat = await fsp.stat(canonicalPath)
  if (before.dev !== finalStat.dev || before.ino !== finalStat.ino || before.size !== finalStat.size || before.mtimeMs !== finalStat.mtimeMs) return { status: 'changed', lines: [] }
  captureSourceSnapshot(finalStat)
  return lines.length
    ? { status: 'ok', lines, ...(offset + lines.length < hits.length ? { nextOffset: offset + lines.length } : {}), ...(requiredIds.length ? { entryHashes } : {}), ...(snapshotEntries ? { snapshotEntries } : {}) }
    : { status: 'not-found', lines: [], ...(requiredIds.length ? { entryHashes } : {}), ...(snapshotEntries ? { snapshotEntries } : {}) }
}
