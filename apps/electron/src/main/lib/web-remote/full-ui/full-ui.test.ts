import { describe, expect, test } from 'bun:test'
import { getWebRemoteDeniedError } from './denied-channels'
import { WebRemoteRegistrationTable } from './registration-table'
import { prepareWebRemoteFullUi } from './prepare'
import { decodeWebRemoteValue, encodeWebRemoteValue } from './serialization'

describe('web remote full-ui spike', () => {
  test('serializes transport-only values and restores them', () => {
    const original = { missing: undefined, when: new Date('2026-09-25T00:00:00.000Z'), bytes: new Uint8Array([1, 2, 3]) }
    const roundTrip = decodeWebRemoteValue(encodeWebRemoteValue(original)) as typeof original
    expect(roundTrip.missing).toBeUndefined()
    expect(roundTrip.when).toBeInstanceOf(Date)
    expect((roundTrip.bytes as Uint8Array)[2]).toBe(3)
  })

  test('returns structured denial for sensitive and desktop-only mobile-admin channels', () => {
    expect(getWebRemoteDeniedError('channel:decrypt-key')).toEqual({ denied: true, channel: 'channel:decrypt-key' })
    for (const channel of ['web-remote:admin-get', 'web-remote:admin-save', 'web-remote:admin-pair', 'web-remote:admin-revoke']) {
      expect(getWebRemoteDeniedError(channel)).toEqual({ denied: true, channel })
    }
    expect(getWebRemoteDeniedError('agent:list-sessions')).toBeNull()
  })

  test('keeps an invoke and event registration table', () => {
    const invokes = new WebRemoteRegistrationTable<() => unknown>()
    const events = new WebRemoteRegistrationTable<() => void>()
    invokes.set('demo:invoke', async () => 'ok')
    events.set('demo:event', () => {})
    expect({ invoke: invokes.size, event: events.size }).toEqual({ invoke: 1, event: 1 })
  })

  test('installs synchronously before later handler registration', () => {
    const registered: Record<string, Function> = {}
    const target = {
      handle(channel: string, listener: Function) { registered[`handle:${channel}`] = listener },
      on(channel: string, listener: Function) { registered[`on:${channel}`] = listener },
    }
    const previous = process.env.PROMA_WEB_REMOTE
    process.env.PROMA_WEB_REMOTE = '1'
    try {
      const bridge = prepareWebRemoteFullUi(target, { enabled: true, fullUi: true })
      expect(bridge).toBeTruthy()
      target.handle('demo:invoke', async () => 'ok')
      target.on('demo:event', () => {})
      expect(bridge?.getRegistrationCounts()).toEqual({ invoke: 1, event: 1 })
      expect(typeof registered['handle:demo:invoke']).toBe('function')
    } finally {
      if (previous === undefined) delete process.env.PROMA_WEB_REMOTE
      else process.env.PROMA_WEB_REMOTE = previous
    }
  })
})
