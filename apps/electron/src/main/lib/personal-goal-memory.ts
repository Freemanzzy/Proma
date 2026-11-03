import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionFactory, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

export const GOAL_CONTEXT_BUDGET_CHARS = 12_000
export const GOAL_EVIDENCE_MAX_BYTES = 2 * 1024 * 1024

export interface GoalContract {
  id: string
  sessionId: string
  workspaceId: string
  revision: number
  hash: string
  originalText: string
  scope: string[]
  nonGoals: string[]
  hardConstraints: string[]
  acceptance: string[]
  userMessageRef: string
  createdAt: number
}

export type GoalCheckpointStatus = 'active' | 'waiting_user' | 'blocked' | 'paused' | 'claimed_done'

export interface GoalCheckpoint {
  goalId: string
  revision: number
  status: GoalCheckpointStatus
  observed: string[]
  modelReported: string[]
  nextAction: string
  questions: string[]
  unknownSideEffects: string[]
  artifactId: string
  branchId: string
  leafId: string
  entryWatermark: string[]
  entryHashes: Record<string, string>
  sequence: number
  modelSequence: number
  updatedAt: number
}

interface SqlStatement {
  run(...params: unknown[]): { changes?: number }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}
interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  close(): void
}
interface SqliteModule { DatabaseSync: new (path: string) => SqlDatabase }

function isEnabled(): boolean {
  return process.env.PROMA_PERSONAL_GOAL_MEMORY === '1'
}

export function isGoalMemoryEnabled(): boolean { return isEnabled() }

function databasePath(): string {
  const root = process.env.PROMA_PERSONAL_GOAL_DATA_DIR
    ? join(process.env.PROMA_PERSONAL_GOAL_DATA_DIR, 'goal-memory')
    : join(homedir(), process.env.PROMA_DEV === '1' ? (process.env.PROMA_DEV_DATA_DIR_NAME ?? '.proma-dev') : '.proma', 'goal-memory')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  return join(root, 'goals.sqlite')
}

function openDatabase(): SqlDatabase {
  if (!isEnabled()) throw new Error('Goal Memory 当前已关闭')
  // Defer node:sqlite loading: disabled mode must not touch the filesystem or require SQLite.
  const { DatabaseSync } = require('node:sqlite') as SqliteModule
  const filePath = databasePath()
  const existed = existsSync(filePath)
  const db = new DatabaseSync(filePath)
  try {
    if (existed) {
      const objects = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name:string}>
      if (objects.length > 0) {
        if (!objects.some((object) => object.name === 'metadata')) throw new Error('Goal Memory 数据库缺少schema元数据；拒绝修改未知数据库')
        const version = db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get() as {value?:string}|undefined
        if (version?.value !== '1') throw new Error('Goal Memory 数据库 schema 版本不兼容；拒绝修改现有数据')
      }
    }
    db.exec(`PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT NOT NULL, session_id TEXT NOT NULL, revision INTEGER NOT NULL, hash TEXT NOT NULL,
      payload TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(id, revision));
    CREATE TABLE IF NOT EXISTS current_contracts (session_id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoints (
      goal_id TEXT NOT NULL, revision INTEGER NOT NULL, sequence INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(goal_id, revision));
    CREATE TABLE IF NOT EXISTS compaction_acks (
      session_id TEXT NOT NULL, goal_id TEXT NOT NULL, revision INTEGER NOT NULL, acknowledged_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO metadata(key, value) VALUES ('schemaVersion', '1');`)
    const version = db.prepare("SELECT value FROM metadata WHERE key = 'schemaVersion'").get() as { value?: string } | undefined
    if (version?.value !== '1') throw new Error('Goal Memory 数据库 schema 版本不兼容')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function contractHash(input: Omit<GoalContract, 'hash' | 'createdAt'>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function verifyContract(contract: GoalContract): GoalContract {
  const { hash, createdAt: _createdAt, ...payload } = contract
  if (contractHash(payload) !== hash) throw new Error('Goal 合同 hash 校验失败；拒绝装载已变更合同')
  return contract
}

function normalizeList(values: string[], field: string): string[] {
  if (!Array.isArray(values) || values.length > 100 || values.some((value) => typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 5_000)) {
    throw new Error(`${field} 必须是最多100项、每项不超过5000 UTF-8字节的非空字符串数组`)
  }
  return values.map((value) => value.trim())
}

export function createGoalContract(input: {
  sessionId: string
  workspaceId: string
  expectedRevision: number
  originalText: string
  scope: string[]
  nonGoals: string[]
  hardConstraints: string[]
  acceptance: string[]
  userMessageRef: string
}): GoalContract {
  if (!isEnabled()) throw new Error('Goal Memory 当前已关闭')
  if (!input.sessionId || !input.originalText.trim() || !input.userMessageRef) throw new Error('Goal 合同缺少会话、用户原文或用户消息引用')
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('expectedRevision 无效')
  if (Buffer.byteLength(input.originalText, 'utf8') > GOAL_EVIDENCE_MAX_BYTES) throw new Error('Goal 原文超过允许的 UTF-8 字节上限')
  const scope = normalizeList(input.scope, 'scope')
  const nonGoals = normalizeList(input.nonGoals, 'nonGoals')
  const hardConstraints = normalizeList(input.hardConstraints, 'hardConstraints')
  const acceptance = normalizeList(input.acceptance, 'acceptance')
  const db = openDatabase()
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const latest = db.prepare('SELECT MAX(revision) AS revision, MAX(id) AS goal_id FROM contracts WHERE session_id=?').get(input.sessionId) as { revision: number | null; goal_id: string | null } | undefined
      const actualRevision = latest?.revision ?? 0
      if (actualRevision !== input.expectedRevision) throw new Error(`Goal 合同 CAS 冲突：expected ${input.expectedRevision}, actual ${actualRevision}`)
      const revision = actualRevision + 1
      const value = {
        id: latest?.goal_id ?? randomUUID(), sessionId: input.sessionId, workspaceId: input.workspaceId, revision,
        originalText: input.originalText, scope, nonGoals, hardConstraints, acceptance, userMessageRef: input.userMessageRef,
      }
      const contract: GoalContract = { ...value, hash: contractHash(value), createdAt: Date.now() }
      const initialCheckpoint = emptyCheckpoint(contract)
      buildGoalContextPack(contract, initialCheckpoint)
      db.prepare('INSERT INTO contracts(id, session_id, revision, hash, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(contract.id, contract.sessionId, contract.revision, contract.hash, JSON.stringify(contract), contract.createdAt)
      db.prepare('INSERT INTO current_contracts(session_id, goal_id, revision) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET goal_id=excluded.goal_id, revision=excluded.revision')
        .run(input.sessionId, contract.id, contract.revision)
      db.prepare('INSERT INTO checkpoints(goal_id, revision, sequence, payload, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(contract.id, revision, initialCheckpoint.sequence, JSON.stringify(initialCheckpoint), initialCheckpoint.updatedAt)
      db.exec('COMMIT')
      return contract
    } catch (error) { db.exec('ROLLBACK'); throw error }
  } finally { db.close() }
}

export function disableGoalForSession(sessionId: string): void {
  if (!isEnabled()) return
  const db = openDatabase()
  try { db.prepare('DELETE FROM current_contracts WHERE session_id=?').run(sessionId) } finally { db.close() }
}

export function getGoalContract(sessionId: string, expectedWorkspaceId?: string): GoalContract | null {
  if (!isEnabled()) return null
  const db = openDatabase()
  try {
    const row = db.prepare(`SELECT c.payload FROM contracts c JOIN current_contracts x ON x.goal_id=c.id AND x.revision=c.revision WHERE x.session_id=?`).get(sessionId) as { payload: string } | undefined
    if (!row) return null
    const contract = verifyContract(JSON.parse(row.payload) as GoalContract)
    if (expectedWorkspaceId && contract.workspaceId !== expectedWorkspaceId) throw new Error('Goal workspace binding changed; explicit rebind required')
    return contract
  } finally { db.close() }
}

function emptyCheckpoint(contract: GoalContract): GoalCheckpoint {
  return {
    goalId: contract.id, revision: contract.revision, status: 'active', observed: [], modelReported: [], nextAction: '',
    questions: [], unknownSideEffects: [], artifactId: '', branchId: '', leafId: '', entryWatermark: [], entryHashes: {}, sequence: 0, modelSequence: 0, updatedAt: Date.now(),
  }
}

export function createGoalRunFailLatch(onFailure: () => void): { fail():void; isFailed():boolean } {
  let failed=false
  return { fail:()=>{if(failed)return;failed=true;onFailure()}, isFailed:()=>failed }
}

/** Durable barrier shared by manual, threshold and overflow compaction hooks. */
export function acknowledgeGoalBeforeCompact(sessionId: string): void {
  if (!isEnabled()) return
  const db = openDatabase()
  try {
    const current = db.prepare('SELECT goal_id, revision FROM current_contracts WHERE session_id=?').get(sessionId) as { goal_id: string; revision: number } | undefined
    if (!current) return
    const exists = db.prepare('SELECT 1 AS ready FROM checkpoints WHERE goal_id=? AND revision=?').get(current.goal_id, current.revision)
    if (!exists) throw new Error('Goal checkpoint 缺失，已阻止手动压缩')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('INSERT INTO compaction_acks(session_id, goal_id, revision, acknowledged_at) VALUES (?, ?, ?, ?)')
        .run(sessionId, current.goal_id, current.revision, Date.now())
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  } finally { db.close() }
}

export function createGoalCompactionExtension(
  capability: GoalMemoryCapability,
  sessionId: string,
  queryId: string,
  onFailure: () => void,
  ackTimeoutMs = 5_000,
): ExtensionFactory {
  return (pi) => {
    const runFailure = createGoalRunFailLatch(onFailure)
    const fail = (): void => runFailure.fail()
    pi.on('session_before_compact', async (event, context) => {
      const controller = new AbortController()
      const abortFromPi = (): void => controller.abort()
      if (event.signal.aborted) { fail(); context.abort(); return { cancel: true } }
      event.signal.addEventListener('abort', abortFromPi, { once: true })
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const ack = await Promise.race([
          capability.request({
            operation: 'compact_ack', ownerId: capability.ownerId, sessionId,
            workspaceId: capability.workspaceId, queryId, reason: event.reason,
            artifactId: context.sessionManager.getSessionId(), leafId: context.sessionManager.getLeafId(),
            branchEntryIds: context.sessionManager.getBranch().map((entry)=>entry.id),
          }, controller.signal),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Goal checkpoint ack 超时')) }, ackTimeoutMs) }),
        ])
        if (ack.acknowledged !== true) throw new Error('Goal checkpoint ack 未获主进程确认')
        return
      } catch {
        // Pi may catch extension failures; make this run fail closed and explicitly cancel.
        controller.abort()
        fail()
        context.abort()
        return { cancel: true }
      } finally { event.signal.removeEventListener('abort', abortFromPi); if (timeout) clearTimeout(timeout) }
    })
    pi.on('turn_end', async (event, context) => {
      if (runFailure.isFailed()) { context.abort(); return }
      const leafId = context.sessionManager.getLeafId()
      if (!leafId) return
      const branchEntryIds = context.sessionManager.getBranch().map((entry) => entry.id)
      const entryIds = [event.messageEntryId, ...event.toolResultEntryIds]
      try {
        await capability.request({
          operation: 'turn_end', ownerId: capability.ownerId, sessionId,
          workspaceId: capability.workspaceId, queryId, artifactId: context.sessionManager.getSessionId(),
          leafId, entryIds, branchEntryIds,
        }, context.signal)
      } catch {
        fail()
        context.abort()
      }
    })
    pi.on('tool_call', () => runFailure.isFailed() ? { block: true } : undefined)
  }
}

export function getGoalCheckpoint(goalId: string, revision: number): GoalCheckpoint | null {
  if (!isEnabled()) return null
  const db = openDatabase()
  try {
    const row = db.prepare('SELECT sequence, payload FROM checkpoints WHERE goal_id=? AND revision=?').get(goalId, revision) as { sequence: number; payload: string } | undefined
    if (!row) return null
    const checkpoint = normalizeStoredCheckpoint(JSON.parse(row.payload) as GoalCheckpoint)
    if (checkpoint.sequence !== row.sequence) throw new Error('Goal checkpoint sequence/data mismatch')
    return checkpoint
  } finally { db.close() }
}

function commitCheckpointUpdate(
  goalId: string,
  revision: number,
  expectedSequence: number,
  update: (current: GoalCheckpoint) => GoalCheckpoint,
): GoalCheckpoint {
  if (!isEnabled()) throw new Error('Goal Memory 当前已关闭')
  if (!Number.isSafeInteger(expectedSequence) || expectedSequence < 0) throw new Error('checkpoint expectedSequence 无效')
  const db = openDatabase()
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT sequence, payload FROM checkpoints WHERE goal_id=? AND revision=?').get(goalId, revision) as { sequence: number; payload: string } | undefined
      const currentGoal = db.prepare('SELECT 1 AS current FROM current_contracts WHERE goal_id=? AND revision=?').get(goalId, revision)
      if (!row || !currentGoal || row.sequence !== expectedSequence) throw new Error('Goal checkpoint CAS 冲突或合同 revision 已失效')
      const current = normalizeStoredCheckpoint(JSON.parse(row.payload) as GoalCheckpoint)
      if (current.sequence !== row.sequence) throw new Error('Goal checkpoint sequence/data mismatch')
      const next = { ...update(current), goalId, revision, sequence: row.sequence + 1, updatedAt: Date.now() }
      const result = db.prepare('UPDATE checkpoints SET sequence=?, payload=?, updated_at=? WHERE goal_id=? AND revision=? AND sequence=?')
        .run(next.sequence, JSON.stringify(next), next.updatedAt, goalId, revision, expectedSequence)
      if (!result.changes) throw new Error('Goal checkpoint CAS 冲突')
      db.exec('COMMIT')
      return next
    } catch (error) { db.exec('ROLLBACK'); throw error }
  } finally { db.close() }
}

