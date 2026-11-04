import { isMainThread, parentPort, threadId } from 'node:worker_threads'
import { scanArtifact } from './personal-goal-artifact-scan'
import { GOAL_ARTIFACT_WORKER_PROTOCOL_VERSION, isArtifactScanJob, type ArtifactScanWorkerRequest, type ArtifactScanWorkerResponse } from './personal-goal-artifact-protocol'

if (isMainThread || !parentPort || threadId <= 0) throw new Error('Goal artifact scanner entry must run in a Node Worker thread')

const port = parentPort
let consumed = false

port.on('message', async (value: unknown) => {
  if (consumed) return
  consumed = true
  if (!value || typeof value !== 'object' || Array.isArray(value)) { port.close(); return }
  const request = value as Partial<ArtifactScanWorkerRequest>
  if (request.protocolVersion !== GOAL_ARTIFACT_WORKER_PROTOCOL_VERSION || request.kind !== 'scan' || typeof request.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(request.requestId) || !Number.isSafeInteger(request.generation) || (request.generation as number) < 1 || !isArtifactScanJob(request.job)) { port.close(); return }
  let response: ArtifactScanWorkerResponse
  try {
    const payload = await scanArtifact(request.job)
    response = { protocolVersion: GOAL_ARTIFACT_WORKER_PROTOCOL_VERSION, kind: 'result', requestId: request.requestId, generation: request.generation as number, workerThreadId: threadId, result: payload.result, ...(payload.sourceSnapshot ? { sourceSnapshot: payload.sourceSnapshot } : {}) }
  } catch (error) {
    const candidate = error as { name?: unknown; message?: unknown }
    response = {
      protocolVersion: GOAL_ARTIFACT_WORKER_PROTOCOL_VERSION,
      kind: 'error',
      requestId: request.requestId,
      generation: request.generation as number,
      workerThreadId: threadId,
      error: {
        name: typeof candidate?.name === 'string' ? candidate.name.slice(0, 100) : 'Error',
        message: typeof candidate?.message === 'string' ? candidate.message.slice(0, 1000) : 'Goal artifact scan failed',
      },
    }
  }
  try { port.postMessage(response) } finally { port.close() }
})
