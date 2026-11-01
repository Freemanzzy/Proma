import { existsSync, statSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { join } from 'node:path'

export type PersonalSharedSkillsKind = 'active' | 'inactive'
export interface PersonalSharedSkillsWatcherOptions {
  /** Optional filesystem watcher factory, primarily for deterministic tests. */
  watch?: (dir: string, listener: () => void) => FSWatcher
  /** Optional initial retry delay; production defaults to five seconds. */
  retryDelayMs?: number
}

const warnedConfigDirs = new Set<string>()
let watchers: FSWatcher[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const retryAttempts = new Map<string, number>()
let watcherGeneration = 0

function sharedDirs(configDir: string): { active: string; inactive: string } {
  return { active: join(configDir, 'shared-skills'), inactive: join(configDir, 'shared-skills-inactive') }
}

function directoryState(path: string): boolean {
  try { return existsSync(path) && statSync(path).isDirectory() } catch { return false }
}

export function isPersonalSharedSkillsMode(configDir: string): boolean {
  const dirs = sharedDirs(configDir)
  const active = directoryState(dirs.active)
  const inactive = directoryState(dirs.inactive)
  if (active !== inactive && !warnedConfigDirs.has(configDir)) {
    warnedConfigDirs.add(configDir)
    console.warn(`[个人版 Skills] 共享目录不完整，仅检测到 ${active ? 'shared-skills' : 'shared-skills-inactive'}`)
  }
  return active && inactive
}

export function resolvePersonalSharedSkillsDir(configDir: string, kind: PersonalSharedSkillsKind): string | null {
  if (!isPersonalSharedSkillsMode(configDir)) return null
  return sharedDirs(configDir)[kind]
}

export function startPersonalSharedSkillsWatcher(
  configDir: string,
  onChange: () => void,
  options: PersonalSharedSkillsWatcherOptions = {},
): void {
  stopPersonalSharedSkillsWatcher()
  if (!isPersonalSharedSkillsMode(configDir)) return

  const generation = watcherGeneration
  const retryDelayMs = options.retryDelayMs ?? 5_000
  const createWatcher = options.watch ?? ((dir: string, listener: () => void) => watch(dir, { recursive: true }, listener))
  const notify = (dir: string) => {
    if (generation !== watcherGeneration) return
    retryAttempts.delete(dir)
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { debounceTimer = null; onChange() }, 300)
  }

  const scheduleRestart = (dir: string): void => {
    if (generation !== watcherGeneration || retryTimers.has(dir)) return
    const attempt = retryAttempts.get(dir) ?? 0
    const delay = Math.min(retryDelayMs * (2 ** attempt), 60_000)
    retryAttempts.set(dir, attempt + 1)
    const timer = setTimeout(() => {
      if (retryTimers.get(dir) !== timer) return
      retryTimers.delete(dir)
      if (generation !== watcherGeneration) return
      if (!isPersonalSharedSkillsMode(configDir)) {
        retryAttempts.delete(dir)
        return
      }
      openWatcher(dir)
    }, delay)
    retryTimers.set(dir, timer)
  }

  const openWatcher = (dir: string): void => {
    if (generation !== watcherGeneration || !isPersonalSharedSkillsMode(configDir)) return
    try {
      const watcher = createWatcher(dir, () => notify(dir))
      watcher.on('error', (error) => {
        if (generation !== watcherGeneration) return
        console.error('[个人版 Skills] 共享目录监听失败，计划重建:', error instanceof Error ? error.message : String(error))
        try { watcher.close() } catch { /* already closed */ }
        watchers = watchers.filter((item) => item !== watcher)
        scheduleRestart(dir)
      })
      watchers.push(watcher)
    } catch (error) {
      console.error('[个人版 Skills] 共享目录监听启动失败，计划重建:', error instanceof Error ? error.message : String(error))
      scheduleRestart(dir)
    }
  }

  for (const dir of Object.values(sharedDirs(configDir))) openWatcher(dir)
}

export function stopPersonalSharedSkillsWatcher(): void {
  watcherGeneration += 1
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  for (const timer of retryTimers.values()) clearTimeout(timer)
  retryTimers.clear()
  retryAttempts.clear()
  for (const watcher of watchers) { try { watcher.close() } catch { /* already closed */ } }
  watchers = []
}