/** Model-owned fields are explicitly separated from observed host facts. */
export interface GoalModelCheckpointReport {
  goalId: string; revision: number; expectedModelSequence: number; status: GoalCheckpointStatus
  modelReported: string[]; nextAction: string; questions: string[]; unknownSideEffects: string[]
}

export interface GoalCheckpointModelDto {
  goalId: string
  revision: number
  status: GoalCheckpointStatus
  sequence: number
  modelSequence: number
  updatedAt: number
  counts: { observed: number; modelReported: number; questions: number; unknownSideEffects: number; entryWatermark: number }
  artifactBound: boolean
  entries: Array<{ field: 'observed' | 'modelReported' | 'nextAction' | 'questions' | 'unknownSideEffects'; index: number; partIndex: number; partCount: number; value: string }>
  nextCursor: string | null
}

interface GoalCheckpointPageSnapshot {
  goalId: string
  revision: number
  status: GoalCheckpointStatus
  sequence: number
  modelSequence: number
  updatedAt: number
  counts: GoalCheckpointModelDto['counts']
  artifactBound: boolean
  observed: string[]
  modelReported: string[]
  nextAction: string
  questions: string[]
  unknownSideEffects: string[]
}

const GOAL_CHECKPOINT_DTO_BUDGET_BYTES = 8 * 1024
const GOAL_CHECKPOINT_VALUE_CHUNK_BYTES = 700
const GOAL_CHECKPOINT_PAGE_SNAPSHOT_BUDGET_BYTES = 16 * 1024 * 1024
const GOAL_TOOL_RESULT_MAX_BYTES = 32 * 1024

type CheckpointPageField = GoalCheckpointModelDto['entries'][number]['field']
const CHECKPOINT_PAGE_FIELDS: CheckpointPageField[] = ['observed', 'modelReported', 'nextAction', 'questions', 'unknownSideEffects']

function normalizeStoredCheckpoint(checkpoint: GoalCheckpoint): GoalCheckpoint {
  const modelSequence = (checkpoint as GoalCheckpoint & { modelSequence?: unknown }).modelSequence
  if (modelSequence === undefined) checkpoint.modelSequence = 0 // schemaVersion 1 checkpoints written before modelSequence existed
  else if (!Number.isSafeInteger(modelSequence) || (modelSequence as number) < 0) throw new Error('Goal checkpoint modelSequence/data mismatch')
  return checkpoint
}

