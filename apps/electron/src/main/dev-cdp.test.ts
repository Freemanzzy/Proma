import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

describe('development CDP guard', () => {
  test('only enables loopback remote debugging for unpackaged builds with an explicit valid port', () => {
    const source = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8')
    expect(source).toContain("if (!app.isPackaged && debugPort &&")
    expect(source).toContain("appendSwitch('remote-debugging-address', '127.0.0.1')")
    expect(source).toContain("appendSwitch('remote-debugging-port', debugPort)")
    expect(source).toContain('Number(debugPort) <= 65535')
  })
})
