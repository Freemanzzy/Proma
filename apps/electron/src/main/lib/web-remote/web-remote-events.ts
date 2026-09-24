import { agentEventBus } from '../agent-service'
import { permissionService } from '../agent-permission-service'
import type { PermissionRequest } from '@proma/shared'
import { toWebRemoteEvent, toWebRemotePermissionRequest, toWebRemoteRefreshEvent, type WebRemoteEvent } from './web-remote-dto'

const MAX_BUFFERED_BYTES = 1_000_000
const DELTA_INTERVAL_MS = 100

export interface WebRemoteConnection {
  readonly deviceId: string
  readonly bufferedAmount?: number
  send(payload: string): boolean
  close(code?: number, reason?: string): void
}

interface ConnectionState {
  connection: WebRemoteConnection
  sessions: Set<string>
  pendingDeltas: string[]
  deltaTimer?: ReturnType<typeof setTimeout>
}

function sendEvent(state: ConnectionState, event: WebRemoteEvent): void {
  if ((state.connection.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) {
    state.pendingDeltas = []
    if (!state.connection.send(JSON.stringify(toWebRemoteRefreshEvent()))) state.connection.close(1013, 'backpressure')
    return
  }
  if (!state.connection.send(JSON.stringify(event))) state.connection.close(1011, 'send failed')
}

export class WebRemoteEventHub {
  private readonly connections = new Set<ConnectionState>()
  private readonly unsubscribe: () => void

  constructor(
    private readonly pendingRequests: () => PermissionRequest[] = () => permissionService.getPendingRequests(),
  ) {
    this.unsubscribe = agentEventBus.on((sessionId, payload) => {
      const events = toWebRemoteEvent(sessionId, payload)
      for (const event of events) this.broadcast(sessionId, event)
    })
  }

  dispose(): void {
    this.unsubscribe()
    for (const state of this.connections) {
      if (state.deltaTimer) clearTimeout(state.deltaTimer)
      state.connection.close(1001, 'server stopping')
    }
    this.connections.clear()
  }

  addConnection(connection: WebRemoteConnection): () => void {
    const state: ConnectionState = { connection, sessions: new Set(), pendingDeltas: [] }
    this.connections.add(state)
    return () => {
      if (state.deltaTimer) clearTimeout(state.deltaTimer)
      state.pendingDeltas = []
      this.connections.delete(state)
    }
  }

  subscribe(connection: WebRemoteConnection, sessionIds: string[]): void {
    const state = [...this.connections].find((candidate) => candidate.connection === connection)
    if (!state) return
    state.sessions = new Set(sessionIds)
    for (const request of this.pendingRequests()) {
      if (state.sessions.has(request.sessionId)) {
        sendEvent(state, { type: 'permission_request', request: toWebRemotePermissionRequest(request) })
      }
    }
  }

  sendSnapshot(connection: WebRemoteConnection, events: WebRemoteEvent[]): void {
    const state = [...this.connections].find((candidate) => candidate.connection === connection)
    if (!state) return
    for (const event of events) sendEvent(state, event)
  }

  broadcast(sessionId: string, event: WebRemoteEvent): void {
    for (const state of this.connections) {
      if (!state.sessions.has(sessionId)) continue
      if (event.type === 'text_delta') {
        state.pendingDeltas.push(event.text)
        if (!state.deltaTimer) {
          state.deltaTimer = setTimeout(() => {
            state.deltaTimer = undefined
            const text = state.pendingDeltas.join('')
            state.pendingDeltas = []
            if (text) sendEvent(state, { type: 'text_delta', text })
          }, DELTA_INTERVAL_MS)
        }
      } else {
        sendEvent(state, event)
      }
    }
  }

  notifyInteractionResolved(sessionId: string, requestId: string, behavior: 'allow' | 'deny'): void {
    this.broadcast(sessionId, { type: 'permission_resolved', requestId, behavior })
  }

  disconnectDevice(deviceId: string): void {
    for (const state of [...this.connections]) {
      if (state.connection.deviceId === deviceId) state.connection.close(1008, 'device revoked')
    }
  }
}

let activeHub: WebRemoteEventHub | null = null

export function setWebRemoteEventHub(hub: WebRemoteEventHub | null): void {
  activeHub = hub
}

export function notifyWebRemoteInteractionResolved(sessionId: string, requestId: string, behavior: 'allow' | 'deny'): void {
  activeHub?.notifyInteractionResolved(sessionId, requestId, behavior)
}
