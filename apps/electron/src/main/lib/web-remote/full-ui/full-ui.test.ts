import { describe, expect, test } from 'bun:test'
import { getWebRemoteDeniedError } from './denied-channels'
import { WebRemoteRegistrationTable } from './registration-table'
import { decodeWebRemoteValue, encodeWebRemoteValue } from './serialization'

describe('web remote full-ui spike', () => {
  test('serializes transport-only values and restores them', () => {
    const original = { missing: undefined, when: new Date('2026-09-25T00:00:00.000Z'), bytes: new Uint8Array([1, 2, 3]) }
    const roundTrip = decodeWebRemoteValue(encodeWebRemoteValue(original)) as typeof original
    expect(roundTrip.missing).toBeUndefined()
    expect(roundTrip.when).toBeInstanceOf(Date)
    expect((roundTrip.bytes as Uint8Array)[2]).toBe(3)
  })

  test('returns structured denial for sensitive channels', () => {
    expect(getWebRemoteDeniedError('channel:decrypt-key')).toEqual({ denied: true, channel: 'channel:decrypt-key' })
    expect(getWebRemoteDeniedError('agent:list-sessions')).toBeNull()
  })

  test('keeps an invoke and event registration table', () => {
    const invokes = new WebRemoteRegistrationTable<() => unknown>()
    const events = new WebRemoteRegistrationTable<() => void>()
    invokes.set('demo:invoke', async () => 'ok')
    events.set('demo:event', () => {})
    expect({ invoke: invokes.size, event: events.size }).toEqual({ invoke: 1, event: 1 })
  })
})
