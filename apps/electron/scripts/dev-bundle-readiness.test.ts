import { test, expect } from 'bun:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEV_BUNDLE_RELATIVE_PATHS, prepareDevBundles, waitForDevBundles } from './dev-bundle-readiness'

const electronRoot = resolve(import.meta.dir, '..')

test('dev readiness requires and clears the production Goal worker bundle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'proma-dev-bundle-readiness-'))
  try {
    assert.ok(DEV_BUNDLE_RELATIVE_PATHS.includes('dist/personal-goal-artifact-worker.cjs'))
    for (const relativePath of DEV_BUNDLE_RELATIVE_PATHS) {
      const target = join(root, relativePath)
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, 'current-build')
    }
    await waitForDevBundles({ root, timeoutMs: 100, pollIntervalMs: 1 })
    const workerPath = join(root, 'dist/personal-goal-artifact-worker.cjs')
    rmSync(workerPath)
    await assert.rejects(waitForDevBundles({ root, timeoutMs: 20, pollIntervalMs: 1 }), /personal-goal-artifact-worker\.cjs/)
    prepareDevBundles(root)
    assert.equal(DEV_BUNDLE_RELATIVE_PATHS.some((relativePath) => existsSync(join(root, relativePath))), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('build/watch main scripts both generate the dedicated CJS worker', () => {
  const packageJson = JSON.parse(require('node:fs').readFileSync(join(electronRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  expect(packageJson.scripts['build:main']).toContain('build:goal-artifact-worker')
  expect(packageJson.scripts['watch:main']).toContain('watch:goal-artifact-worker')
  expect(packageJson.scripts['build:goal-artifact-worker']).toContain('personal-goal-artifact-worker.cjs')
  expect(packageJson.scripts['watch:goal-artifact-worker']).toContain('personal-goal-artifact-worker.cjs')
})
