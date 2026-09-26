import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendPersonalMainLog } from './personal-log-writer'

describe('personal main-process log', () => {
  test('writes classified events only, rotates, and keeps logs private', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-main-log-'))
    const path = join(root, 'logs', 'main.log')
    try {
      const time = new Date('2026-09-26T12:00:00.000Z')
      appendPersonalMainLog(path, 'startup', time, 1, 2)
      appendPersonalMainLog(path, 'fatal', time, 1, 2)
      expect(readdirSync(join(root, 'logs')).sort()).toEqual(['main.log', 'main.log.1'])
      const all = readdirSync(join(root, 'logs')).map((name) => readFileSync(join(root, 'logs', name), 'utf8')).join('')
      expect(all).toContain('fatal main-process event recorded')
      expect(all).not.toContain('apiKey')
      expect(all).not.toContain('secret-value')
      expect(statSync(path).mode & 0o777).toBe(0o600)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
