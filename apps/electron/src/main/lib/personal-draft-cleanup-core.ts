import type { AgentSessionMeta } from '@proma/shared'

export const UNUSED_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type DraftWorkDirectoryState = 'missing' | 'empty' | 'non-empty' | 'unknown'

export interface DraftCleanupEvidence {
  messageFileExists: boolean
  messageFileSize?: number
  workDirectoryState: DraftWorkDirectoryState
}

export function isUnusedDraftEligible(
  session: AgentSessionMeta,
  evidence: DraftCleanupEvidence,
  now: number,
  defaultTitle: string,
): boolean {
  return session.isDraft === true
    && (!session.title?.trim() || session.title === defaultTitle)
    && !session.pinned
    && !session.archived
    && session.parentSessionId == null
    && session.sourceDelegationId == null
    && session.sourceAutomationId == null
    && Number.isFinite(session.createdAt)
    && session.createdAt < now - UNUSED_DRAFT_MAX_AGE_MS
    && (!evidence.messageFileExists || evidence.messageFileSize === 0)
    && (evidence.workDirectoryState === 'missing' || evidence.workDirectoryState === 'empty')
}

export interface DraftCleanupResult {
  removedIds: string[]
  skippedIds: string[]
  backupName?: string
}

export function runUnusedDraftCleanup(input: {
  sessions: AgentSessionMeta[]
  now: number
  defaultTitle: string
  inspect: (session: AgentSessionMeta) => DraftCleanupEvidence | null
  writeBackup: (sessions: AgentSessionMeta[], now: number) => string
  deleteSession: (id: string) => void
  sessionStillExists: (id: string) => boolean
  log: (removed: number, skipped: number, backupName: string) => void
}): DraftCleanupResult {
  const candidates: AgentSessionMeta[] = []
  const skippedIds: string[] = []
  for (const session of input.sessions) {
    if (session.isDraft !== true) continue
    let evidence: DraftCleanupEvidence | null
    try { evidence = input.inspect(session) } catch { evidence = null }
    if (!evidence) {
      skippedIds.push(session.id)
      continue
    }
    if (isUnusedDraftEligible(session, evidence, input.now, input.defaultTitle)) candidates.push(session)
  }

  if (candidates.length === 0) {
    input.log(0, skippedIds.length, '')
    return { removedIds: [], skippedIds }
  }

  let backupName: string
  try { backupName = input.writeBackup(candidates, input.now) }
  catch {
    const skipped = [...skippedIds, ...candidates.map((session) => session.id)]
    input.log(0, skipped.length, '')
    return { removedIds: [], skippedIds: skipped }
  }

  const removedIds: string[] = []
  for (const session of candidates) {
    try {
      input.deleteSession(session.id)
      if (input.sessionStillExists(session.id)) skippedIds.push(session.id)
      else removedIds.push(session.id)
    } catch {
      skippedIds.push(session.id)
    }
  }
  input.log(removedIds.length, skippedIds.length, backupName)
  return { removedIds, skippedIds, backupName }
}
