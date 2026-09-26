import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

export type PersonalLogEvent = 'startup' | 'error' | 'fatal'
const MAX_LOG_BYTES = 5 * 1024 * 1024
const ROTATED_LOG_COUNT = 3
const messages: Record<PersonalLogEvent, string> = {
  startup: 'personal main process started',
  error: 'main-process error recorded; details omitted',
  fatal: 'fatal main-process event recorded; details omitted',
}

export function appendPersonalMainLog(filePath: string, event: PersonalLogEvent, now = new Date(), maxBytes = MAX_LOG_BYTES, rotatedCount = ROTATED_LOG_COUNT): void {
  const line = `${now.toISOString()} [${event.toUpperCase()}] ${messages[event]}\n`
  try {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
    chmodSync(dirname(filePath), 0o700)
    if (existsSync(filePath) && statSync(filePath).size + Buffer.byteLength(line) > maxBytes) {
      for (let index = rotatedCount; index >= 1; index--) {
        const source = index === 1 ? filePath : `${filePath}.${index - 1}`
        const target = `${filePath}.${index}`
        if (existsSync(source)) {
          if (index === rotatedCount && existsSync(target)) rmSync(target)
          renameSync(source, target)
        }
      }
    }
    appendFileSync(filePath, line, { encoding: 'utf8', mode: 0o600 })
    chmodSync(filePath, 0o600)
  } catch {
    // Logging must never prevent application startup or replace the original console output.
  }
}
