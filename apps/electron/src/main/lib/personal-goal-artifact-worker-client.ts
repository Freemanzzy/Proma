import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isMainThread, Worker } from 'node:worker_threads'
import type { ArtifactScanJob, ArtifactScanResult, ArtifactSourceSnapshot } from './personal-goal-artifact-scan'
import {
  GOAL_ARTIFACT_WORKER_PROTOCOL_VERSION,
  GOAL_ARTIFACT_WORKER_MAX_REQUEST_BYTES,
  isArtifactScanJob,
  isArtifactScanWorkerResponse,
  type ArtifactScanWorkerRequest,
} from './personal-goal-artifact-protocol'

const DEFAULT_MAX_ACTIVE_WORKERS = 2
const DEFAULT_MAX_QUEUED_JOBS = 8
const DEFAULT_MAX_JOB_MS = 55_000
const DEFAULT_WORKER_BASENAME = 'personal-goal-artifact-worker.cjs'

export interface ArtifactScanWorkerExecution {
  result: ArtifactScanResult
  sourceSnapshot?: ArtifactSourceSnapshot
  workerThreadId: number
}

export interface ArtifactScanWorkerRunnerOptions {
  workerPath: string
  maxActiveWorkers?: number
  maxQueuedJobs?: number
  maxJobMs?: number
}

interface PendingJob {
  envelope: ArtifactScanWorkerRequest
  resolve: (execution: ArtifactScanWorkerExecution) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  abortHandler?: () => void
  timer?: ReturnType<typeof setTimeout>
  worker?: Worker
  state: 'queued' | 'active' | 'settling' | 'settled'
  started: boolean
}

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value.slice(0, 1000))
  return new Error(fallback)
}

function cloneForWorker(job: ArtifactScanJob): ArtifactScanJob {
  if (!isArtifactScanJob(job)) throw new Error('Goal artifact worker request shape/byte budget invalid')
  const fixedEvidenceMatchIds = job.options.fixedEvidenceMatchIds
  return {
    binding: { path: job.binding.path, sessionsDirectory: job.binding.sessionsDirectory },
    branchEntryIds: [...job.branchEntryIds],
    leafId: job.leafId,
    mode: job.mode,
    query: job.query,
    offset: job.offset,
    limit: job.limit,
    requiredIds: [...job.requiredIds],
    expectedHashes: { ...job.expectedHashes },
    hashOnly: job.hashOnly,
    allowUnpersistedSuffix: job.allowUnpersistedSuffix,
    options: {
      captureEvidenceSnapshot: job.options.captureEvidenceSnapshot,
      ...(fixedEvidenceMatchIds === undefined ? {} : { fixedEvidenceMatchIds: [...fixedEvidenceMatchIds] }),
    },
  }
}

export function resolveGoalArtifactWorkerPath(runtimeBundleFilename: string): string {
  if (!runtimeBundleFilename || runtimeBundleFilename.length > 4096) throw new Error('Goal artifact worker bundle anchor invalid')
  const unpackedBundleFilename = runtimeBundleFilename.replace(/\.asar(?=[/\\])/, '.asar.unpacked')
  return join(dirname(resolve(unpackedBundleFilename)), DEFAULT_WORKER_BASENAME)
}

function resolveDefaultWorkerPath(): string {
  const cjsBundleFilename = typeof __filename === 'string' && __filename.endsWith('.cjs') ? __filename : undefined
  const mainModuleFilename = process.mainModule?.filename?.endsWith('.cjs') ? process.mainModule.filename : undefined
  const runtimeBundleFilename = cjsBundleFilename ?? mainModuleFilename ?? process.argv[1]
  if (!runtimeBundleFilename) throw new Error('Goal artifact worker bundle anchor unavailable')
  return resolveGoalArtifactWorkerPath(runtimeBundleFilename)
}

export class GoalArtifactWorkerRunner {
  private readonly workerPath: string
  private readonly maxActiveWorkers: number
  private readonly maxQueuedJobs: number
  private readonly maxJobMs: number
  private activeWorkers = 0
  private readonly queue: PendingJob[] = []
  private generation = 0