function encodeCheckpointCursor(revision: number, sequence: number, fieldIndex: number, itemIndex: number, partIndex: number): string {
  return Buffer.from(JSON.stringify({ v: 1, revision, sequence, fieldIndex, itemIndex, partIndex })).toString('base64url')
}

function decodeCheckpointCursor(cursor: string | undefined, checkpoint: GoalCheckpointPageSnapshot): { fieldIndex: number; itemIndex: number; partIndex: number } {
  if (!cursor) return { fieldIndex: 0, itemIndex: 0, partIndex: 0 }
  if (cursor.length > 200) throw new Error('Goal checkpoint cursor 超长')
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
    if (value.v !== 1 || value.revision !== checkpoint.revision || value.sequence !== checkpoint.sequence ||
      !Number.isSafeInteger(value.fieldIndex) || (value.fieldIndex as number) < 0 || (value.fieldIndex as number) >= CHECKPOINT_PAGE_FIELDS.length ||
      !Number.isSafeInteger(value.itemIndex) || (value.itemIndex as number) < 0 ||
      !Number.isSafeInteger(value.partIndex) || (value.partIndex as number) < 0) throw new Error()
    return { fieldIndex: value.fieldIndex as number, itemIndex: value.itemIndex as number, partIndex: value.partIndex as number }
  } catch { throw new Error('Goal checkpoint cursor 已失效或无效；请重新读取') }
}

function checkpointFieldValues(checkpoint: GoalCheckpointPageSnapshot, field: CheckpointPageField): string[] {
  if (field === 'nextAction') return checkpoint.nextAction ? [checkpoint.nextAction] : []
  return checkpoint[field]
}

function createGoalCheckpointPageSnapshot(checkpointInput: GoalCheckpoint): GoalCheckpointPageSnapshot {
  const checkpoint = normalizeStoredCheckpoint(checkpointInput)
  if (!['active','waiting_user','blocked','paused','claimed_done'].includes(checkpoint.status) ||
    !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0 || !Number.isSafeInteger(checkpoint.modelSequence) ||
    !Array.isArray(checkpoint.entryWatermark) || checkpoint.entryWatermark.length > 50_000 ||
    typeof checkpoint.nextAction !== 'string' || Buffer.byteLength(checkpoint.nextAction, 'utf8') > 5_000) {
    throw new Error('Goal checkpoint progress snapshot 无效')
  }
  const snapshot: GoalCheckpointPageSnapshot = {
    goalId: checkpoint.goalId, revision: checkpoint.revision, status: checkpoint.status,
    sequence: checkpoint.sequence, modelSequence: checkpoint.modelSequence, updatedAt: checkpoint.updatedAt,
    counts: {
      observed: checkpoint.observed.length, modelReported: checkpoint.modelReported.length,
      questions: checkpoint.questions.length, unknownSideEffects: checkpoint.unknownSideEffects.length,
      entryWatermark: checkpoint.entryWatermark.length,
    },
    artifactBound: Boolean(checkpoint.artifactId),
    observed: normalizeList(checkpoint.observed, 'observed'),
    modelReported: normalizeList(checkpoint.modelReported, 'modelReported'),
    nextAction: checkpoint.nextAction,
    questions: normalizeList(checkpoint.questions, 'questions'),
    unknownSideEffects: normalizeList(checkpoint.unknownSideEffects, 'unknownSideEffects'),
  }
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > GOAL_CHECKPOINT_PAGE_SNAPSHOT_BUDGET_BYTES) {
    throw new Error('Goal checkpoint progress snapshot 超出单query内存预算')
  }
  return snapshot
}

function splitCheckpointValue(value: string): string[] {
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  for (const codePoint of value) {
    const bytes = Buffer.byteLength(codePoint, 'utf8')
    if (current && currentBytes + bytes > GOAL_CHECKPOINT_VALUE_CHUNK_BYTES) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }
    current += codePoint
    currentBytes += bytes
  }
  chunks.push(current)
  return chunks
}

export function toGoalCheckpointModelDto(checkpointInput: GoalCheckpoint | GoalCheckpointPageSnapshot, cursor?: string): GoalCheckpointModelDto {
  const checkpoint = 'counts' in checkpointInput ? checkpointInput : createGoalCheckpointPageSnapshot(checkpointInput)
  let { fieldIndex, itemIndex, partIndex } = decodeCheckpointCursor(cursor, checkpoint)
  const entries: GoalCheckpointModelDto['entries'] = []
  let nextCursor: string | null = null
  while (fieldIndex < CHECKPOINT_PAGE_FIELDS.length) {
    const field = CHECKPOINT_PAGE_FIELDS[fieldIndex]!
    const values = checkpointFieldValues(checkpoint, field)
    if (itemIndex >= values.length) { fieldIndex += 1; itemIndex = 0; partIndex = 0; continue }
    const parts = splitCheckpointValue(values[itemIndex]!)
    if (partIndex >= parts.length) { itemIndex += 1; partIndex = 0; continue }
    entries.push({ field, index: itemIndex, partIndex, partCount: parts.length, value: parts[partIndex]! })
    partIndex += 1
    if (partIndex >= parts.length) { itemIndex += 1; partIndex = 0 }
    if (itemIndex >= values.length) { fieldIndex += 1; itemIndex = 0; partIndex = 0 }
    if (fieldIndex < CHECKPOINT_PAGE_FIELDS.length) nextCursor = encodeCheckpointCursor(checkpoint.revision, checkpoint.sequence, fieldIndex, itemIndex, partIndex)
    break
  }
  const dto: GoalCheckpointModelDto = {
    goalId: checkpoint.goalId, revision: checkpoint.revision, status: checkpoint.status,
    sequence: checkpoint.sequence, modelSequence: checkpoint.modelSequence, updatedAt: checkpoint.updatedAt,
    counts: checkpoint.counts,
    artifactBound: checkpoint.artifactBound, entries, nextCursor,
  }
  if (Buffer.byteLength(JSON.stringify(dto), 'utf8') > GOAL_CHECKPOINT_DTO_BUDGET_BYTES) throw new Error('Goal checkpoint DTO 超出有界页预算')
  return dto
}

function createGoalCheckpointToolResult(payload: GoalCheckpointModelDto): AgentToolResult<unknown> {
  const text = JSON.stringify(payload)
  const result = { content: [{ type: 'text', text }], details: payload }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > GOAL_TOOL_RESULT_MAX_BYTES) throw new Error('Goal checkpoint tool result 超过32KiB预算')
  return result as AgentToolResult<unknown>
}

type GoalModelCheckpointFields = Omit<GoalModelCheckpointReport, 'expectedModelSequence'>

function validateModelCheckpoint(input: GoalModelCheckpointFields): void {
  if (!(['active', 'waiting_user', 'blocked', 'paused', 'claimed_done'] as string[]).includes(input.status)) throw new Error('模型不能提交该 Goal 状态')
  if (Buffer.byteLength(input.nextAction, 'utf8') > 5_000) throw new Error('nextAction 超长')
  normalizeList(input.modelReported, 'modelReported'); normalizeList(input.questions, 'questions'); normalizeList(input.unknownSideEffects, 'unknownSideEffects')
}

export function recordGoalModelCheckpoint(input: GoalModelCheckpointFields & {expectedSequence:number}): GoalCheckpoint {
  validateModelCheckpoint(input)
  return commitCheckpointUpdate(input.goalId, input.revision, input.expectedSequence, (current) => ({
    ...current, modelSequence: current.modelSequence + 1, status: input.status, modelReported: normalizeList(input.modelReported, 'modelReported'),
    nextAction: input.nextAction, questions: normalizeList(input.questions, 'questions'),
    unknownSideEffects: normalizeList(input.unknownSideEffects, 'unknownSideEffects'),
  }))
}

