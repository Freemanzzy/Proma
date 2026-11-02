import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'

test('file:resolve-path rejects directories before registration and keeps the file path branch', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'ipc.ts'), 'utf8')
  const start = source.indexOf("'file:resolve-path'")
  const end = source.indexOf("'file:resolve-html-preview-path'", start)
  const handler = source.slice(start, end)
  const directoryGuard = handler.indexOf('if (statSync(result).isDirectory()) return null')
  const registration = handler.indexOf('registerPromaFilePath(result)')
  expect(directoryGuard).toBeGreaterThanOrEqual(0)
  expect(registration).toBeGreaterThan(directoryGuard)
  expect(handler).toContain('return { url: registerPromaFilePath(result), resolvedPath: result }')
  expect(handler).toContain('file:resolve-path 无法注册为文件，跳过:')
})
