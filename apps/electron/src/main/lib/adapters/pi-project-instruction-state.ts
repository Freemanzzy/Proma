import { isAbsolute, join, relative } from 'node:path'
import type { SessionManager } from '@earendil-works/pi-coding-agent'
import { canonicalizeProjectPath } from '../project-instruction-resolver'

export const PROJECT_INSTRUCTION_STATE_TYPE = 'proma-project-instruction-scopes-v1'
export const MAX_PROJECT_INSTRUCTION_SCOPES = 256
const MAX_STATE_BYTES = 64 * 1024
const MAX_DIRECTORY_LENGTH = 1024

/** This interface deliberately cannot read the full session tree or grant tool permissions. */
export type ProjectInstructionSessionState = Pick<SessionManager, 'getBranch' | 'appendCustomEntry'>

interface ScopeState {
  version: 1
  ownerSessionId: string
  projectRoot: string
  directories: string[]
}

function stateError(message: string): Error {
  return new Error(`项目指令目录状态无效：${message}`)
}

function validateDirectory(directory: unknown, projectRoot: string): string {
  if (typeof directory !== 'string' || !directory || directory.length > MAX_DIRECTORY_LENGTH
    || isAbsolute(directory) || directory.includes('\\') || directory.includes(':') || /[\x00-\x1f\x7f]/.test(directory)
    || (directory !== '.' && directory.split('/').some((part) => !part || part === '.' || part === '..'))) {
    throw stateError('目录必须是规范的项目相对路径，不能含绝对路径或路径穿越')
  }
  const target = canonicalizeProjectPath(join(projectRoot, directory))
  const canonicalRelative = relative(projectRoot, target).split('\\').join('/') || '.'
  // Compare the already resolved relative strings using the resolver's platform
  // casing semantics. Never realpath the reference again: that would normalize
  // a redirected link to its new target and hide the identity change.
  const sameDirectory = process.platform === 'win32'
    ? canonicalRelative.toLowerCase() === directory.toLowerCase()
    : canonicalRelative === directory
  if (!sameDirectory) throw stateError('目录真实路径已变化或符号链接越界')
  return directory
}

function validateState(value: unknown, ownerSessionId: string, projectRoot: string): ScopeState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw stateError('schema 不是对象')
  const data = value as Record<string, unknown>
  // Imported/other-owner entries are never a source of current-session state.
  if ((typeof data.ownerSessionId === 'string' && data.ownerSessionId !== ownerSessionId)
    || (typeof data.projectRoot === 'string' && data.projectRoot !== projectRoot)) return undefined
  const keys = Object.keys(data).sort().join(',')
  if (keys !== 'directories,ownerSessionId,projectRoot,version' || data.version !== 1
    || data.ownerSessionId !== ownerSessionId || data.projectRoot !== projectRoot
    || !Array.isArray(data.directories) || data.directories.length > MAX_PROJECT_INSTRUCTION_SCOPES
    || Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_STATE_BYTES) throw stateError('schema、版本或大小不符合约束')
  const directories = data.directories.map((directory) => validateDirectory(directory, projectRoot))
  if (new Set(directories).size !== directories.length) throw stateError('目录重复')
  return { version: 1, ownerSessionId, projectRoot, directories }
}

/** Only the latest snapshot on the active branch is relevant; custom entries are not model messages. */
export function readProjectInstructionDirectories(
  session: ProjectInstructionSessionState, ownerSessionId: string, projectRoot: string,
): string[] {
  if (!isAbsolute(projectRoot) || canonicalizeProjectPath(projectRoot) !== projectRoot) {
    throw stateError('项目根真实路径已变化或不是规范绝对路径')
  }
  const branch = session.getBranch()
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index]!
    if (entry.type !== 'custom' || entry.customType !== PROJECT_INSTRUCTION_STATE_TYPE) continue
    const state = validateState(entry.data, ownerSessionId, projectRoot)
    if (state) return state.directories
  }
  return []
}

/** Append at most once per newly discovered directory set, never on ordinary tool calls/starts. */
export function recordProjectInstructionDirectories(
  session: ProjectInstructionSessionState, ownerSessionId: string, projectRoot: string, discovered: string[],
): void {
  const previous = readProjectInstructionDirectories(session, ownerSessionId, projectRoot)
  const directories = [...new Set([...previous, ...discovered.map((directory) => validateDirectory(directory, projectRoot))])].sort()
  if (directories.length === previous.length) return
  const data = { version: 1, ownerSessionId, projectRoot, directories }
  validateState(data, ownerSessionId, projectRoot)
  try {
    session.appendCustomEntry(PROJECT_INSTRUCTION_STATE_TYPE, data)
  } catch (error) {
    throw new Error(`无法保存项目指令目录引用；本次访问仍被阻断。${error instanceof Error ? error.message : String(error)}`)
  }
}
