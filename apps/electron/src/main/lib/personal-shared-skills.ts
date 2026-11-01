import { existsSync, statSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { join } from 'node:path'

export type PersonalSharedSkillsKind = 'active' | 'inactive'
const warnedConfigDirs = new Set<string>()
let watchers: FSWatcher[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null

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

export function startPersonalSharedSkillsWatcher(configDir: string, onChange: () => void): void {
  stopPersonalSharedSkillsWatcher()
  if (!isPersonalSharedSkillsMode(configDir)) return
  const notify = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { debounceTimer = null; onChange() }, 300)
  }
  for (const dir of Object.values(sharedDirs(configDir))) {
    try {
      const watcher = watch(dir, { recursive: true }, notify)
      watcher.on('error', (error) => {
        console.error('[个人版 Skills] 共享目录监听失败，已降级:', error instanceof Error ? error.message : String(error))
        try { watcher.close() } catch { /* already closed */ }
        watchers = watchers.filter((item) => item !== watcher)
      })
      watchers.push(watcher)
    } catch (error) {
      console.error('[个人版 Skills] 共享目录监听启动失败，已降级:', error instanceof Error ? error.message : String(error))
    }
  }
}

export function stopPersonalSharedSkillsWatcher(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  for (const watcher of watchers) { try { watcher.close() } catch { /* already closed */ } }
  watchers = []
}
