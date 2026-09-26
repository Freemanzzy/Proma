import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasPersonalBuildMarker } from './personal-build'

describe('personal build marker', () => {
  test('recognizes only a resources directory with the marker', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-personal-marker-'))
    try {
      const resources = join(root, 'Contents', 'Resources')
      mkdirSync(resources, { recursive: true })
      expect(hasPersonalBuildMarker(resources)).toBe(false)
      writeFileSync(join(resources, 'personal-build.json'), '{"personal":true}')
      expect(hasPersonalBuildMarker(resources)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
