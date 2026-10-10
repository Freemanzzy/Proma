import { describe, expect, test } from 'bun:test'
import { registerQuitUnloadGuard, type WillPreventUnloadEventLike } from './quit-unload-guard'

describe('quit unload guard', () => {
  test('allows unload when the application is quitting', () => {
    let listener: ((event: WillPreventUnloadEventLike) => void) | undefined
    let prevented = false
    registerQuitUnloadGuard({ on: (_event, callback) => { listener = callback } }, () => true)
    listener?.({ preventDefault: () => { prevented = true } })
    expect(prevented).toBe(true)
  })

  test('does not change beforeunload behavior outside application quit', () => {
    let listener: ((event: WillPreventUnloadEventLike) => void) | undefined
    let prevented = false
    registerQuitUnloadGuard({ on: (_event, callback) => { listener = callback } }, () => false)
    listener?.({ preventDefault: () => { prevented = true } })
    expect(prevented).toBe(false)
  })
})
