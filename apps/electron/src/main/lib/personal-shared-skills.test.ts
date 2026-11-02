import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, mock, test } from 'bun:test'
import * as nodeFs from 'node:fs'

const openedWatchers: nodeFs.FSWatcher[] = []
const realWatch = nodeFs.watch.bind(nodeFs)
mock.module('node:fs', () => ({
  ...nodeFs,
  watch: (...args: Parameters<typeof nodeFs.watch>) => {
    const watcher = realWatch(...args)
    openedWatchers.push(watcher)
    return watcher
  },
}))
const { isPersonalSharedSkillsMode, resolvePersonalSharedSkillsDir, startPersonalSharedSkillsWatcher, stopPersonalSharedSkillsWatcher } = await import('./personal-shared-skills')

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

test('watcher error is handled without throwing', () => {
  const root = fixture(); mkdirSync(join(root, 'shared-skills')); mkdirSync(join(root, 'shared-skills-inactive'))
  openedWatchers.length = 0
  startPersonalSharedSkillsWatcher(root, () => {})
  expect(openedWatchers).toHaveLength(2)
  const error = console.error; console.error = () => {}
  try { expect(() => openedWatchers[0]!.emit('error', new Error('fixture watcher failure'))).not.toThrow() }
  finally { console.error = error; stopPersonalSharedSkillsWatcher() }
})

test('watcher recreates a failed shared directory after the retry delay', async () => {
  const root = fixture(); mkdirSync(join(root, 'shared-skills')); mkdirSync(join(root, 'shared-skills-inactive'))
  const watched: string[] = []; const created: nodeFs.FSWatcher[] = []
  const error = console.error; console.error = () => {}
  try {
    startPersonalSharedSkillsWatcher(root, () => {}, {
      retryDelayMs: 5,
      watch: (dir) => {
        watched.push(dir)
        const watcher = Object.assign(new EventEmitter(), { close: () => {} }) as unknown as nodeFs.FSWatcher
        created.push(watcher)
        return watcher
      },
    })
    expect(watched).toEqual([join(root, 'shared-skills'), join(root, 'shared-skills-inactive')])
    created[0]!.emit('error', new Error('retry fixture'))
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(watched).toHaveLength(3)
    expect(watched[2]).toBe(join(root, 'shared-skills'))
  } finally { console.error = error; stopPersonalSharedSkillsWatcher() }
})

test('stop cancels pending watcher recreation', async () => {
  const root = fixture(); mkdirSync(join(root, 'shared-skills')); mkdirSync(join(root, 'shared-skills-inactive'))
  const watched: string[] = []; const created: nodeFs.FSWatcher[] = []
  const error = console.error; console.error = () => {}
  try {
    startPersonalSharedSkillsWatcher(root, () => {}, {
      retryDelayMs: 10,
      watch: (dir) => {
        watched.push(dir)
        const watcher = Object.assign(new EventEmitter(), { close: () => {} }) as unknown as nodeFs.FSWatcher
        created.push(watcher)
        return watcher
      },
    })
    created[0]!.emit('error', new Error('stop fixture'))
    stopPersonalSharedSkillsWatcher()
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(watched).toHaveLength(2)
  } finally { console.error = error; stopPersonalSharedSkillsWatcher() }
})

test('watcher does not rebuild after shared mode becomes inactive', async () => {
  const root = fixture(); mkdirSync(join(root, 'shared-skills')); mkdirSync(join(root, 'shared-skills-inactive'))
  const watched: string[] = []; const created: nodeFs.FSWatcher[] = []
  const error = console.error; const warn = console.warn; console.error = () => {}; console.warn = () => {}
  try {
    startPersonalSharedSkillsWatcher(root, () => {}, {
      retryDelayMs: 5,
      watch: (dir) => {
        watched.push(dir)
        const watcher = Object.assign(new EventEmitter(), { close: () => {} }) as unknown as nodeFs.FSWatcher
        created.push(watcher)
        return watcher
      },
    })
    rmSync(join(root, 'shared-skills-inactive'), { recursive: true, force: true })
    created[0]!.emit('error', new Error('inactive mode fixture'))
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(watched).toHaveLength(2)
  } finally { console.error = error; console.warn = warn; stopPersonalSharedSkillsWatcher() }
})

test('watcher notifies on changes and stop prevents future callbacks', async () => {
  const root = fixture(); mkdirSync(join(root, 'shared-skills')); mkdirSync(join(root, 'shared-skills-inactive'))
  let calls = 0; startPersonalSharedSkillsWatcher(root, () => calls++)
  await new Promise(resolve => setTimeout(resolve, 80)); writeFileSync(join(root, 'shared-skills', 'added'), 'x')
  await new Promise(resolve => setTimeout(resolve, 450)); expect(calls).toBe(1)
  stopPersonalSharedSkillsWatcher(); writeFileSync(join(root, 'shared-skills', 'added'), 'y')
  await new Promise(resolve => setTimeout(resolve, 450)); expect(calls).toBe(1)
})