/** Tool report uses an independent model sequence so host turn_end observations do not invalidate it. */
export function recordGoalModelCheckpointLatest(input: GoalModelCheckpointReport): GoalCheckpoint {
  validateModelCheckpoint(input)
  if (!Number.isSafeInteger(input.expectedModelSequence) || input.expectedModelSequence < 0) throw new Error('checkpoint expectedModelSequence 无效')
  const db = openDatabase()
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT sequence,payload FROM checkpoints WHERE goal_id=? AND revision=?').get(input.goalId,input.revision) as {sequence:number;payload:string}|undefined
      if (!row) throw new Error('Goal checkpoint 不存在')
      const current = normalizeStoredCheckpoint(JSON.parse(row.payload) as GoalCheckpoint)
      if(current.sequence!==row.sequence)throw new Error('Goal checkpoint sequence/data mismatch')
      const owner = db.prepare('SELECT session_id FROM contracts WHERE id=? AND revision=?').get(input.goalId,input.revision) as {session_id:string}|undefined
      const currentContract = owner ? db.prepare('SELECT revision FROM current_contracts WHERE session_id=?').get(owner.session_id) as {revision:number}|undefined : undefined
      if (currentContract?.revision !== input.revision || current.revision !== input.revision) throw new Error('Goal checkpoint合同revision已失效')
      if (current.modelSequence !== input.expectedModelSequence) throw new Error('Goal checkpoint model sequence CAS 冲突')
      const next:GoalCheckpoint = {...current,status:input.status,modelReported:normalizeList(input.modelReported,'modelReported'),nextAction:input.nextAction,questions:normalizeList(input.questions,'questions'),unknownSideEffects:normalizeList(input.unknownSideEffects,'unknownSideEffects'),sequence:row.sequence+1,modelSequence:current.modelSequence+1,updatedAt:Date.now()}
      const result = db.prepare('UPDATE checkpoints SET sequence=?,payload=?,updated_at=? WHERE goal_id=? AND revision=? AND sequence=?').run(next.sequence,JSON.stringify(next),next.updatedAt,input.goalId,input.revision,row.sequence)
      if (result.changes !== 1) throw new Error('Goal checkpoint latest CAS 冲突')
      db.exec('COMMIT')
      return next
    } catch (error) { db.exec('ROLLBACK'); throw error }
  } finally { db.close() }
}

/** Host-only observed evidence write; never expose this operation as a model tool. */
export function recordGoalObservedCheckpoint(input: {
  goalId: string; revision: number; expectedSequence: number; observed: string[]
  artifactId: string; branchId: string; leafId: string; entryWatermark: string[]; entryHashes: Record<string, string>
}): GoalCheckpoint {
  const watermarkSet = new Set(input.entryWatermark)
  const hashIds = Object.keys(input.entryHashes)
  if (input.entryWatermark.length > GOAL_ARTIFACT_MAX_ENTRIES || watermarkSet.size !== input.entryWatermark.length || input.entryWatermark.some((id) => !/^[A-Za-z0-9_-]{1,160}$/.test(id)) || hashIds.length !== input.entryWatermark.length || hashIds.some((id) => !watermarkSet.has(id) || typeof input.entryHashes[id] !== 'string' || !/^[a-f0-9]{64}$/.test(input.entryHashes[id]!))) throw new Error('observed entry hash 不匹配')
  return commitCheckpointUpdate(input.goalId, input.revision, input.expectedSequence, (current) => ({
    ...current, observed: normalizeList(input.observed, 'observed'), artifactId: input.artifactId,
    branchId: input.branchId, leafId: input.leafId, entryWatermark: [...input.entryWatermark], entryHashes: input.entryHashes,
  }))
}

const goalTaskDataIdentity = Symbol('proma.goal-memory.task-data')
export function injectGoalTaskData<T extends {role:string;content?:unknown}>(messages:T[], context:string):T[] {
  const retained=messages.filter((message)=>!(message as T&{[goalTaskDataIdentity]?:boolean})[goalTaskDataIdentity])
  const lastUser=retained.findLastIndex((message)=>message.role==='user')
  if(lastUser<0)return retained
  const task={role:'user',content:`<goal-memory-task-data>\\n${context}\\n</goal-memory-task-data>`,timestamp:Date.now()} as unknown as T
  Object.defineProperty(task,goalTaskDataIdentity,{value:true,enumerable:false})
  retained.splice(lastUser,0,task)
  return retained
}

export function buildGoalContextPack(contract: GoalContract, checkpoint: GoalCheckpoint, budgetBytes = GOAL_CONTEXT_BUDGET_CHARS): string {
  const required = [
    `Goal ${contract.id} · revision ${contract.revision} · ${contract.hash}`,
    `用户目标原文：${contract.originalText}`,
    `Scope：${contract.scope.join('；')}`,
    `Non-goals：${contract.nonGoals.join('；')}`,
    `硬约束：${contract.hardConstraints.join('；')}`,
    `验收项：${contract.acceptance.join('；')}`,
  ].join('\n')
  if (Buffer.byteLength(required, 'utf8') > budgetBytes) throw new Error('Goal 必需合同字段超出恢复包 UTF-8 字节预算，已阻塞；未截断约束')
  const progress = [
    `状态：${checkpoint.status}`,
    `已观测：${checkpoint.observed.join('；')}`,
    `模型报告（未验证）：${checkpoint.modelReported.join('；')}`,
    `下一步：${checkpoint.nextAction}`,
    `待用户问题：${checkpoint.questions.join('；')}`,
    `未知副作用：${checkpoint.unknownSideEffects.join('；')}`,
  ].join('\n')
  const renderedProgress = `${required}\n\n${progress}`
  if (Buffer.byteLength(renderedProgress, 'utf8') <= budgetBytes) return renderedProgress
  const omission = `${required}\n\n[可选checkpoint进度字段因恢复包预算不足而省略；请用 GoalCheckpointRead 按有界页读取。无cursor会从当前进度开始固定本query快照；nextCursor继续读取同一快照，不受turn_end或compact推进影响。]`
  if (Buffer.byteLength(omission, 'utf8') > budgetBytes) throw new Error('Goal 必需合同字段与进度省略指针超出恢复包预算，已阻塞')
  return omission
}

export interface GoalContractInput {
  expectedRevision: number
  originalText: string
  scope: string[]
  nonGoals: string[]
  hardConstraints: string[]
  acceptance: string[]
}

export type GoalModelStatus = 'active' | 'waiting_user' | 'blocked' | 'claimed_done'

export interface GoalModelCheckpointInput {
  goalId: string
  revision: number
  expectedModelSequence: number
  status: GoalModelStatus
  modelReported: string[]
  nextAction: string
  questions: string[]
  unknownSideEffects: string[]
}

export type GoalMemoryCapabilityRequest = {
  ownerId: string
  sessionId: string
  workspaceId: string
  queryId: string
} & (
  | { operation: 'context'; artifactId: string; leafId: string | null; branchEntryIds: string[] }
  | { operation: 'checkpoint_read'; cursor?: string }
  | { operation: 'compact_ack'; reason: 'manual' | 'threshold' | 'overflow'; artifactId: string; leafId: string | null; branchEntryIds: string[] }
  | { operation: 'checkpoint_model'; input: GoalModelCheckpointReport }
  | { operation: 'turn_end'; artifactId: string; leafId: string; entryIds: string[]; branchEntryIds: string[] }
  | { operation: 'evidence_read'; mode: 'entry' | 'keyword' | 'toolCall'; query: string; offset: number; limit?: number; branchEntryIds: string[]; leafId: string }
)

export interface HostGoalArtifactBinding {
  sessionId: string
  workspaceId: string
  artifactId: string
  artifactIdentity: string
  path: string
  sessionsDirectory: string
}

export interface GoalMemoryCapability {
  ownerId: string
  sessionId: string
  workspaceId: string
  resolveArtifactBinding?: (signal?: AbortSignal) => Promise<HostGoalArtifactBinding | null>
  revoke(): void
  request: (request: GoalMemoryCapabilityRequest, signal?: AbortSignal) => Promise<{ context?: string; checkpoint?: GoalCheckpointModelDto; acknowledged?: boolean; evidence?: ArtifactScanResult }>
}

const GOAL_ARTIFACT_SCAN_MAX_BYTES = 128 * 1024 * 1024
const GOAL_ARTIFACT_MAX_ENTRIES = 50_000
const GOAL_ARTIFACT_MAX_LINE_BYTES = 256 * 1024
const GOAL_ARTIFACT_PAGE_BYTES = 512 * 1024

