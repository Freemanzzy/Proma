import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { absolutePathWithinRoots, normalizePiPath, pathWithinRoot, piPathWithinRoots, realPathThroughParent, resolvePiPath, resolvePiReadPath } from './personal-confined-paths'

export const CONFINED_DENIED = '外部受限工作区：不允许此工具或路径'
export const CONFINED_COMMAND_DENIED = '外部受限工作区：工作区命令白名单缺失或无效'
export const CONFINED_ENTRY_DENIED = '外部受限工作区：入口及其依赖必须放在客户工作区之外，且禁止改写白名单入口'
export const CONFINED_BRIDGE_DENIED = '此群不支持该命令'
export interface ConfinedPolicy { version: 1; commands: string[]; env?: string[]; allowGroupChatHistory?: boolean }
export type ConfinedDecision = { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }
export interface ConfinedToolContext { roots: string[]; cwd: string; workspacePath: string }

export function readConfinedPolicy(workspacePath: string): ConfinedPolicy | null {
  try {
    const p: unknown = JSON.parse(readFileSync(join(workspacePath, 'confined-policy.json'), 'utf8'))
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null
    const v = p as Record<string, unknown>
    if (Object.keys(v).some((key) => !['version', 'commands', 'env', 'allowGroupChatHistory'].includes(key))) return null
    if (v.version !== 1 || !Array.isArray(v.commands) || !v.commands.every((c) => typeof c === 'string' && isAbsolute(c) && !/[\0\r\n]/.test(c))) return null
    if (v.env !== undefined && (!Array.isArray(v.env) || !v.env.every((e) => typeof e === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(e)))) return null
    if (v.allowGroupChatHistory !== undefined && typeof v.allowGroupChatHistory !== 'boolean') return null
    return v as unknown as ConfinedPolicy
  } catch { return null }
}