  constructor(options: ArtifactScanWorkerRunnerOptions) {
    if (!options.workerPath || options.workerPath.length > 4096) throw new Error('Goal artifact worker path invalid')
    const maxActiveWorkers = options.maxActiveWorkers ?? DEFAULT_MAX_ACTIVE_WORKERS
    const maxQueuedJobs = options.maxQueuedJobs ?? DEFAULT_MAX_QUEUED_JOBS
    const maxJobMs = options.maxJobMs ?? DEFAULT_MAX_JOB_MS
    if (!Number.isSafeInteger(maxActiveWorkers) || maxActiveWorkers < 1 || maxActiveWorkers > 4) throw new Error('Goal artifact worker concurrency invalid')
    if (!Number.isSafeInteger(maxQueuedJobs) || maxQueuedJobs < 0 || maxQueuedJobs > 32) throw new Error('Goal artifact worker queue limit invalid')
    if (!Number.isSafeInteger(maxJobMs) || maxJobMs < 25 || maxJobMs > 60_000) throw new Error('Goal artifact worker deadline invalid')
    this.workerPath = resolve(options.workerPath)
    this.maxActiveWorkers = maxActiveWorkers
    this.maxQueuedJobs = maxQueuedJobs
    this.maxJobMs = maxJobMs
  }

  diagnostics(): { activeWorkers: number; queuedJobs: number } {
    return { activeWorkers: this.activeWorkers, queuedJobs: this.queue.length }
  }

