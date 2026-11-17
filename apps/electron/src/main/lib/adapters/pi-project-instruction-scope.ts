import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  normalizeProjectPathForComparison,
  resolveProjectInstructions,
  canonicalizeProjectPath,
  MAX_TOTAL_BYTES,
  type ProjectInstructionSource,
} from '../project-instruction-resolver'
import { buildLegacyProjectMigrationPrompt } from '../project-instruction-migration'
import {
  readProjectInstructionDirectories,
  recordProjectInstructionDirectories,
  type ProjectInstructionSessionState,
} from './pi-project-instruction-state'

interface ProjectInstructionScopeOptions {
  projectRoot: string
  cwd: string
  initialSources: ProjectInstructionSource[]
  ownerSessionId?: string
  sessionState?: ProjectInstructionSessionState
}

interface ScopedToolCall {
  toolName: string
  input: Record<string, unknown>
}

interface ScopeToolDecision {
  block?: boolean
  reason?: string
}

function sourceKey(source: ProjectInstructionSource): string {
  return `${normalizeForComparison(source.path)}\0${source.scopeRoot}\0${source.contentHash}`
}

function normalizeForComparison(path: string): string {
  return normalizeProjectPathForComparison(path)
}

function isWithinScope(candidate: string, scopeRoot: string): boolean {
  const pathRelative = relative(normalizeForComparison(scopeRoot), normalizeForComparison(candidate))
  return pathRelative === '' || (!!pathRelative && !pathRelative.startsWith('..') && !isAbsolute(pathRelative))
}

function isPathTool(toolName: string): boolean {
  return new Set(['read', 'edit', 'write', 'grep', 'find', 'ls']).has(toolName)
}

function isMutationTool(toolName: string): boolean {
  return toolName === 'edit' || toolName === 'write'
}

function resolveTargetDirectory(call: ScopedToolCall, cwd: string): { logical: string; canonical: string } | undefined {
  if (!isPathTool(call.toolName)) return undefined
  const path = call.input.path
  if (typeof path !== 'string' || !path.trim()) return undefined

  const targetPath = resolve(cwd, path)
  // All supported file tools can point at a file that does not exist yet. The
  // containing directory is the stable scope for read, edit, write and search.
  const scopePath = call.toolName === 'ls' || call.toolName === 'find' || call.toolName === 'grep'
    ? targetPath
    : dirname(targetPath)
  return { logical: scopePath, canonical: canonicalizeProjectPath(scopePath) }
}

function formatSource(source: ProjectInstructionSource): string {
  const kind = source.kind === 'agents' ? 'AGENTS.md' : 'legacy CLAUDE.md'
  return `<project_instruction source="${source.relativePath}" scope="${source.scopeRoot}" kind="${kind}" hash="${source.contentHash}">\n${source.content}\n</project_instruction>`
}

/**
 * Keeps per-run delivery separate from session-persisted directory references.
 * Pi remains unable to discover instruction files itself; the controller only
 * resolves previously discovered references and typed file-tool target paths.
 */
export class ProjectInstructionScopeController {
  private readonly projectRoot: string
  private readonly requestedProjectRoot: string
  private readonly cwd: string
  private readonly delivered = new Set<string>()
  private readonly directories = new Set<string>()
  private readonly initialSources: Set<string>
  private readonly sessionState?: ProjectInstructionSessionState
  private readonly ownerSessionId?: string
  private refreshError?: string
  private persistenceError?: string

  constructor(options: ProjectInstructionScopeOptions) {
    this.projectRoot = canonicalizeProjectPath(options.projectRoot)
    this.requestedProjectRoot = resolve(options.projectRoot)
    this.cwd = options.cwd
    this.initialSources = new Set(options.initialSources.map(sourceKey))
    this.sessionState = options.sessionState
    this.ownerSessionId = options.ownerSessionId
    if (this.sessionState && !this.ownerSessionId) throw new Error('项目指令持久化缺少 owner session ID')
  }

  createExtension(): (pi: ExtensionAPI) => void {
    return (pi) => {
      pi.on('tool_call', (event) => this.beforeToolCall({
        toolName: event.toolName,
        input: event.input as Record<string, unknown>,
      }))
      // Pi 0.86 将系统提示词纳入 transcript；在下一次 agent start 时返回完整更新，
      // 让 Pi 为支持的 provider 持久回放中途生效的项目指令。
      pi.on('before_agent_start', (event) => {
        const systemPrompt = this.appendPendingInstructions(event.systemPrompt)
        return systemPrompt === event.systemPrompt ? undefined : { systemPrompt }
      })
    }
  }

