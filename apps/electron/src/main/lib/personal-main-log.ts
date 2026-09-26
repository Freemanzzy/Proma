import { app } from 'electron'
import { join } from 'node:path'
import { isPersonalBuild } from './personal-build'
import { appendPersonalMainLog } from './personal-log-writer'

let installed = false

export function initializePersonalMainLog(): string | null {
  if (!isPersonalBuild()) return null
  let logPath: string
  try { logPath = join(app.getPath('logs'), 'main.log') } catch { return null }
  if (installed) return logPath
  installed = true
  appendPersonalMainLog(logPath, 'startup')
  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)
  const record = (level: 'error' | 'fatal', args: unknown[]): void => {
    const text = args.map((value) => value instanceof Error ? value.message : typeof value === 'string' ? value : '').join(' ').toLowerCase()
    appendPersonalMainLog(logPath, text.includes('fatal') || level === 'fatal' ? 'fatal' : 'error')
  }
  console.error = (...args: unknown[]) => {
    record('error', args)
    originalError(...args)
  }
  console.warn = (...args: unknown[]) => {
    record('error', args)
    originalWarn(...args)
  }
  process.once('uncaughtExceptionMonitor', () => record('fatal', ['uncaught exception']))
  return logPath
}
