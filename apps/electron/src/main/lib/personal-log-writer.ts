import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

export type PersonalLogEvent = 'startup' | 'info' | 'warn' | 'error' | 'fatal'
const MAX_LOG_BYTES = 5 * 1024 * 1024
const ROTATED_LOG_COUNT = 3
const messages: Record<PersonalLogEvent, string> = {
  startup: 'personal main process started',
  info: 'main-process info',
  warn: 'main-process warning',
  error: 'main-process error',
  fatal: 'fatal main-process error',
}

export interface PersonalLogErrorDetails {
  name?: string
  scope?: string
  message?: string
}

const RATE_LIMIT_MS = 60_000
const MAX_ERROR_SUMMARY_LENGTH = 240
const MAX_RECENT_ERRORS = 500
const recentErrors = new Map<string, { lastWrittenAt: number; suppressed: number }>()

export function sanitizePersonalLogSummary(input: string): string {
  return input
    .replace(/https?:\/\/[^\s?#]+(?:\?[^\s#]*)?/gi, (url) => url.includes('?') ? `${url.split('?')[0]}?[redacted]` : url)
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(token|key|api[_-]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\/(?:Users|home)\/[^/\s]+/g, '/[user]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,})\b/gi, '[token]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_SUMMARY_LENGTH)
}

export function appendPersonalMainLog(filePath: string, event: PersonalLogEvent, now = new Date(), maxBytes = MAX_LOG_BYTES, rotatedCount = ROTATED_LOG_COUNT, details?: PersonalLogErrorDetails): void {
  let description = messages[event]
  if (event !== 'startup' && details) {
    const name = sanitizePersonalLogSummary(details.name || 'Error') || 'Error'
    const scope = sanitizePersonalLogSummary(details.scope || 'main') || 'main'
    const message = sanitizePersonalLogSummary(details.message || 'no message') || 'no message'
    const signature = `${filePath}:${event}:${name}:${scope}:${message}`
    const previous = recentErrors.get(signature)
    if (previous && now.getTime() - previous.lastWrittenAt < RATE_LIMIT_MS) {
      previous.suppressed++
      return
    }
    const suppressed = previous?.suppressed ?? 0
    recentErrors.delete(signature)
    recentErrors.set(signature, { lastWrittenAt: now.getTime(), suppressed: 0 })
    if (recentErrors.size > MAX_RECENT_ERRORS) recentErrors.delete(recentErrors.keys().next().value!)
    description += ` name=${name} scope=${scope} message=${message}${suppressed ? ` suppressed=${suppressed}` : ''}`
  }
  const line = `${now.toISOString()} [${event.toUpperCase()}] ${description}\n`
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

/** Node 的 process 警告（DeprecationWarning、ExperimentalWarning 等）经 console.error 输出，不应记为 ERROR。 */
export function isNodeWarningOutput(args: unknown[]): boolean {
  const first = args.find((value) => typeof value === 'string' || value instanceof Error)
  if (first instanceof Error) return /Warning$/.test(first.name)
  return typeof first === 'string' && /^\(node:\d+\) (?:\[[A-Z0-9_]+\] )?[A-Za-z]*Warning:/.test(first)
}

/** 正常事件（非警告）的信息级日志出口；主进程初始化 main.log 后接入，未接入时只输出到控制台。 */
let personalInfoSink: ((scope: string, message: string) => void) | null = null
export function setPersonalInfoSink(sink: ((scope: string, message: string) => void) | null): void {
  personalInfoSink = sink
}
export function recordPersonalInfo(scope: string, message: string): void {
  console.info(`[${scope}] ${message}`)
  personalInfoSink?.(scope, message)
}