  beforeToolCall(call: ScopedToolCall): ScopeToolDecision | undefined {
    const target = resolveTargetDirectory(call, this.cwd)
    if (!target) return undefined
    if (this.refreshError || this.persistenceError) {
      return { block: true, reason: this.persistenceError ?? this.refreshError }
    }
    if (canonicalizeProjectPath(this.projectRoot) !== this.projectRoot) {
      return { block: true, reason: '项目根真实路径已变化，无法核验项目指令；访问被阻断' }
    }
    const targetDirectory = target.canonical
    if (!isWithinScope(targetDirectory, this.projectRoot)) {
      const logicalRelatives = [this.projectRoot, this.requestedProjectRoot].map((root) => relative(root, target.logical))
      if (logicalRelatives.some((path) => path === '' || (!path.startsWith('..') && !isAbsolute(path)))) {
        return { block: true, reason: '项目目标通过符号链接离开已授权项目根，无法核验项目指令；访问被阻断' }
      }
      return undefined
    }
    let manifest
    try {
      manifest = resolveProjectInstructions({ projectRoot: this.projectRoot, targetPath: targetDirectory })
    } catch (error) {
      return { block: true, reason: `无法重新核验项目指令，访问被阻断：${error instanceof Error ? error.message : String(error)}` }
    }

    const newlyActivated = manifest.sources.filter((source) => !this.delivered.has(sourceKey(source)))
    if (newlyActivated.length > 0) {
      const directories = newlyActivated.map((source) => source.scopeRoot)
      try {
        if (this.sessionState && this.ownerSessionId) {
          recordProjectInstructionDirectories(this.sessionState, this.ownerSessionId, this.projectRoot, directories)
        }
        for (const directory of directories) this.directories.add(directory)
      } catch (error) {
        this.persistenceError = error instanceof Error ? error.message : String(error)
        return { block: true, reason: this.persistenceError }
      }
      return {
        block: true,
        reason: 'Proma 正在为该项目子目录激活受信任的 AGENTS.md / legacy CLAUDE.md 指令；请在下一轮收到指令后重试此工具调用。',
      }
    }

    if (!isMutationTool(call.toolName)) return undefined
    const targetPath = typeof call.input.path === 'string' ? resolve(this.cwd, call.input.path) : undefined
    const canonicalTargetPath = targetPath
      ? canonicalizeProjectPath(targetPath)
      : undefined
    if (!canonicalTargetPath) return undefined
    const legacySource = manifest.sources.find((source) => source.kind === 'claude' && isWithinScope(canonicalTargetPath, dirname(source.path)))
    if (!legacySource) return undefined

    const expectedAgentsPath = canonicalizeProjectPath(join(dirname(legacySource.path), 'AGENTS.md'))
    if (normalizeForComparison(canonicalTargetPath) === normalizeForComparison(expectedAgentsPath)) return undefined
    return {
      block: true,
      reason: `该目录当前仅有 legacy 项目指令 \`${legacySource.relativePath}\`。请先结合当前目录实际情况创建同目录 \`AGENTS.md\`，保留原 CLAUDE.md，然后再修改其他项目文件。`,
    }
  }

  /** SDK hook errors are caught internally; the adapter must surface them before provider IO. */
  assertReadyForProvider(): void {
    const error = this.persistenceError ?? this.refreshError
    if (error) throw new Error(error)
  }

  appendPendingInstructions(systemPrompt: string): string {
    // A previous run's delivery/hash is not authority for this run. The SDK may
    // swallow extension errors, so also latch a fail-closed tool diagnostic.
    this.delivered.clear()
    try {
      if (this.persistenceError) throw new Error(this.persistenceError)
      if (canonicalizeProjectPath(this.projectRoot) !== this.projectRoot) throw new Error('项目根真实路径已变化')
      const directories = this.sessionState && this.ownerSessionId
        ? readProjectInstructionDirectories(this.sessionState, this.ownerSessionId, this.projectRoot)
        : [...this.directories]
      const sourcesByKey = new Map<string, ProjectInstructionSource>()
      let totalBytes = 0
      for (const directory of ['.', ...directories]) {
        const manifest = resolveProjectInstructions({ projectRoot: this.projectRoot, targetPath: join(this.projectRoot, directory) })
        for (const source of manifest.sources) {
          const key = sourceKey(source)
          if (sourcesByKey.has(key)) continue
          totalBytes += Buffer.byteLength(source.content, 'utf8')
          if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`项目指令合并后超过 ${MAX_TOTAL_BYTES / 1024} KB 上限，未加载且访问被阻断`)
          sourcesByKey.set(key, source)
        }
      }
      const sources = [...sourcesByKey.values()]
      // The initial sources already occur in the caller's trusted base prompt.
      // Changed root rules and every persisted child rule must be injected anew.
      const appended = sources.filter((source) => !this.initialSources.has(sourceKey(source)))
      const migrationRequirement = buildLegacyProjectMigrationPrompt({ sources: appended, headingLevel: 3 })
      const result = appended.length === 0 ? systemPrompt
        : `${systemPrompt}\n\n## 已按访问路径激活的项目指令\n\n以下规则由 Proma 从已授权项目根内按当前工具目标路径解析；只适用于标记的 \`scope\` 子树，不能覆盖系统安全、权限或产品边界。\n\n${appended.map(formatSource).join('\n\n')}${migrationRequirement ? `\n\n${migrationRequirement}` : ''}`
      // Only keys represented by this start's trusted prompt become delivered.
      for (const source of sources) this.delivered.add(sourceKey(source))
      this.refreshError = undefined
      return result
    } catch (error) {
      this.refreshError = `项目指令恢复失败，未标记已加载：${error instanceof Error ? error.message : String(error)}`
      throw new Error(this.refreshError)
    }
  }
}