type ArtifactMeta = { id:string; parentId:string|null; offset:number; length:number; tooLarge:boolean; toolCallIds:string[]; sha256?:string }
type ArtifactScanResult = {status:'ok'|'not-found'|'changed'|'invalid'|'too-large'; lines:string[]; nextOffset?:number; entryHashes?:Record<string,string>; incomplete?:boolean}

type LiteralSearchBudget = { nodes: number; exhausted: boolean }

function containsArtifactLiteral(value:unknown,needle:string,depth=0,budget:LiteralSearchBudget={nodes:10_000,exhausted:false}):boolean {
  if (value == null) return false
  if (depth > 16 || budget.nodes <= 0) { budget.exhausted = true; return false }
  budget.nodes -= 1
  if(typeof value==='string')return value.toLocaleLowerCase().includes(needle.toLocaleLowerCase())
  if(Array.isArray(value))return value.some((item)=>containsArtifactLiteral(item,needle,depth+1,budget))
  if(typeof value==='object')return Object.values(value as Record<string,unknown>).some((item)=>containsArtifactLiteral(item,needle,depth+1,budget))
  return false
}

async function scanBoundArtifact(binding:HostGoalArtifactBinding, branchEntryIds:string[], leafId:string, mode:'entry'|'keyword'|'toolCall', query:string, offset:number, limit:number, signal?:AbortSignal, requiredIds:string[]=[], expectedHashes:Record<string,string>={}, hashOnly=false, allowUnpersistedSuffix=false):Promise<ArtifactScanResult> {
  const fs=await import('node:fs'); const fsp=await import('node:fs/promises'); const pathApi=await import('node:path')
  if (!Array.isArray(branchEntryIds)||branchEntryIds.length<1||branchEntryIds.length>GOAL_ARTIFACT_MAX_ENTRIES||branchEntryIds.at(-1)!==leafId||!Number.isSafeInteger(offset)||offset<0||!query||query.length>500) return {status:'invalid',lines:[]}
  let canonicalPath:string; let before:Awaited<ReturnType<typeof fsp.stat>>; let root:string
  try {
    if ((await fsp.lstat(binding.path)).isSymbolicLink()) return {status:'invalid',lines:[]}
    canonicalPath=await fsp.realpath(binding.path); root=await fsp.realpath(binding.sessionsDirectory)
    const relative=pathApi.relative(root,canonicalPath)
    if (!relative||relative.startsWith('..')||pathApi.isAbsolute(relative)||canonicalPath!==binding.path) return {status:'invalid',lines:[]}
    before=await fsp.stat(canonicalPath)
    if (before.size>GOAL_ARTIFACT_SCAN_MAX_BYTES) return {status:'too-large',lines:[]}
  } catch (error) { if ((error as NodeJS.ErrnoException).code==='ENOENT'||(error as NodeJS.ErrnoException).code==='ELOOP') return {status:'not-found',lines:[]}; throw error }
  const index=new Map<string,ArtifactMeta>(); const branchSet=new Set(branchEntryIds); const hits:string[]=[]
  if(signal?.aborted)return {status:'changed',lines:[]}
  const sourceHandle=await fsp.open(canonicalPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)
  if(signal?.aborted){await sourceHandle.close().catch(()=>{});return {status:'changed',lines:[]}}
  let stream:ReturnType<typeof sourceHandle.createReadStream>|undefined
  const abortMainStream=():void=>{stream?.destroy(new Error('Goal artifact scan canceled'))}
  signal?.addEventListener('abort',abortMainStream,{once:true})
  let absolute=0,lineStart=0,lineLength=0,parts:Buffer[]=[],prefix:Buffer[]=[]; let lineDigest=createHash('sha256');let tooLargeLine=false,oversizedBranch=false,scanFailed=false,keywordScanIncomplete=false,toolCallScanIncomplete=false
  const processLine=(raw:Buffer, start:number, length:number, oversized:boolean,lineHash:string):void=>{
    let row:Record<string,unknown>|undefined
    if (!oversized) { try { const parsed=JSON.parse(raw.toString('utf8')); if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)) row=parsed } catch { return } }
    else {
      const head=Buffer.concat(prefix).toString('utf8')
      const id=head.match(/\"id\"\s*:\s*\"([A-Za-z0-9_-]{1,160})\"/)?.[1]
      const parentId=head.match(/\"parentId\"\s*:\s*(?:\"([A-Za-z0-9_-]{1,160})\"|null)/)
      if(id) row={id,parentId:parentId?.[1]??null,type:'oversized'}
    }
    if(typeof row?.id!=='string'||! /^[A-Za-z0-9_-]{1,160}$/.test(row.id)) return
    if(index.has(row.id)||index.size>=GOAL_ARTIFACT_MAX_ENTRIES){scanFailed=true;return}
    const toolCallIds:string[]=[]
    const visit=(v:unknown,d=0,budget={nodes:10_000}):void=>{
      if(v==null)return
      if(d>16||budget.nodes<=0||toolCallIds.length>=100){toolCallScanIncomplete=true;return}
      budget.nodes-=1
      if(Array.isArray(v)){for(const item of v)visit(item,d+1,budget)}
      else if(typeof v==='object'){
        const object=v as Record<string,unknown>
        if(typeof object.toolCallId==='string')toolCallIds.push(object.toolCallId)
        if(object.type==='toolCall'&&typeof object.id==='string')toolCallIds.push(object.id)
        for(const item of Object.values(object))visit(item,d+1,budget)
      }
    }
    const parent=typeof row.parentId==='string'?row.parentId:null
    const meta:ArtifactMeta={id:row.id,parentId:parent,offset:start,length,tooLarge:oversized,toolCallIds,sha256:lineHash}
    index.set(row.id,meta)
    if(branchSet.has(row.id)){
      if(oversized)oversizedBranch=true
      else visit(row)
      const budget:LiteralSearchBudget={nodes:10_000,exhausted:false}
      const matched= mode==='entry'?row.id===query:mode==='toolCall'?toolCallIds.includes(query):!oversized&&containsArtifactLiteral(row,query,0,budget)
      if(budget.exhausted)keywordScanIncomplete=true
      if(matched)hits.push(row.id)
    }
  }
  const pushBytes=(buf:Buffer,start:number):void=>{ if(buf.length===0)return; lineDigest.update(buf);const wasSmall=!tooLargeLine; lineLength+=buf.length; if(wasSmall&&lineLength<=GOAL_ARTIFACT_MAX_LINE_BYTES)parts.push(buf); else { if(wasSmall){prefix=parts.slice(0);parts=[];tooLargeLine=true} const have=prefix.reduce((n,b)=>n+b.length,0);if(have<16*1024)prefix.push(buf.subarray(0,Math.max(0,16*1024-have))) } }
  try {
    stream=sourceHandle.createReadStream({highWaterMark:64*1024,autoClose:false})
    if(signal?.aborted)abortMainStream()
    for await(const value of stream){
      if(signal?.aborted){stream.destroy();return {status:'changed',lines:[]}}
      const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);const chunkBase=absolute;let pos=0
      while(pos<chunk.length){
        const nl=chunk.indexOf(10,pos);const end=nl<0?chunk.length:nl;pushBytes(chunk.subarray(pos,end),chunkBase+pos)
        if(nl>=0){processLine(tooLargeLine?Buffer.alloc(0):Buffer.concat(parts),lineStart,lineLength,tooLargeLine,lineDigest.digest('hex'));lineStart=chunkBase+nl+1;lineLength=0;parts=[];prefix=[];lineDigest=createHash('sha256');tooLargeLine=false;pos=nl+1}
        else pos=chunk.length
      }
      absolute=chunkBase+chunk.length
    }
    if(lineLength>0)processLine(tooLargeLine?Buffer.alloc(0):Buffer.concat(parts),lineStart,lineLength,tooLargeLine,lineDigest.digest('hex'))
  } catch(error){ if(signal?.aborted)return {status:'changed',lines:[]}; throw error }
  finally { signal?.removeEventListener('abort',abortMainStream);stream?.destroy();await sourceHandle.close().catch(() => {}) }
  if(scanFailed)return {status:'too-large',lines:[]}
  if(keywordScanIncomplete||mode==='toolCall'&&toolCallScanIncomplete)return {status:'too-large',lines:[],incomplete:true}
  const after=await fsp.stat(canonicalPath)
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)return {status:'changed',lines:[]}
  let missingBranchSuffix=false
  const persistedBranchIds:string[]=[]
  for(let i=0;i<branchEntryIds.length;i++){
    const id=branchEntryIds[i]!
    const item=index.get(id)
    if(!item){if(allowUnpersistedSuffix){missingBranchSuffix=true;continue}return {status:'invalid',lines:[]}}
    if(missingBranchSuffix)return {status:'invalid',lines:[]}
    if(i>0&&item.parentId!==branchEntryIds[i-1])return {status:'invalid',lines:[]}
    persistedBranchIds.push(id)
  }
  if(!persistedBranchIds.length&& !allowUnpersistedSuffix)return {status:'invalid',lines:[]}
  for(const [id,expected] of Object.entries(expectedHashes)){const meta=index.get(id);if(!branchSet.has(id)||!meta)return {status:'invalid',lines:[]};if(!meta.sha256||meta.sha256!==expected)return {status:'changed',lines:[]}}
  if(oversizedBranch&&mode!=='entry'&&!hashOnly)return {status:'too-large',lines:[]}
  const entryHashes:Record<string,string>={}
  for(const id of requiredIds){const meta=index.get(id);if(!meta){if(allowUnpersistedSuffix&&missingBranchSuffix)continue;return {status:'invalid',lines:[]}}if(!branchSet.has(id)||!meta.sha256)return {status:'invalid',lines:[]};entryHashes[id]=meta.sha256}
  if(hashOnly)return {status:'ok',lines:[],...(requiredIds.length?{entryHashes}:{})}
  const selected=hits.slice(offset,offset+Math.min(Math.max(limit,1),20)); if(!selected.length)return {status:'not-found',lines:[],...(requiredIds.length?{entryHashes}:{})}
  for(const id of selected){const meta=index.get(id)!;if(meta.tooLarge)return {status:'too-large',lines:[]};if(expectedHashes[id]&&meta.sha256!==expectedHashes[id])return {status:'changed',lines:[]}}
  const lines:string[]=[];let total=0
  for(const id of selected){const item=index.get(id)!;if(item.tooLarge||item.length>GOAL_ARTIFACT_MAX_LINE_BYTES||total+item.length>GOAL_ARTIFACT_PAGE_BYTES){if(lines.length===0)return {status:'too-large',lines:[]};break}
    if(signal?.aborted)return {status:'changed',lines:[]}
    const chunks:Buffer[]=[];let read=0;const pageHandle=await fsp.open(canonicalPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)
    let pageStream:ReturnType<typeof pageHandle.createReadStream>|undefined
    const abortPageStream=():void=>{pageStream?.destroy(new Error('Goal artifact page scan canceled'))}
    signal?.addEventListener('abort',abortPageStream,{once:true})
    try {
      pageStream=pageHandle.createReadStream({start:item.offset,end:item.offset+item.length-1,autoClose:false})
      if(signal?.aborted)abortPageStream()
      for await(const chunk of pageStream){if(signal?.aborted)return {status:'changed',lines:[]};const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);read+=b.length;if(read>GOAL_ARTIFACT_MAX_LINE_BYTES)return {status:'too-large',lines:[]};chunks.push(b)}
    } catch(error) { if(signal?.aborted)return {status:'changed',lines:[]};throw error }
    finally { signal?.removeEventListener('abort',abortPageStream);pageStream?.destroy();await pageHandle.close().catch(() => {}) }
    if(read!==item.length)return {status:'changed',lines:[]};const rawLine=Buffer.concat(chunks);if(item.sha256!==createHash('sha256').update(rawLine).digest('hex'))return {status:'changed',lines:[]};const line=rawLine.toString('utf8');lines.push(line);total+=read
  }
  const finalStat=await fsp.stat(canonicalPath);if(before.dev!==finalStat.dev||before.ino!==finalStat.ino||before.size!==finalStat.size||before.mtimeMs!==finalStat.mtimeMs)return {status:'changed',lines:[]}
  return lines.length?{status:'ok',lines,...(offset+lines.length<hits.length?{nextOffset:offset+lines.length}:{}),...(requiredIds.length?{entryHashes}:{})}:{status:'not-found',lines:[],...(requiredIds.length?{entryHashes}:{})}
}

