import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendPersonalMainLog, isNodeWarningOutput, sanitizePersonalLogSummary } from './personal-log-writer'

describe('personal main-process log', () => {
  test('redacts sensitive values and limits summaries', () => {
    const summary = sanitizePersonalLogSummary('Error https://example.test/path?token=abc&x=y Bearer abc token=secret key:private api_key:xyz secret=hidden password=pw sk-1234567890 ghp_1234567890 a@b.example /Users/alice/project')
    expect(summary).toContain('https://example.test/path?[redacted]')
    expect(summary).toContain('Bearer [redacted]')
    expect(summary).toContain('token=[redacted]')
    expect(summary).toContain('key=[redacted]')
    expect(summary).toContain('api_key=[redacted]')
    expect(summary).toContain('secret=[redacted]')
    expect(summary).toContain('password=[redacted]')
    expect(summary).toContain('[token]')
    expect(summary).toContain('[email]')
    expect(summary).toContain('/[user]/project')
    expect(sanitizePersonalLogSummary('x'.repeat(300))).toHaveLength(240)
  })

  test('writes startup marker and distinguishes WARN, ERROR, and FATAL without text promotion', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-main-log-level-'))
    const path = join(root, 'logs', 'main.log')
    try {
      const time = new Date('2026-09-26T12:00:00.000Z')
      appendPersonalMainLog(path, 'startup', time)
      appendPersonalMainLog(path, 'warn', time, undefined, undefined, { name: 'Warning', scope: 'IPC', message: 'fatal is just text' })
      appendPersonalMainLog(path, 'error', time, undefined, undefined, { name: 'TypeError', scope: 'main', message: 'ordinary error' })
      appendPersonalMainLog(path, 'fatal', time, undefined, undefined, { name: 'RangeError', scope: 'main', message: 'uncaught exception' })
      const all = readFileSync(path, 'utf8')
      expect(all).toContain('personal main process started')
      expect(all).toContain('[WARN] main-process warning name=Warning scope=IPC message=fatal is just text')
      expect(all).toContain('[ERROR] main-process error name=TypeError')
      expect(all).toContain('[FATAL] fatal main-process error name=RangeError')
      expect(all.split('\n').filter(Boolean)).toHaveLength(4)
      expect(statSync(path).mode & 0o777).toBe(0o600)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rate limits identical errors and reports suppressed count on next write', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-main-log-limit-'))
    const path = join(root, 'logs', 'main.log')
    try {
      const base = new Date('2026-09-26T12:00:00.000Z')
      const details = { name: 'Error', scope: 'auth', message: 'duplicate' }
      appendPersonalMainLog(path, 'error', base, undefined, undefined, details)
      appendPersonalMainLog(path, 'error', new Date(base.getTime() + 1), undefined, undefined, details)
      appendPersonalMainLog(path, 'error', new Date(base.getTime() + 2), undefined, undefined, details)
      expect(readFileSync(path, 'utf8').split('\n').filter(Boolean)).toHaveLength(1)
      appendPersonalMainLog(path, 'error', new Date(base.getTime() + 60_001), undefined, undefined, details)
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
      expect(lines).toHaveLength(2)
      expect(lines[1]).toContain('suppressed=2')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('classifies Node process warnings printed through console.error as WARN', () => {
    expect(isNodeWarningOutput(['(node:92978) [DEP0187] DeprecationWarning: Passing invalid argument types to fs.existsSync is deprecated'])).toBe(true)
    expect(isNodeWarningOutput(['(node:1) ExperimentalWarning: VM Modules is an experimental feature'])).toBe(true)
    expect(isNodeWarningOutput([Object.assign(new Error('x'), { name: 'DeprecationWarning' })])).toBe(true)
    expect(isNodeWarningOutput(['[IPC] failed: DeprecationWarning mentioned later'])).toBe(false)
    expect(isNodeWarningOutput([new TypeError('boom')])).toBe(false)
  })

  test('rotates and keeps logs private', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-main-log-'))
    const path = join(root, 'logs', 'main.log')
    try {
      const time = new Date('2026-09-26T12:00:00.000Z')
      appendPersonalMainLog(path, 'startup', time, 1, 2)
      appendPersonalMainLog(path, 'fatal', time, 1, 2, { name: 'Error', message: 'uncaught' })
      expect(readdirSync(join(root, 'logs')).sort()).toEqual(['main.log', 'main.log.1'])
      expect(statSync(path).mode & 0o777).toBe(0o600)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