/** No expansion, escaping or operators. Quotes are grouping only. */
export function tokenizeConfinedCommand(command: string): string[] | null {
  const words: string[] = []
  let word = ''; let quote = ''; let started = false
  for (const c of command) {
    if (/[\0\r\n$`\\;&|]/.test(c)) return null
    if (quote) {
      if (c === quote) quote = ''
      else word += c
      started = true
    } else if (c === "'" || c === '"') { quote = c; started = true }
    else if (/\s/.test(c)) {
      if (started) { words.push(word); word = ''; started = false }
    } else {
      if (/[;&|<>()*?\[\]{}#!]/.test(c)) return null
      word += c; started = true
    }
  }
  if (quote) return null
  if (started) words.push(word)
  if (!words.length || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) return null
  return words
}

export function quoteConfinedWord(word: string): string { return `'${word.replace(/'/g, "'\\''")}'` }

// Fixed defaults cannot be overridden by policy env entries. Custom env is an
// administrator trust boundary (e.g. a proxy required by the approved entrypoint).
export function confinedShellEnvironment(): NodeJS.ProcessEnv {
  return { HOME: homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: process.env.LANG || 'en_US.UTF-8', TMPDIR: tmpdir(), TZ: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
}

function safePattern(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value !== 'string' || value.includes('\0')) return false
  try {
    const path = normalizePiPath(value)
    return !isAbsolute(path) && !value.startsWith('~') && !path.split(/[\\/]/).includes('..')
  } catch { return false }
}

function pathArgumentAllowed(arg: string, ctx: ConfinedToolContext): boolean {
  const value = /^--[^=]+=/.test(arg) ? arg.slice(arg.indexOf('=') + 1) : arg
  // Bash executes raw argv, not Pi tool paths. Even ordinary text may name a
  // relative symlink; resolve every argument (and option value) as a path.
  return !value.startsWith('~') && !value.split(/[\\/]/).includes('..')
    && absolutePathWithinRoots(resolve(ctx.cwd, value), ctx.roots)
}

function writableEntrypoint(command: string, roots: string[]): boolean {
  const real = realPathThroughParent(command)
  return roots.some(root => pathWithinRoot(command, resolve(root)) || pathWithinRoot(real, realPathThroughParent(root)))
}

function protectedEntrypoint(path: string, workspacePath: string): boolean {
  return readConfinedPolicy(workspacePath)?.commands.some(command => {
    try { return resolve(command) === path || realPathThroughParent(command) === realPathThroughParent(path) } catch { return true }
  }) ?? false
}

export const CONFINED_SESSION_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoRead', 'CompactContext'])
export function isConfinedToolNameAllowed(name: string): boolean {
  return ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob', 'LS', 'mcp__feishu_chat__fetch_group_chat_history'].includes(name) || CONFINED_SESSION_TOOLS.has(name)
}

/** Definitive decision, never null: must run before ANY permission-mode branch. */
export function resolveConfinedToolDecision(tool: string, input: Record<string, unknown>, ctx: ConfinedToolContext): ConfinedDecision {
  const deny = (message = CONFINED_DENIED): ConfinedDecision => ({ behavior: 'deny', message })
  const allow = (updatedInput = input): ConfinedDecision => ({ behavior: 'allow', updatedInput })
  if (CONFINED_SESSION_TOOLS.has(tool)) return allow()
  if (tool === 'mcp__feishu_chat__fetch_group_chat_history') {
    return isConfinedGroupHistoryAllowed(ctx.workspacePath) ? allow() : deny()
  }
  if (['Read', 'Write', 'Edit', 'MultiEdit', 'LS', 'Grep', 'Glob'].includes(tool)) {
    const rawPath = ['Read', 'Write', 'Edit', 'MultiEdit'].includes(tool) ? input.file_path : input.path ?? '.'
    if (typeof rawPath !== 'string') return deny()
    if ((tool === 'Glob' && !safePattern(input.pattern)) || ((tool === 'Grep' || tool === 'Glob') && !safePattern(input.glob))) return deny()
    try {
      const path = tool === 'Read' ? resolvePiReadPath(rawPath, ctx.cwd) : resolvePiPath(rawPath, ctx.cwd)
      if (['Write', 'Edit', 'MultiEdit'].includes(tool) && protectedEntrypoint(path, ctx.workspacePath)) return deny(CONFINED_ENTRY_DENIED)
      // updatedInput is parsed by Pi again. Require a fixed point, including
      // Read's filename fallback, before authorizing the actual opened path.
      const finalPath = tool === 'Read' ? resolvePiReadPath(path, ctx.cwd) : resolvePiPath(path, ctx.cwd)
      if (finalPath !== path || !absolutePathWithinRoots(finalPath, ctx.roots)) return deny()
      return allow({ ...input, path, ...(['Read', 'Write', 'Edit', 'MultiEdit', 'LS'].includes(tool) ? { file_path: path } : {}) })
    } catch { return deny() }
  }
  if (tool !== 'Bash') return deny()
  const policy = readConfinedPolicy(ctx.workspacePath)
  if (!policy) return deny(CONFINED_COMMAND_DENIED)
  // Only Pi's two Bash inputs; do not forward an alternate cwd/env/shell.
  if (Object.keys(input).some((k) => !['command', 'timeout'].includes(k)) || typeof input.command !== 'string'
    || (input.timeout !== undefined && (typeof input.timeout !== 'number' || !Number.isFinite(input.timeout) || input.timeout <= 0 || input.timeout > 2_147_483))) return deny()
  if (!piPathWithinRoots(ctx.cwd, ctx.roots, ctx.cwd)) return deny()
  const words = tokenizeConfinedCommand(input.command)
  if (!words || !policy.commands.includes(words[0]!) || !words.slice(1).every((arg) => pathArgumentAllowed(arg, ctx))) return deny()
  try { if (writableEntrypoint(words[0]!, ctx.roots)) return deny(CONFINED_ENTRY_DENIED) } catch { return deny(CONFINED_COMMAND_DENIED) }
  const env = confinedShellEnvironment()
  for (const name of policy.env ?? []) {
    if (!(name in env) && Object.prototype.hasOwnProperty.call(process.env, name)) env[name] = process.env[name]
  }
  const envWords = Object.entries(env).map(([key, value]) => `${key}=${value}`)
  return allow({ ...input, command: ['/usr/bin/env', '-i', ...envWords, ...words].map(quoteConfinedWord).join(' ') })
}

export interface ConfinedWorkspaceMetadata { id: string; externalAccess?: string }
export function confinedBridgeWorkspaceId(defaultId: string | undefined, bindingId: string | undefined, getWorkspace: (id: string) => ConfinedWorkspaceMetadata | undefined): string | undefined {
  if (defaultId && getWorkspace(defaultId)?.externalAccess === 'confined') return defaultId
  return bindingId && getWorkspace(bindingId)?.externalAccess === 'confined' ? bindingId : undefined
}
export function isConfinedBridgeCommandAllowed(command: string): boolean {
  return ['/help', '/h', '/new', '/n', '/stop', '/s', '/list', '/ls', '/switch', '/sw'].includes(command.toLowerCase())
}
export const CONFINED_HELP = '/help — 帮助\n/new — 本工作区新建会话\n/list — 本工作区会话\n/switch <序号或ID前缀> — 切换会话\n/stop — 停止'
export function buildConfinedSystemPrompt(workspaceRules = ''): string {
  return `你是本工作区的外部助手。只处理本工作区任务。\n只能读写项目文件目录与本会话工作台；不得访问其他路径。Bash 只能运行管理员批准的绝对路径命令，不能使用 shell 展开或操作符。其他能力默认禁止。可用本会话进度任务与上下文压缩。拒绝后不要尝试绕过限制。\n${workspaceRules ? `\n<project_rules>\n${workspaceRules}\n</project_rules>` : ''}`
}
export function buildConfinedDynamicContext(): string { return '<workspace_state>当前会话处于外部受限工作区模式。</workspace_state>' }

// Pi appends its own <cwd> section even to a custom system prompt. Override
// the structured section too; the execution cwd remains the real project root.
export function createConfinedPromptExtension(): ExtensionFactory {
  return (pi) => {
    pi.on('before_agent_start', (event) => {
      event.systemPromptOptions.cwd = '.'
    })
  }
}

export function isConfinedGroupHistoryAllowed(workspacePath: string): boolean {
  return readConfinedPolicy(workspacePath)?.allowGroupChatHistory !== false
}
