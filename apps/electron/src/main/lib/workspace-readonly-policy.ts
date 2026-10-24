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
  // Pi 的 edit 在多处修改时显示为 MultiEdit，必须同样受路径限制。
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') {
    return typeof filePath === 'string' && isPathWithinRoots(filePath, roots, cwd)
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: EXTERNAL_WORKSPACE_READ_ONLY_MESSAGE }
  }
  if (toolName === 'Bash') {
    return isBashCommandStrictlyReadOnly(typeof input.command === 'string' ? input.command : '')
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

/**
 * 对外只读模式使用的更严格判定：在计划模式分类器之上，再拒绝常见的
 * 非重定向写入路径（tee/dd/ln/install/rsync/下载落盘/解包/find 删除执行、
 * 子 shell 与 eval、带全局选项的 git 写命令等）。仍不是完整 shell 解析器。
 */
export function isBashCommandStrictlyReadOnly(command: string): boolean {
  if (!isBashCommandReadOnly(command)) return false
  const denied: RegExp[] = [
    /\b(tee|dd|ln|install|rsync|scp|shred|unlink|patch)\b/,
    /\bcurl\b[^|;&]*\s(-o|-O|--output|--remote-name)\b/,
    /\bwget\b/,
    /\b(tar|unzip|gunzip|bunzip2|xz|zstd|7z|ditto)\b/,
    /\bfind\b[^|;&]*\s-(delete|exec|execdir|ok|fprint)/,
    /\b(sh|bash|zsh|fish|dash|ksh)\s+(-[a-z]*c|[^-\s])/,
    /\b(eval|exec|source|osascript|open|sqlite3|defaults|launchctl|crontab|security)\b/,
    /(^|[;&|(]\s*)\.\s+\S/,
    /\b(npx|bunx|pnpx)\b/,
    /\bgit\b(?:\s+-[A-Za-z]\s+\S+|\s+--[a-z-]+(?:=\S+)?)*\s+(commit|push|pull|fetch|clone|init|checkout|switch|restore|branch|tag|merge|rebase|reset|stash|add|rm|mv|apply|am|cherry-pick|revert|clean|gc|config|worktree|submodule|update-ref|notes)\b/,
    /\b(npm|pnpm|yarn|bun|npx|bunx|pip[23]?|uv|cargo|go|make|gradle|mvn)\s+(run|exec|x|build|test|publish|ci|init|create|dlx|install|i|add)\b/,
    /\bxargs\b/,
  ]
  return !denied.some((pattern) => pattern.test(command))
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
