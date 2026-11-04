import type { ArtifactScanJob, ArtifactScanResult, ArtifactSourceSnapshot, GoalEvidenceSnapshotEntry } from './personal-goal-artifact-scan'

export const GOAL_ARTIFACT_WORKER_PROTOCOL_VERSION = 1
export const GOAL_ARTIFACT_WORKER_MAX_REQUEST_BYTES = 32 * 1024 * 1024
export const GOAL_ARTIFACT_WORKER_MAX_RESULT_BYTES = 20 * 1024 * 1024
const MAX_ENTRIES = 50_000
const MAX_ENTRY_ID_LENGTH = 160
const MAX_LINE_BYTES = 256 * 1024
const MAX_PAGE_BYTES = 512 * 1024
const ENTRY_ID = /^[A-Za-z0-9_-]{1,160}$/
const HASH = /^[a-f0-9]{64}$/

export interface ArtifactScanWorkerRequest {
  protocolVersion: 1
  kind: 'scan'
  requestId: string
  generation: number
  job: ArtifactScanJob
}

export interface ArtifactScanWorkerResponse {
  protocolVersion: 1
  kind: 'result' | 'error'
  requestId: string
  generation: number
  workerThreadId: number
  result?: ArtifactScanResult
  sourceSnapshot?: ArtifactSourceSnapshot
  error?: { name: string; message: string }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validIdList(value: unknown, minimum: number): value is string[] {
  return Array.isArray(value) && value.length >= minimum && value.length <= MAX_ENTRIES && value.every((item) => typeof item === 'string' && item.length <= MAX_ENTRY_ID_LENGTH && ENTRY_ID.test(item))
}

function isWithinJsonByteLimit(value: unknown, limit: number): boolean {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') <= limit
  } catch {
    return false
  }
}

export function isArtifactScanJob(value: unknown): value is ArtifactScanJob {
  if (!isPlainRecord(value) || Object.keys(value).length !== 12) return false
  const binding = value.binding
  const options = value.options
  const expectedHashes = value.expectedHashes
  if (!isPlainRecord(binding) || Object.keys(binding).length !== 2 || typeof binding.path !== 'string' || !binding.path || binding.path.length > 4096 || typeof binding.sessionsDirectory !== 'string' || !binding.sessionsDirectory || binding.sessionsDirectory.length > 4096) return false
  if (!validIdList(value.branchEntryIds, 1) || typeof value.leafId !== 'string' || !ENTRY_ID.test(value.leafId) || value.branchEntryIds.at(-1) !== value.leafId) return false
  if (value.mode !== 'entry' && value.mode !== 'keyword' && value.mode !== 'toolCall') return false
  if (typeof value.query !== 'string' || value.query.length < 1 || value.query.length > 500) return false
  if (!Number.isSafeInteger(value.offset) || (value.offset as number) < 0 || !Number.isSafeInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 20) return false
  if (!validIdList(value.requiredIds, 0)) return false
  if (!isPlainRecord(expectedHashes) || Object.keys(expectedHashes).length > MAX_ENTRIES) return false
  for (const [id, hash] of Object.entries(expectedHashes)) if (!ENTRY_ID.test(id) || typeof hash !== 'string' || !HASH.test(hash)) return false
  if (typeof value.hashOnly !== 'boolean' || typeof value.allowUnpersistedSuffix !== 'boolean') return false
  if (!isPlainRecord(options) || Object.keys(options).some((key) => key !== 'captureEvidenceSnapshot' && key !== 'fixedEvidenceMatchIds') || typeof options.captureEvidenceSnapshot !== 'boolean') return false
  if (options.fixedEvidenceMatchIds !== undefined && !validIdList(options.fixedEvidenceMatchIds, 0)) return false
  return isWithinJsonByteLimit(value, GOAL_ARTIFACT_WORKER_MAX_REQUEST_BYTES)
}