  run(jobInput: ArtifactScanJob, signal?: AbortSignal): Promise<ArtifactScanWorkerExecution> {
    if (!isMainThread) return Promise.reject(new Error('Goal artifact worker runner must be called from main thread'))
    if (signal?.aborted) return Promise.reject(new Error('Goal artifact scan canceled'))
    let job: ArtifactScanJob
    try { job = cloneForWorker(jobInput) } catch (error) { return Promise.reject(asError(error, 'Goal artifact worker request invalid')) }
    this.generation += 1
    const envelope: ArtifactScanWorkerRequest = {
      protocolVersion: GOAL_ARTIFACT_WORKER_PROTOCOL_VERSION,
      kind: 'scan',
      requestId: randomUUID(),
      generation: this.generation,
      job,
    }
    let serializedBytes: number
    try { serializedBytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8') }
    catch { return Promise.reject(new Error('Goal artifact worker request cannot be serialized')) }
    if (serializedBytes > GOAL_ARTIFACT_WORKER_MAX_REQUEST_BYTES) return Promise.reject(new Error('Goal artifact worker request exceeds byte budget'))
    return new Promise<ArtifactScanWorkerExecution>((resolvePromise, rejectPromise) => {
      const pending: PendingJob = { envelope, resolve: resolvePromise, reject: rejectPromise, signal, state: 'queued', started: false }
      if (signal) {
        pending.abortHandler = () => {
          this.removeQueued(pending)
          void this.settle(pending, new Error('Goal artifact scan canceled'))
        }
        signal.addEventListener('abort', pending.abortHandler, { once: true })
        if (signal.aborted) { pending.abortHandler(); return }
      }
      pending.timer = setTimeout(() => {
        this.removeQueued(pending)
        void this.settle(pending, new Error('Goal artifact worker deadline exceeded'))
      }, this.maxJobMs)
      if (this.activeWorkers < this.maxActiveWorkers) this.start(pending)
      else if (this.queue.length < this.maxQueuedJobs) this.queue.push(pending)
      else void this.settle(pending, new Error('Goal artifact worker queue is full'))
    })
  }

  private removeQueued(pending: PendingJob): void {
    const index = this.queue.indexOf(pending)
    if (index >= 0) this.queue.splice(index, 1)
  }

  private async settle(pending: PendingJob, error: Error | null, execution?: ArtifactScanWorkerExecution): Promise<void> {
    if (pending.state === 'settling' || pending.state === 'settled') return
    pending.state = 'settling'
    if (pending.timer) clearTimeout(pending.timer)
    if (pending.signal && pending.abortHandler) pending.signal.removeEventListener('abort', pending.abortHandler)
    const worker = pending.worker
    if (worker) {
      try { await worker.terminate() }
      catch (terminateError) { if (!error) error = asError(terminateError, 'Goal artifact worker termination failed') }
      finally { worker.removeAllListeners() }
    }
    if (pending.started) this.activeWorkers = Math.max(0, this.activeWorkers - 1)
    pending.state = 'settled'
    if (error) pending.reject(error)
    else if (execution) pending.resolve(execution)
    else pending.reject(new Error('Goal artifact worker completed without a result'))
    this.drain()
  }

  private start(pending: PendingJob): void {
    if (pending.state !== 'queued') return
    if (pending.signal?.aborted) { void this.settle(pending, new Error('Goal artifact scan canceled')); return }
    try {
      if (!existsSync(this.workerPath) || !statSync(this.workerPath).isFile()) throw new Error('Required Goal artifact worker bundle is missing')
      const worker = new Worker(this.workerPath, { name: 'proma-goal-artifact-scan' })
      pending.worker = worker
      pending.started = true
      pending.state = 'active'
      this.activeWorkers += 1
      const onMessage = (value: unknown): void => {
        if (pending.state !== 'active') return
        if (!isArtifactScanWorkerResponse(value)) { void this.settle(pending, new Error('Goal artifact worker returned malformed response')); return }
        if (value.requestId !== pending.envelope.requestId || value.generation !== pending.envelope.generation) {
          void this.settle(pending, new Error('Goal artifact worker response correlation mismatch'))
          return
        }
        if (value.kind === 'error') { void this.settle(pending, new Error(`Goal artifact worker failed: ${value.error?.message ?? 'unknown error'}`)); return }
        if (!value.result) { void this.settle(pending, new Error('Goal artifact worker result missing')); return }
        void this.settle(pending, null, { result: value.result, ...(value.sourceSnapshot ? { sourceSnapshot: value.sourceSnapshot } : {}), workerThreadId: value.workerThreadId })
      }
      const onError = (error: Error): void => { void this.settle(pending, new Error(`Goal artifact worker error: ${error.message.slice(0, 1000)}`)) }
      const onExit = (code: number): void => {
        if (pending.state !== 'active') return
        void this.settle(pending, new Error(code === 0 ? 'Goal artifact worker exited without a result' : `Goal artifact worker exited with code ${code}`))
      }
      worker.on('message', onMessage)
      worker.once('error', onError)
      worker.once('exit', onExit)
      worker.postMessage(pending.envelope)
    } catch (error) { void this.settle(pending, asError(error, 'Goal artifact worker startup failed')) }
  }

  private drain(): void {
    while (this.activeWorkers < this.maxActiveWorkers && this.queue.length > 0) {
      const pending = this.queue.shift()
      if (pending) this.start(pending)
    }
  }
}

let defaultRunner: GoalArtifactWorkerRunner | undefined

function getDefaultRunner(): GoalArtifactWorkerRunner {
  if (!defaultRunner) defaultRunner = new GoalArtifactWorkerRunner({ workerPath: resolveDefaultWorkerPath() })
  return defaultRunner
}

export function runGoalArtifactScan(job: ArtifactScanJob, signal?: AbortSignal): Promise<ArtifactScanWorkerExecution> {
  return getDefaultRunner().run(job, signal)
}

export function getDefaultGoalArtifactWorkerPath(): string {
  return resolveDefaultWorkerPath()
}

export function getGoalArtifactWorkerDiagnostics(): { created: boolean; activeWorkers: number; queuedJobs: number } {
  return { created: defaultRunner !== undefined, ...(defaultRunner?.diagnostics() ?? { activeWorkers: 0, queuedJobs: 0 }) }
}
