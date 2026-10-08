import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { getConfigDir } from './config-paths'
import { getAgentSessionMeta, listAgentSessions, deleteAgentSession, DEFAULT_AGENT_SESSION_TITLE } from './agent-session-manager'
import { getAgentWorkspace } from './agent-workspace-manager'
import { recordPersonalInfo } from './personal-log-writer'
import { runUnusedDraftCleanup, type DraftCleanupEvidence } from './personal-draft-cleanup-core'

let hasRun = false

function inspectDraft(session: ReturnType<typeof listAgentSessions>[number]): DraftCleanupEvidence | null {
  if (!/^[a-f0-9-]{36}$/i.test(session.id)) return null

  const messagesPath = join(getConfigDir(), 'agent-sessions', `${session.id}.jsonl`)
  let messageFileExists = false
  let messageFileSize: number | undefined
  try {
    const messageStat = statSync(messagesPath)
    if (!messageStat.isFile()) return null
    messageFileExists = true
    messageFileSize = messageStat.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
  }

  if (!session.workspaceId) return { messageFileExists, messageFileSize, workDirectoryState: 'missing' }
  const workspace = getAgentWorkspace(session.workspaceId)
  if (!workspace?.slug || !/^[a-zA-Z0-9_-]+$/.test(workspace.slug)) return null
  const workspacesRoot = resolve(getConfigDir(), 'agent-workspaces')
  const workDirectory = resolve(workspacesRoot, workspace.slug, session.id)
  if (!workDirectory.startsWith(`${workspacesRoot}${sep}`)) return null

  try {
    const workStat = statSync(workDirectory)
    if (!workStat.isDirectory()) return { messageFileExists, messageFileSize, workDirectoryState: 'non-empty' }
    return { messageFileExists, messageFileSize, workDirectoryState: readdirSync(workDirectory).length === 0 ? 'empty' : 'non-empty' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { messageFileExists, messageFileSize, workDirectoryState: 'missing' }
    return null
  }
}

function writeDraftBackup(sessions: ReturnType<typeof listAgentSessions>, now: number): string {
  const backupDirectory = join(getConfigDir(), 'backups')
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const payload = JSON.stringify({ createdAt: now, sessions }, null, 2)
  for (let suffix = 0; suffix < 100; suffix++) {
    const name = `draft-cleanup-${timestamp}${suffix ? `-${suffix}` : ''}.json`
    try {
      writeFileSync(join(backupDirectory, name), payload, { flag: 'wx', mode: 0o600 })
      return name
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('无法分配唯一草稿备份文件名')
}

/** 在会话索引首次加载后执行一次；仅经应用现有删除 API 移除符合全部条件的空草稿。 */
export function cleanupUnusedDraftSessions(): void {
  if (hasRun) return
  hasRun = true
  const now = Date.now()
  runUnusedDraftCleanup({
    sessions: listAgentSessions(),
    now,
    defaultTitle: DEFAULT_AGENT_SESSION_TITLE,
    inspect: inspectDraft,
    writeBackup: writeDraftBackup,
    deleteSession: deleteAgentSession,
    sessionStillExists: (id) => Boolean(getAgentSessionMeta(id)),
    log: (removed, skipped, backupName) => {
      recordPersonalInfo('服务诊断', `event=draft-cleanup removed=${removed} skipped=${skipped} backup=${backupName || 'none'}`)
    },
  })
}