function validSnapshotEntries(value: unknown): value is GoalEvidenceSnapshotEntry[] {
  return Array.isArray(value) && value.length <= MAX_ENTRIES && value.every((entry) => isPlainRecord(entry) && Object.keys(entry).length === 3 && typeof entry.id === 'string' && ENTRY_ID.test(entry.id) && typeof entry.sha256 === 'string' && HASH.test(entry.sha256) && typeof entry.matched === 'boolean')
}

function validHashRecord(value: unknown): value is Record<string, string> {
  if (!isPlainRecord(value) || Object.keys(value).length > MAX_ENTRIES) return false
  return Object.entries(value).every(([id, hash]) => ENTRY_ID.test(id) && typeof hash === 'string' && HASH.test(hash))
}

export function isArtifactScanResult(value: unknown): value is ArtifactScanResult {
  if (!isPlainRecord(value) || !['ok', 'not-found', 'changed', 'invalid', 'too-large'].includes(String(value.status))) return false
  if (!Array.isArray(value.lines) || value.lines.length > 20 || !value.lines.every((line) => typeof line === 'string')) return false
  const pageBytes = value.lines.reduce((total, line) => total + Buffer.byteLength(line, 'utf8'), 0)
  if (pageBytes > MAX_PAGE_BYTES || value.lines.some((line) => Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES)) return false
  if (value.nextOffset !== undefined && (!Number.isSafeInteger(value.nextOffset) || (value.nextOffset as number) < 0 || (value.nextOffset as number) > MAX_ENTRIES)) return false
  if (value.entryHashes !== undefined && !validHashRecord(value.entryHashes)) return false
  if (value.snapshotEntries !== undefined && !validSnapshotEntries(value.snapshotEntries)) return false
  if (value.incomplete !== undefined && typeof value.incomplete !== 'boolean') return false
  if (Object.keys(value).some((key) => !['status', 'lines', 'nextOffset', 'entryHashes', 'snapshotEntries', 'incomplete'].includes(key))) return false
  return isWithinJsonByteLimit(value, GOAL_ARTIFACT_WORKER_MAX_RESULT_BYTES)
}

function isArtifactSourceSnapshot(value: unknown): value is ArtifactSourceSnapshot {
  if (!isPlainRecord(value) || Object.keys(value).length !== 4) return false
  return Number.isSafeInteger(value.dev) && (value.dev as number) >= 0 && Number.isSafeInteger(value.ino) && (value.ino as number) >= 0 && Number.isSafeInteger(value.size) && (value.size as number) >= 0 && typeof value.mtimeMs === 'number' && Number.isFinite(value.mtimeMs) && value.mtimeMs >= 0
}

export function isArtifactScanWorkerResponse(value: unknown): value is ArtifactScanWorkerResponse {
  if (!isPlainRecord(value) || value.protocolVersion !== GOAL_ARTIFACT_WORKER_PROTOCOL_VERSION || (value.kind !== 'result' && value.kind !== 'error')) return false
  if (typeof value.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.requestId) || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1 || !Number.isSafeInteger(value.workerThreadId) || (value.workerThreadId as number) <= 0) return false
  const keys=Object.keys(value)
  if (value.kind === 'result') return (keys.length === 6 || keys.length === 7) && keys.every((key)=>['protocolVersion','kind','requestId','generation','workerThreadId','result','sourceSnapshot'].includes(key)) && isArtifactScanResult(value.result) && (value.sourceSnapshot === undefined || isArtifactSourceSnapshot(value.sourceSnapshot))
  return keys.length === 6 && keys.every((key)=>['protocolVersion','kind','requestId','generation','workerThreadId','error'].includes(key)) && isPlainRecord(value.error) && Object.keys(value.error).length === 2 && typeof value.error.name === 'string' && value.error.name.length <= 100 && typeof value.error.message === 'string' && value.error.message.length <= 1000
}

export { MAX_ENTRY_ID_LENGTH as ARTIFACT_WORKER_MAX_ENTRY_ID_LENGTH }
