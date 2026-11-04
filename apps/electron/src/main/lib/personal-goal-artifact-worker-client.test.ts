import { test, expect } from 'bun:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build as esbuildBuild } from 'esbuild'
import { GoalArtifactWorkerRunner, resolveGoalArtifactWorkerPath } from './personal-goal-artifact-worker-client'
import type { ArtifactScanJob } from './personal-goal-artifact-scan'

const workerSource = join(import.meta.dir, 'personal-goal-artifact-worker.ts')

async function buildProductionWorker(outputPath: string): Promise<void> {
  const result = await esbuildBuild({ entryPoints: [workerSource], bundle: true, platform: 'node', format: 'cjs', outfile: outputPath, logLevel: 'silent' })
  expect(result.errors.map((error) => error.text).join('\n')).toBe('')
}

function makeJob(path: string, sessionsDirectory: string, id = 'worker-entry'): ArtifactScanJob {
  return {
    binding: { path, sessionsDirectory },
    branchEntryIds: [id], leafId: id, mode: 'entry', query: id, offset: 0, limit: 1,
    requiredIds: [id], expectedHashes: {}, hashOnly: false, allowUnpersistedSuffix: false,
    options: { captureEvidenceSnapshot: true },
  }
}

function writeTestWorker(root: string, name: string, body: string): string {
  const path = join(root, name)
  writeFileSync(path, `const { parentPort, threadId } = require('node:worker_threads');\nparentPort.on('message', (request) => { ${body} });\n`)
  return path
}

