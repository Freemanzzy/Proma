import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export const EXTERNAL_WORKSPACE_READ_ONLY_MESSAGE = '此工作区对外只读：只能修改本工作区内的文件'

export type ExternalWorkspaceToolDecision = { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }

/** Returns null for ordinary read/other tools; permission mode is intentionally ignored. */
export function resolveExternalWorkspaceToolDecision(
  permissionMode: string,
  toolName: string,
  input: Record<string, unknown>,
  roots: string[],
  cwd: string,
): ExternalWorkspaceToolDecision | null {
  void permissionMode // This guard must apply even when the caller selected bypassPermissions.
  const filePath = toolName === 'NotebookEdit' ? input.notebook_path : input.file_path
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') {
    return typeof filePath === 'string' && isPathWithinRoots(filePath, roots, cwd)
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: EXTERNAL_WORKSPACE_READ_ONLY_MESSAGE }
  }
  if (toolName === 'Bash') {
    return isBashCommandReadOnly(typeof input.command === 'string' ? input.command : '')
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: EXTERNAL_WORKSPACE_READ_ONLY_MESSAGE }
  }
  if (toolName === 'PowerShell') {
    return isPowerShellCommandReadOnly(typeof input.command === 'string' ? input.command : '')
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: EXTERNAL_WORKSPACE_READ_ONLY_MESSAGE }
  }
  if (['REPL', 'Workflow', 'TerminalOpen', 'TerminalExecute', 'TerminalInterrupt', 'TerminalClose', 'SelectWorktree', 'InstallWindowsShell'].includes(toolName)) {
    return { behavior: 'deny', message: EXTERNAL_WORKSPACE_READ_ONLY_MESSAGE }
  }
  return null
}

export function isPathWithinRoots(filePath: string, roots: string[], cwd: string): boolean {
  if (!filePath.trim() || roots.length === 0) return false
  const target = resolve(cwd, filePath)
  const resolvedTarget = resolveThroughExistingParent(target)
  return roots.some((root) => {
    try {
      const realRoot = resolveThroughExistingParent(root)
      const rel = relative(realRoot, resolvedTarget)
      return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
    } catch {
      return false
    }
  })
}

function resolveThroughExistingParent(targetPath: string): string {
  let cursor = resolve(targetPath)
  const missing: string[] = []
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error('No existing parent for target path')
    missing.unshift(basename(cursor))
    cursor = parent
  }
  return resolve(realpathSync(cursor), ...missing)
}

/** Existing plan-mode classifier; conservative but not a shell parser. */
export function isBashCommandReadOnly(command: string): boolean {
  if (/(?<![0-9&])>/.test(command)) return false
  if (/\b(rm|rmdir)\s/.test(command)) return false
  if (/\bsed\s+[^|&;]*-i/.test(command)) return false
  if (/\b(chmod|chown|chattr|truncate)\s/.test(command)) return false
  if (/\b(mv|cp)\s/.test(command)) return false
  if (/\b(mkdir|touch|mktemp)\s/.test(command)) return false
  if (/\b(npm|pnpm|yarn|bun)\s+(install|i\b|add|remove|uninstall|update|upgrade|link|unlink)\b/.test(command)) return false
  if (/\bpip[23]?\s+(install|uninstall|upgrade)\b/.test(command)) return false
  if (/\b(apt|apt-get|brew|yum|dnf)\s+(install|remove|purge|uninstall|upgrade)\b/.test(command)) return false
  if (/\bgit\s+(commit|push|checkout\s+-[bB]|branch\s+-[mMdD]|merge\b|rebase\b|reset\b|stash\s+(drop|pop)\b|add\b|apply\b|cherry-pick\b)/.test(command)) return false
  if (/\b(kill|killall|pkill)\s/.test(command)) return false
  if (/\b(node|python[23]?|ruby|perl|php)\s+[^-]/.test(command)) return false
  return true
}

export function isPowerShellCommandReadOnly(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed || /[;`|<>]/.test(trimmed) || /&&|\|\|/.test(trimmed)) return false
  const [commandName] = trimmed.split(/\s+/, 1)
  const readOnlyCmdlets = new Set([
    'get-childitem', 'get-content', 'get-item', 'get-location', 'get-command', 'get-help',
    'get-process', 'get-date', 'get-culture', 'get-module', 'measure-object',
    'resolve-path', 'select-string', 'test-path',
  ])
  if (commandName && readOnlyCmdlets.has(commandName.toLowerCase())) return true
  return /^(git|bun|npm|pnpm|yarn)\s/.test(trimmed) && isBashCommandReadOnly(trimmed)
}
