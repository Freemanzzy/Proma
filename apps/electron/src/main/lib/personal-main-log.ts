import { app } from 'electron'
import { join } from 'node:path'
import { isPersonalBuild } from './personal-build'
import { appendPersonalMainLog, type PersonalLogEvent } from './personal-log-writer'

let installed = false
let fatalRecorder: ((error: unknown) => void) | null = null

export function initializePersonalMainLog(): string | null {
  if (!isPersonalBuild()) return null
  let logPath: string
  try { logPath = join(app.getPath('logs'), 'main.log') } catch { return null }
  if (installed) return logPath
  installed = true
  appendPersonalMainLog(logPath, 'startup')
  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)
  const record = (event: PersonalLogEvent, args: unknown[]): void => {
    const first = args.find((value) => typeof value === 'string') as string | undefined
    const scope = first?.match(/^\[([^\]]{1,80})\]/)?.[1] ?? 'main'
    const error = args.find((value) => value instanceof Error) as Error | undefined
    const message = args.map((value) => value instanceof Error ? value.message : typeof value === 'string' ? value : '').filter(Boolean).join(' ')
    appendPersonalMainLog(logPath, event, undefined, undefined, undefined, {
      name: error?.name || error?.constructor?.name || 'Error',
      scope,
      message: message || 'no message',
    })
  }
  console.error = (...args: unknown[]) => {
    record('error', args)
    originalError(...args)
  }
  console.warn = (...args: unknown[]) => {
    record('warn', args)
    originalWarn(...args)
  }
  fatalRecorder = (error) => record('fatal', [error])
  process.once('uncaughtExceptionMonitor', (error) => record('fatal', [error]))
  return logPath
}

/** Explicit fatal path for bootstrap failures handled by the degraded-window fallback. */
export function recordPersonalMainFatal(error: unknown): void {
  fatalRecorder?.(error)
}