async function initializeGoalArtifactBinding(
  contract:GoalContract, checkpoint:GoalCheckpoint, binding:HostGoalArtifactBinding, artifactId:string,
  leafId:string, branchEntryIds:string[], signal?:AbortSignal,
):Promise<GoalCheckpoint> {
  if(binding.sessionId!==contract.sessionId||binding.workspaceId!==contract.workspaceId||binding.artifactId!==artifactId||branchEntryIds.at(-1)!==leafId)
    throw new Error('Goal initial artifact/session/workspace binding changed')
  const scan=await scanBoundArtifact(binding,branchEntryIds,leafId,'entry',leafId,0,1,signal,branchEntryIds,{},true,true)
  if(signal?.aborted)throw new Error('Goal initial source binding canceled')
  if(scan.status!=='ok')throw new Error(`Goal initial source binding failed: ${scan.status}`)
  const entryHashes=scan.entryHashes??{}
  const persistedEntryIds=branchEntryIds.filter((id)=>Object.hasOwn(entryHashes,id))
  if(persistedEntryIds.length===0)return checkpoint
  return commitCheckpointUpdate(contract.id,contract.revision,checkpoint.sequence,(current)=>{
    if(current.artifactId&&current.artifactId!==binding.artifactIdentity)throw new Error('Goal artifact identity changed during initial binding')
    if(current.artifactId)throw new Error('Goal initial artifact binding raced with another update; reread checkpoint')
    return {...current,artifactId:binding.artifactIdentity,branchId:persistedEntryIds.at(-1)??'',leafId:persistedEntryIds.at(-1)??'',entryWatermark:persistedEntryIds,entryHashes}
  })
}

async function validateCurrentSource(binding:HostGoalArtifactBinding|null, checkpoint:GoalCheckpoint, sessionId:string, workspaceId:string, artifactId:string, leafId:string|null, branchEntryIds:string[], signal?:AbortSignal):Promise<void> {
  if(!checkpoint.artifactId)return // first contract-only turn: no persisted source is claimed yet
  if(!binding||binding.sessionId!==sessionId||binding.workspaceId!==workspaceId||binding.artifactId!==artifactId||binding.artifactIdentity!==checkpoint.artifactId)throw new Error('Goal current artifact/session/workspace binding changed')
  if(!leafId||branchEntryIds.at(-1)!==leafId)throw new Error('Goal current SessionManager branch/leaf unavailable')
  const watermarkIndex=branchEntryIds.indexOf(checkpoint.leafId)
  if(watermarkIndex<0)throw new Error('Goal current branch no longer descends from the checkpoint leaf')
  const persistedBranch=branchEntryIds.slice(0,watermarkIndex+1)
  const result=await scanBoundArtifact(binding,persistedBranch,checkpoint.leafId,'entry',checkpoint.leafId,0,1,signal,[],checkpoint.entryHashes,true)
  if(signal?.aborted)throw new Error('Goal source validation canceled')
  if(result.status!=='ok')throw new Error(`Goal current source validation failed: ${result.status}`)
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Goal capability 已取消'))
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (complete: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      complete()
    }
    const onAbort = (): void => settle(() => reject(new Error('Goal capability 已取消')))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then((value) => settle(() => resolve(value)), (error: unknown) => settle(() => reject(error)))
    if (signal.aborted) onAbort()
  })
}

