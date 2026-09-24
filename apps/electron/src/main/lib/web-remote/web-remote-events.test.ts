import { describe, expect, mock, test } from 'bun:test'
import type { AgentEventHandler } from '../agent-event-bus'
import type { PermissionRequest } from '@proma/shared'

let handler: AgentEventHandler | undefined
mock.module('../agent-service', () => ({
  agentEventBus: { on: (next: AgentEventHandler) => { handler = next; return () => { handler = undefined } }, emit: () => {} },
  isAgentSessionActive: () => false,
  listActiveAgentSessionSnapshots: () => [],
  queueAgentMessage: async () => {},
  runAgentHeadless: async () => {},
  stopAgent: () => {},
}))
mock.module('../agent-permission-service', () => ({ permissionService: { getPendingRequests: () => [{ requestId: 'p', sessionId: 's', toolName: 'Bash', toolInput: { command: 'echo' }, description: 'run', dangerLevel: 'normal', allowAlways: true } satisfies PermissionRequest], respondToPermission: () => null } }))

const { WebRemoteEventHub } = await import('./web-remote-events')

type FakeConnection = { deviceId: string; bufferedAmount: number; sent: string[]; closed: boolean; send(payload: string): boolean; close(): void }
function connection(bufferedAmount = 0): FakeConnection {
  const value = { deviceId: 'd', bufferedAmount, sent: [], closed: false } as unknown as FakeConnection
  value.send = (payload) => { value.sent.push(payload); return true }
  value.close = () => { value.closed = true }
  return value
}

describe('WebRemoteEventHub', () => {
  test('重连补发待审批，增量按 100ms 合并', async () => {
    const hub = new WebRemoteEventHub()
    const client = connection()
    hub.addConnection(client)
    hub.subscribe(client, ['s'])
    expect(JSON.parse(client.sent[0]!).type).toBe('permission_request')
    handler?.('s', { kind: 'sdk_delta', delta: { uuid: 'u', deltas: [{ type: 'text_delta', contentIndex: 0, delta: 'a' }] } })
    handler?.('s', { kind: 'sdk_delta', delta: { uuid: 'u', deltas: [{ type: 'text_delta', contentIndex: 0, delta: 'b' }] } })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(JSON.parse(client.sent.at(-1)!).text).toBe('ab')
    hub.dispose()
  })

  test('发送缓冲超过 1MB 时要求刷新', () => {
    const hub = new WebRemoteEventHub(() => [])
    const client = connection(1_000_001)
    hub.addConnection(client)
    hub.subscribe(client, ['s'])
    handler?.('s', { kind: 'proma_event', event: { type: 'run_stopped' } })
    expect(JSON.parse(client.sent.at(-1)!).type).toBe('refresh_required')
    hub.dispose()
  })
})
