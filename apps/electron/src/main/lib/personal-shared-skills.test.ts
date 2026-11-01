import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'bun:test'
import { isPersonalSharedSkillsMode, resolvePersonalSharedSkillsDir, startPersonalSharedSkillsWatcher, stopPersonalSharedSkillsWatcher } from './personal-shared-skills'

const roots: string[] = []
function fixture(): string { const root = mkdtempSync(join(tmpdir(), 'personal-shared-skills-')); roots.push(root); return root }
afterEach(() => { stopPersonalSharedSkillsWatcher(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test('shared mode requires both directories and accepts directory symlinks', () => {
  const root = fixture(); expect(isPersonalSharedSkillsMode(root)).toBe(false)
  mkdirSync(join(root, 'shared-skills')); expect(isPersonalSharedSkillsMode(root)).toBe(false)
  mkdirSync(join(root, 'actual-inactive')); symlinkSync(join(root, 'actual-inactive'), join(root, 'shared-skills-inactive'))
  expect(isPersonalSharedSkillsMode(root)).toBe(true)
  expect(resolvePersonalSharedSkillsDir(root, 'inactive')).toBe(join(root, 'shared-skills-inactive'))
})

test('incomplete directory warning is emitted only once and names no full path', () => {
  const root = fixture(); mkdirSync(join(root, 'shared-skills'))
  const warn = console.warn; const warnings: string[] = []; console.warn = (...args: unknown[]) => warnings.push(args.join(' '))
  try { isPersonalSharedSkillsMode(root); isPersonalSharedSkillsMode(root) } finally { console.warn = warn }
  expect(warnings).toHaveLength(1); expect(warnings[0]).toContain('shared-skills'); expect(warnings[0]).not.toContain(root)
})

test('watcher notifies on changes and stop prevents future callbacks', async () => {
  const root = fixture(); mkdirSync(join(root, 'shared-skills')); mkdirSync(join(root, 'shared-skills-inactive'))
  let calls = 0; startPersonalSharedSkillsWatcher(root, () => calls++)
  await new Promise(resolve => setTimeout(resolve, 80)); writeFileSync(join(root, 'shared-skills', 'added'), 'x')
  await new Promise(resolve => setTimeout(resolve, 450)); expect(calls).toBe(1)
  stopPersonalSharedSkillsWatcher(); writeFileSync(join(root, 'shared-skills', 'added'), 'y')
  await new Promise(resolve => setTimeout(resolve, 450)); expect(calls).toBe(1)
})
