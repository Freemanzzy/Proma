import { describe, expect, test } from 'bun:test'
import { PERSONAL_QUIT_WATCHDOG_TIMEOUT_MS, startPersonalQuitWatchdog } from './personal-quit-watchdog'

describe('personal quit watchdog', () => {
  test('exits and logs the wait duration and safe window summary on timeout', () => {
    let callback: (() => void) | undefined
    let delay = 0
    let now = 1_000
    const logs: string[] = []
    const exits: number[] = []
    startPersonalQuitWatchdog({
      exit: (code) => exits.push(code),
      log: (message) => logs.push(message),
      getWindowSummary: () => 'count=2 types=window,remote',
      now: () => now,
      setTimer: (fn, ms) => { callback = fn; delay = ms; return 1 },
    })

    expect(delay).toBe(PERSONAL_QUIT_WATCHDOG_TIMEOUT_MS)
    now += delay
    callback?.()
    expect(logs).toEqual(['event=quit-stalled waitedMs=15000 windows=count=2 types=window,remote'])
    expect(exits).toEqual([0])
  })

  test('does not exit if will-quit cancels the watchdog first', () => {
    let callback: (() => void) | undefined
    let cleared = false
    const logs: string[] = []
    const exits: number[] = []
    const cancel = startPersonalQuitWatchdog({
      exit: (code) => exits.push(code),
      log: (message) => logs.push(message),
      getWindowSummary: () => 'count=0 types=none',
      setTimer: (fn) => { callback = fn; return 7 },
      clearTimer: (timer) => { cleared = timer === 7 },
    })

    cancel()
    callback?.()
    expect(cleared).toBe(true)
    expect(logs).toEqual([])
    expect(exits).toEqual([])
  })
})