/** Main-process owner; only this closure is passed to the in-process or utility adapter. */
export function createGoalMemoryCapability(sessionId: string, workspaceId: string, resolveArtifactBinding?: (signal?: AbortSignal) => Promise<HostGoalArtifactBinding | null>): GoalMemoryCapability {
  const ownerId = randomUUID()
  const lifecycleAbortController = new AbortController()
  let boundQueryId: string | undefined
  let revoked = false
  let checkpointPageSnapshot: GoalCheckpointPageSnapshot | undefined
  const assertActiveQuery = (queryId: string, signal?: AbortSignal): void => {
    if (revoked || (boundQueryId && boundQueryId !== queryId)) throw new Error('Goal capability query 已失效或身份不匹配')
    if (!boundQueryId) boundQueryId = queryId
    if (signal?.aborted) throw new Error('Goal capability 已取消')
  }
  const revoke = (): void => {
    if (revoked) return
    revoked = true
    checkpointPageSnapshot = undefined
    lifecycleAbortController.abort(new Error('Goal capability query 已撤销'))
  }
  return {
    ownerId, sessionId, workspaceId, revoke,
    resolveArtifactBinding,
    async request(request, callerSignal) {
      if (request.ownerId !== ownerId || request.sessionId !== sessionId || request.workspaceId !== workspaceId || !request.queryId || request.queryId.length > 200) {
        throw new Error('Goal capability owner/query/session/workspace 校验失败')
      }
      const signal = callerSignal ? AbortSignal.any([lifecycleAbortController.signal, callerSignal]) : lifecycleAbortController.signal
      assertActiveQuery(request.queryId, signal)
      let response: { context?: string; checkpoint?: GoalCheckpointModelDto; acknowledged?: boolean; evidence?: ArtifactScanResult }
      if (!isGoalMemoryEnabled()) { checkpointPageSnapshot = undefined; throw new Error('Goal Memory 当前已关闭') }
      if (request.operation === 'compact_ack') {
        const contract=getGoalContract(sessionId,workspaceId);const checkpoint=contract?getGoalCheckpoint(contract.id,contract.revision):null
        if(!contract||!checkpoint){checkpointPageSnapshot=undefined;throw new Error('Goal checkpoint unavailable before compact')}
        if(checkpointPageSnapshot&&(checkpointPageSnapshot.goalId!==contract.id||checkpointPageSnapshot.revision!==contract.revision))checkpointPageSnapshot=undefined
        const binding=await awaitWithAbort(Promise.resolve(resolveArtifactBinding?.(signal)??null),signal)
        assertActiveQuery(request.queryId, signal)
        if(binding&&(binding.sessionId!==sessionId||binding.workspaceId!==workspaceId))throw new Error('Goal compact workspace/session binding changed')
        await validateCurrentSource(binding,checkpoint,sessionId,workspaceId,request.artifactId,request.leafId,request.branchEntryIds,signal)
        assertActiveQuery(request.queryId, signal)
        acknowledgeGoalBeforeCompact(sessionId)
        response = { acknowledged: true }
      } else {
        const contract = getGoalContract(sessionId, workspaceId)
        const checkpoint = contract ? getGoalCheckpoint(contract.id, contract.revision) : null
        if (!contract || !checkpoint) {
          checkpointPageSnapshot = undefined
          response = {}
        } else {
          if (checkpointPageSnapshot && (checkpointPageSnapshot.goalId !== contract.id || checkpointPageSnapshot.revision !== contract.revision)) checkpointPageSnapshot = undefined
          if (request.operation === 'context') {
            const binding = await awaitWithAbort(Promise.resolve(resolveArtifactBinding?.(signal) ?? null), signal)
            assertActiveQuery(request.queryId, signal)
            if (binding && (binding.sessionId !== sessionId || binding.workspaceId !== workspaceId || request.artifactId !== binding.artifactId)) throw new Error('Goal context workspace/session/artifact identity changed')
            let currentCheckpoint = checkpoint
            if (!currentCheckpoint.artifactId && binding && request.leafId && request.branchEntryIds.at(-1) === request.leafId) {
              currentCheckpoint = await initializeGoalArtifactBinding(contract, currentCheckpoint, binding, request.artifactId, request.leafId, request.branchEntryIds, signal)
            }
            await validateCurrentSource(binding, currentCheckpoint, sessionId, workspaceId, request.artifactId, request.leafId, request.branchEntryIds, signal)
            assertActiveQuery(request.queryId, signal)
            response = { context: buildGoalContextPack(contract, currentCheckpoint) }
          } else if (request.operation === 'checkpoint_read') {
            if (request.cursor) {
              if (!checkpointPageSnapshot) throw new Error('Goal checkpoint cursor snapshot unavailable; restart from root')
              response = { checkpoint: toGoalCheckpointModelDto(checkpointPageSnapshot, request.cursor) }
            } else {
              checkpointPageSnapshot = createGoalCheckpointPageSnapshot(checkpoint)
              response = { checkpoint: toGoalCheckpointModelDto(checkpointPageSnapshot) }
            }
          } else if (request.operation === 'checkpoint_model') {
            if (request.input.goalId !== contract.id || request.input.revision !== contract.revision) throw new Error('Goal checkpoint合同revision已失效')
            const updated = recordGoalModelCheckpointLatest(request.input)
            checkpointPageSnapshot = createGoalCheckpointPageSnapshot(updated)
            response = { checkpoint: toGoalCheckpointModelDto(checkpointPageSnapshot) }
          } else if (request.operation === 'turn_end') {
            const binding = await awaitWithAbort(Promise.resolve(resolveArtifactBinding?.(signal) ?? null), signal)
            assertActiveQuery(request.queryId, signal)
            if (!binding || binding.sessionId !== sessionId || binding.workspaceId !== workspaceId || binding.artifactId !== request.artifactId) throw new Error('Goal artifact binding 无效或已替换')
            const entryPattern = /^[A-Za-z0-9_-]{1,160}$/
            const branchSet = new Set(request.branchEntryIds)
            if (!entryPattern.test(request.leafId) || request.entryIds.length < 1 || request.entryIds.length > 100 || request.branchEntryIds.length > GOAL_ARTIFACT_MAX_ENTRIES || request.entryIds.some((id) => !entryPattern.test(id) || !branchSet.has(id)) || !branchSet.has(request.leafId)) throw new Error('Goal turn_end entry IDs 不合法')
            if (checkpoint.artifactId && checkpoint.artifactId !== binding.artifactIdentity) throw new Error('Goal artifact identity changed')
            if (checkpoint.leafId && !request.branchEntryIds.includes(checkpoint.leafId)) throw new Error('Goal branch rewind detected; explicit rebind required')
            const persisted = await scanBoundArtifact(binding, request.branchEntryIds, request.leafId, 'entry', request.leafId, 0, 1, signal, request.branchEntryIds, checkpoint.entryHashes, true)
            assertActiveQuery(request.queryId, signal)
            if (persisted.status !== 'ok' || Object.keys(persisted.entryHashes ?? {}).length !== request.branchEntryIds.length) throw new Error(`Goal turn_end artifact verification failed: ${persisted.status}`)
            const nextCheckpoint = recordGoalObservedCheckpoint({
              goalId: contract.id, revision: contract.revision, expectedSequence: checkpoint.sequence,
              observed: [...checkpoint.observed.slice(-49), `Pi turn_end 已持久化 entries: ${request.entryIds.join(',')}`],
              artifactId: binding.artifactIdentity, branchId: request.leafId, leafId: request.leafId,
              entryWatermark: request.branchEntryIds, entryHashes: persisted.entryHashes ?? {},
            })
            response = { checkpoint: toGoalCheckpointModelDto(nextCheckpoint) }
          } else if (request.operation === 'evidence_read') {
            const binding = await awaitWithAbort(Promise.resolve(resolveArtifactBinding?.(signal) ?? null), signal)
            assertActiveQuery(request.queryId, signal)
            if (!binding || binding.sessionId !== sessionId || binding.workspaceId !== workspaceId) throw new Error('Goal evidence artifact binding changed')
            if (request.branchEntryIds.at(-1) !== request.leafId) throw new Error('Goal evidence branch leaf mismatch')
            let currentCheckpoint = checkpoint
            if (!currentCheckpoint.artifactId) currentCheckpoint = await initializeGoalArtifactBinding(contract, currentCheckpoint, binding, binding.artifactId, request.leafId, request.branchEntryIds, signal)
            if (currentCheckpoint.artifactId && binding.artifactIdentity !== currentCheckpoint.artifactId) throw new Error('Goal evidence artifact binding changed')
            if (currentCheckpoint.leafId && !request.branchEntryIds.includes(currentCheckpoint.leafId)) throw new Error('Goal evidence branch rewind or leaf mismatch')
            const result = await scanBoundArtifact(binding, request.branchEntryIds, request.leafId, request.mode, request.query, request.offset, request.limit ?? 20, signal, [], currentCheckpoint.entryHashes, false, true)
            assertActiveQuery(request.queryId, signal)
            response = { evidence: result }
          } else throw new Error('未知 Goal capability operation')
        }
      }
      assertActiveQuery(request.queryId, signal)
      return response
    },
  }
}

