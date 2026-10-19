import { describe, expect, test } from 'bun:test'
import { attachWebRemoteAgentRenameHandler, invokeWebRemoteAgentRenameHandler } from './agent-session-rename'

describe('Web Remote AgentHeader rename entry', () => {
  test('invokes the callback attached to the exact session trigger and cleans it up', () => {
    const trigger = {}
    let calls = 0
    const detach = attachWebRemoteAgentRenameHandler(trigger, () => { calls += 1 })

    expect(invokeWebRemoteAgentRenameHandler(trigger)).toBe(true)
    expect(calls).toBe(1)

    detach()
    expect(invokeWebRemoteAgentRenameHandler(trigger)).toBe(false)
    expect(calls).toBe(1)
  })

  test('does not let stale cleanup remove a replacement callback', () => {
    const trigger = {}
    let calls = 0
    const detachOld = attachWebRemoteAgentRenameHandler(trigger, () => { calls += 10 })
    attachWebRemoteAgentRenameHandler(trigger, () => { calls += 1 })

    detachOld()
    expect(invokeWebRemoteAgentRenameHandler(trigger)).toBe(true)
    expect(calls).toBe(1)
  })

  test('missing triggers are safe', () => {
    const detach = attachWebRemoteAgentRenameHandler(null, () => {})
    expect(invokeWebRemoteAgentRenameHandler(null)).toBe(false)
    detach()
  })
})
