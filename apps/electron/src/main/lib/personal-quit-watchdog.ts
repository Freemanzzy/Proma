export const PERSONAL_QUIT_WATCHDOG_TIMEOUT_MS = 15_000

export interface PersonalQuitWatchdogOptions {
  exit: (code: number) => void
  log: (message: string) => void
  getWindowSummary: () => string
  timeoutMs?: number
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/** Force exit only if Electron has not reached will-quit after cleanup completed. */
export function startPersonalQuitWatchdog(options: PersonalQuitWatchdogOptions): () => void {
  const timeoutMs = options.timeoutMs ?? PERSONAL_QUIT_WATCHDOG_TIMEOUT_MS
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const startedAt = now()
  let active = true
  const timer = setTimer(() => {
    if (!active) return
    active = false
    const waitedMs = Math.max(0, now() - startedAt)
    options.log(`event=quit-stalled waitedMs=${waitedMs} windows=${options.getWindowSummary()}`)
    options.exit(0)
  }, timeoutMs)

  return () => {
    if (!active) return
    active = false
    clearTimer(timer)
  }
}