type GoalToolSdk = typeof import('@earendil-works/pi-coding-agent')

export function buildGoalMemoryTools(
  sdk: GoalToolSdk,
  capability: GoalMemoryCapability,
  sessionId: string,
  queryId: string,
  sessionManager: { getLeafId(): string | null; getBranch(): Array<{id:string}> },
  createJsonToolResult: (payload: unknown) => AgentToolResult<unknown>,
): ToolDefinition[] {
  const identity = { ownerId: capability.ownerId, sessionId, workspaceId: capability.workspaceId, queryId }
  return [
    sdk.defineTool({
      name: 'GoalCheckpointRead', label: '读取 Goal checkpoint',
      description: '分页读取当前用户合同revision的checkpoint。无cursor会从当前进度开始并固定本query快照；nextCursor读取同一快照，不受turn_end或compact刷新影响。成功Report或再次无cursor读取会更新快照；合同revision变化、功能关闭或query revoke后旧游标失效。返回有界DTO；host entry索引不对模型开放。若partCount大于1，需按同field/index的partIndex顺序拼接；模型报告与宿主观测分开，不能修改合同或宣称verified/completed。',
      promptSnippet: '需要核对Goal进度时，无cursor开始新的checkpoint快照；有nextCursor时继续同一快照直至读完，分片按field/index与partIndex拼接。模型报告不等于验证事实。',
      parameters: Type.Object({ cursor: Type.Optional(Type.String({ maxLength: 200 })) }, { additionalProperties: false }),
      async execute(_toolCallId, params, signal) {
        const response = await capability.request({ ...identity, operation: 'checkpoint_read', ...(params.cursor ? { cursor: params.cursor } : {}) }, signal)
        return response.checkpoint ? createGoalCheckpointToolResult(response.checkpoint) : createJsonToolResult({error:'当前Goal checkpoint不可用'})
      },
    }),
    sdk.defineTool({
      name: 'GoalEvidenceRead', label: '读取 Goal 历史原文证据',
      description: '在当前真实Pi branch内按精确entry ID、toolCall ID或字面关键词定位并分页读取原始JSONL entry；不接受任意路径或session。超限/变更来源须停止说明，不可摘要冒充原文。',
      promptSnippet: '回读证据时选择精确entry、toolCall ID或字面关键词；只读取返回的完整原文，不推断不可见内容。',
      parameters: Type.Object({
        mode: Type.Union([Type.Literal('entry'),Type.Literal('keyword'),Type.Literal('toolCall')]),
        query: Type.String({ minLength: 1, maxLength: 500 }),
        offset: Type.Integer({ minimum: 0 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      }, { additionalProperties: false }),
      async execute(_toolCallId, params, signal) {
        const leafId=sessionManager.getLeafId(); const branchEntryIds=sessionManager.getBranch().map((entry)=>entry.id)
        if(!leafId)return createJsonToolResult({status:'not-found',lines:[]})
        const response=await capability.request({ ...identity, operation:'evidence_read', mode:params.mode, query:params.query, offset:params.offset, limit:params.limit, branchEntryIds, leafId },signal)
        return createJsonToolResult(response)
      },
    }),
    sdk.defineTool({
      name: 'GoalCheckpointReport', label: '报告 Goal 进度',
      description: '使用GoalCheckpointRead返回的goalId、revision与modelSequence做CAS，报告模型判断、下一步、待用户问题及未知副作用。成功报告会刷新本query分页快照并返回第一页；继续用nextCursor可跨turn_end读取该快照。不得伪造host observed，旧revision/token会被拒绝。',
      promptSnippet: '先读取当前checkpoint，原样提交其goalId、revision、modelSequence；成功Report后若有nextCursor，继续读取同一快照。冲突时重新读取，未核验内容只写modelReported。',
      parameters: Type.Object({
        goalId: Type.String({ minLength: 1, maxLength: 100 }),
        revision: Type.Integer({ minimum: 1 }),
        expectedModelSequence: Type.Integer({ minimum: 0 }),
        status: Type.Union([Type.Literal('active'), Type.Literal('waiting_user'), Type.Literal('blocked'), Type.Literal('claimed_done')]),
        modelReported: Type.Array(Type.String({ maxLength: 2_000 }), { maxItems: 50 }),
        nextAction: Type.String({ maxLength: 2_000 }),
        questions: Type.Array(Type.String({ maxLength: 2_000 }), { maxItems: 50 }),
        unknownSideEffects: Type.Array(Type.String({ maxLength: 2_000 }), { maxItems: 50 }),
      }, { additionalProperties: false }),
      async execute(_toolCallId, params, signal) {
        const response=await capability.request({ ...identity, operation:'checkpoint_model', input:params },signal)
        return response.checkpoint ? createGoalCheckpointToolResult(response.checkpoint) : createJsonToolResult({error:'当前Goal checkpoint不可用'})
      },
    }),
  ]
}

export function isGoalCommandSourceAllowed(input: { triggeredBy?: 'user' | 'automation' | 'delegation' | 'external'; automationContext?: string; userMessage: string }): boolean {
  if (input.automationContext !== undefined || input.triggeredBy === 'automation' || input.triggeredBy === 'delegation') return false
  if (input.triggeredBy === 'external' && input.userMessage.trimStart().startsWith('【子任务完成·自动通知】')) return false
  return true
}

export function buildGoalRestoreReply(contract: GoalContract, checkpoint: GoalCheckpoint): string {
  const source = contract.userMessageRef ? `userMessageRef=${contract.userMessageRef}` : '来源引用未知'
  return `以下恢复包只提供恢复信息，不会自动执行。合同来源为历史记录（${source}），不构成本轮新的用户授权。checkpoint只是历史快照；本命令未核验当前artifact/branch，需在下次query中验证：\n\n${buildGoalContextPack(contract, checkpoint)}`
}

export type GoalCommand = { command: 'set' | 'revise'; input: GoalContractInput } | { command: 'status' | 'restore' | 'off' }

export function parseGoalCommand(message: string): GoalCommand | null {
  const match = /^\/goal(?:\s+([a-z-]+))?(?:\s+([\s\S]*))?\s*$/.exec(message)
  if (!match) return null
  const command = match[1] ?? 'help'
  const body = match[2]?.trim() ?? ''
  if (command === 'status' || command === 'restore' || command === 'off') {
    if (body) throw new Error('此 Goal 命令不接受额外参数')
    return { command }
  }
  if (command === 'set' || command === 'revise') {
    let parsed: unknown
    try { parsed = JSON.parse(body) } catch { throw new Error('Goal 合同必须以 JSON 对象提供完整字段') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Goal 合同必须是 JSON 对象')
    const data = parsed as Record<string, unknown>
    const allowed = new Set(['expectedRevision', 'originalText', 'scope', 'nonGoals', 'hardConstraints', 'acceptance'])
    if (Object.keys(data).some((key) => !allowed.has(key))) throw new Error('Goal 合同包含未知字段；拒绝忽略')
    if (!Number.isSafeInteger(data.expectedRevision) || (data.expectedRevision as number) < 0) throw new Error('expectedRevision 必须是非负整数')
    if (typeof data.originalText !== 'string' || !data.originalText.trim()) throw new Error('originalText 必须是非空原文')
    const list = (key: string): string[] => {
      const value = data[key]
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`${key} 必须是字符串数组（可为空）`)
      return value as string[]
    }
    return { command, input: {
      expectedRevision: data.expectedRevision as number, originalText: data.originalText,
      scope: list('scope'), nonGoals: list('nonGoals'), hardConstraints: list('hardConstraints'), acceptance: list('acceptance'),
    } }
  }
  throw new Error('用法：/goal set <JSON合同>、/goal revise <JSON合同>、/goal status、/goal restore、/goal off')
}

export function disableGoalMemoryForTestOnly(): void { /* test seam; deliberately does not delete persisted user data */ }