test('production artifact worker scans exact source off-main and resolves packaged layout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'proma-goal-worker-positive-'))
  try {
    const sessionsDirectory = join(root, 'sessions')
    mkdirSync(sessionsDirectory)
    const artifactPath = join(sessionsDirectory, 'session.jsonl')
    const row = JSON.stringify({ id: 'worker-entry', parentId: null, type: 'message', message: { role: 'user', content: 'EXACT_WORKER_SENTINEL 🌒\\ tail' } })
    writeFileSync(artifactPath, `${row}\n`)
    const workerPath = join(root, 'personal-goal-artifact-worker.cjs')
    await buildProductionWorker(workerPath)
    const workerBundle=readFileSync(workerPath,'utf8')
    assert.doesNotMatch(workerBundle,/node:sqlite|@earendil-works|require\(["']electron/,'worker bundle must not include Goal DB, Electron or Pi SDK')
    const builderConfig=readFileSync(join(import.meta.dir,'../../../electron-builder.yml'),'utf8')
    assert.ok(builderConfig.includes('- "dist/personal-goal-artifact-worker.cjs"'),'only the exact CJS worker is configured for asar unpack')
    const runner = new GoalArtifactWorkerRunner({ workerPath, maxActiveWorkers: 1, maxQueuedJobs: 1 })
    const execution = await runner.run(makeJob(realpathSync(artifactPath), realpathSync(sessionsDirectory)))
    assert.ok(execution.workerThreadId > 0, 'worker must report the real Node worker_threads.threadId')
    assert.equal(execution.result.status, 'ok')
    assert.deepEqual(execution.result.lines, [row])
    assert.equal(execution.result.entryHashes?.['worker-entry'], createHash('sha256').update(row).digest('hex'))
    assert.deepEqual(execution.result.snapshotEntries, [{ id: 'worker-entry', sha256: createHash('sha256').update(row).digest('hex'), matched: true }])
    assert.deepEqual(runner.diagnostics(), { activeWorkers: 0, queuedJobs: 0 })
    assert.equal(resolveGoalArtifactWorkerPath('/Applications/Proma.app/Contents/Resources/app.asar/dist/main.cjs'), '/Applications/Proma.app/Contents/Resources/app.asar.unpacked/dist/personal-goal-artifact-worker.cjs')
    assert.equal(resolveGoalArtifactWorkerPath('/repo/apps/electron/dist/main.cjs'), '/repo/apps/electron/dist/personal-goal-artifact-worker.cjs')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('worker runner fails closed on startup, malformed/correlated response, error, empty exit, timeout and abort', async () => {
  const root = mkdtempSync(join(tmpdir(), 'proma-goal-worker-failures-'))
  try {
    const sessionsDirectory = join(root, 'sessions')
    mkdirSync(sessionsDirectory)
    const artifactPath = join(sessionsDirectory, 'session.jsonl')
    writeFileSync(artifactPath, `${JSON.stringify({ id: 'worker-entry', parentId: null })}\n`)
    const job = makeJob(artifactPath, sessionsDirectory)

    const missingRunner = new GoalArtifactWorkerRunner({ workerPath: join(root, 'missing-worker.cjs'), maxJobMs: 250 })
    await assert.rejects(missingRunner.run(job), /worker bundle is missing/)
    assert.deepEqual(missingRunner.diagnostics(), { activeWorkers: 0, queuedJobs: 0 })

    const malformedPath = writeTestWorker(root, 'malformed.cjs', 'parentPort.postMessage({kind:"result", workerThreadId:threadId}); parentPort.close();')
    const malformedRunner = new GoalArtifactWorkerRunner({ workerPath: malformedPath, maxJobMs: 500 })
    await assert.rejects(malformedRunner.run(job), /malformed response/)
    assert.deepEqual(malformedRunner.diagnostics(), { activeWorkers: 0, queuedJobs: 0 })

    const correlationPath = writeTestWorker(root, 'correlation.cjs', `parentPort.postMessage({protocolVersion:1,kind:'result',requestId:'00000000-0000-4000-8000-000000000000',generation:request.generation,workerThreadId:threadId,result:{status:'ok',lines:[]}}); parentPort.close();`)
    const correlationRunner = new GoalArtifactWorkerRunner({ workerPath: correlationPath, maxJobMs: 500 })
    await assert.rejects(correlationRunner.run(job), /correlation mismatch/)
    assert.deepEqual(correlationRunner.diagnostics(), { activeWorkers: 0, queuedJobs: 0 })

    const errorPath = writeTestWorker(root, 'throw.cjs', "throw new Error('worker-error-sentinel');")
    const errorRunner = new GoalArtifactWorkerRunner({ workerPath: errorPath, maxJobMs: 500 })
    await assert.rejects(errorRunner.run(job), /worker error: worker-error-sentinel/)
    assert.deepEqual(errorRunner.diagnostics(), { activeWorkers: 0, queuedJobs: 0 })

    const exitPath = writeTestWorker(root, 'exit-empty.cjs', 'parentPort.close();')
    const exitRunner = new GoalArtifactWorkerRunner({ workerPath: exitPath, maxJobMs: 500 })
    await assert.rejects(exitRunner.run(job), /exited without a result/)
    assert.deepEqual(exitRunner.diagnostics(), { activeWorkers: 0, queuedJobs: 0 })

    const hangPath = writeTestWorker(root, 'hang.cjs', 'void request;')
    const timeoutRunner = new GoalArtifactWorkerRunner({ workerPath: hangPath, maxJobMs: 100 })
    await assert.rejects(timeoutRunner.run(job), /deadline exceeded/)
    assert.deepEqual(timeoutRunner.diagnostics(), { activeWorkers: 0, queuedJobs: 0 })

    const abortPath = writeTestWorker(root, 'abort.cjs', 'void request;')
    const abortRunner = new GoalArtifactWorkerRunner({ workerPath: abortPath, maxJobMs: 1000 })
    const controller = new AbortController()
    const aborted = abortRunner.run(job, controller.signal)
    setTimeout(() => controller.abort(), 20)
    await assert.rejects(aborted, /canceled/)
    assert.deepEqual(abortRunner.diagnostics(), { activeWorkers: 0, queuedJobs: 0 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('worker concurrency and queued work are bounded and settle independently', async () => {
  const root = mkdtempSync(join(tmpdir(), 'proma-goal-worker-queue-'))
  try {
    const artifactPath = join(root, 'unused.jsonl')
    writeFileSync(artifactPath, '')
    // Use a protocol-aware test entry to echo each job's own request id and generation.
    const delayedPath = join(root, 'delayed.cjs')
    writeFileSync(delayedPath, `const { parentPort, threadId } = require('node:worker_threads'); parentPort.on('message', (request) => setTimeout(() => { parentPort.postMessage({protocolVersion:1,kind:'result',requestId:request.requestId,generation:request.generation,workerThreadId:threadId,result:{status:'ok',lines:[]}}); parentPort.close(); }, 100));`)
    const runner = new GoalArtifactWorkerRunner({ workerPath: delayedPath, maxActiveWorkers: 1, maxQueuedJobs: 1, maxJobMs: 2000 })
    const first = runner.run(makeJob(artifactPath, root, 'owner-a'))
    const second = runner.run(makeJob(artifactPath, root, 'owner-b'))
    assert.deepEqual(runner.diagnostics(), { activeWorkers: 1, queuedJobs: 1 })
    await assert.rejects(runner.run(makeJob(artifactPath, root, 'owner-c')), /queue is full/)
    const [firstResult, secondResult] = await Promise.all([first, second])
    assert.ok(firstResult.workerThreadId > 0 && secondResult.workerThreadId > 0)
    assert.equal(firstResult.result.status, 'ok')
    assert.equal(secondResult.result.status, 'ok')
    assert.deepEqual(runner.diagnostics(), { activeWorkers: 0, queuedJobs: 0 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
