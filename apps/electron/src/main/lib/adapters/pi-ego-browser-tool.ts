import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')

const DEFAULT_TIMEOUT_MS = 120_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 600_000
const MAX_OUTPUT_BYTES = 50 * 1024
const NOTICE_PREFIX = '[ego-browser:notice]'
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

export interface EgoBrowserRunOptions {
  timeoutMs?: number
  serverName?: string
  signal?: AbortSignal
  /** Primarily useful for deterministic tests; normal callers use resolveEgoBrowserBin(). */
  bin?: string
}

export interface EgoBrowserRunResult {
  content: [{ type: 'text'; text: string }]
  details?: {
    exitCode: number | null
    signal?: NodeJS.Signals
    timedOut?: boolean
    aborted?: boolean
    bin?: string
  }
}

function isExecutableFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile() && (accessSync(candidate, constants.X_OK), true)
  } catch {
    return false
  }
}

/** Resolve the ego-browser executable without relying on a shell or a hard-coded user path. */
export function resolveEgoBrowserBin(homeDir = homedir()): string | null {
  const configured = process.env.EGO_BROWSER_BIN?.trim()
  if (configured && isExecutableFile(configured)) return configured

  const pathValue = process.env.PATH ?? ''
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, 'ego-browser')
    if (isExecutableFile(candidate)) return candidate
  }

  const fallback = join(homeDir, '.local', 'bin', 'ego-browser')
  return isExecutableFile(fallback) ? fallback : null
}

/** Return the installed ego-browser Agent instructions when available. */
export function getEgoSkillPath(): string | null {
  const skillPath = join(homedir(), '.agents', 'skills', 'ego-browser', 'SKILL.md')
  try {
    return statSync(skillPath).isFile() ? skillPath : null
  } catch {
    return null
  }
}

function normalizeTimeout(timeoutMs: unknown): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs)) {
    throw new Error(`timeoutMs 必须是 ${MIN_TIMEOUT_MS}–${MAX_TIMEOUT_MS} 范围内的整数。`)
  }
  if (timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs 必须是 ${MIN_TIMEOUT_MS}–${MAX_TIMEOUT_MS} 范围内的整数。`)
  }
  return timeoutMs
}

function normalizeServerName(serverName: unknown): string | undefined {
  if (serverName === undefined) return undefined
  if (typeof serverName !== 'string' || !SERVER_NAME_PATTERN.test(serverName)) {
    throw new Error('serverName 必须是 1–64 位的字母、数字、下划线、点或连字符。')
  }
  return serverName
}

function stopProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid
  if (!pid) return
  try {
    process.kill(-pid, signal)
  } catch {
    try { child.kill(signal) } catch { /* process already exited */ }
  }
}

function mergeOutput(chunks: Array<{ order: number; text: string }>): string {
  return chunks
    .sort((left, right) => left.order - right.order)
    .map(({ text }) => text)
    .join('')
}

function formatOutput(
  chunks: Array<{ order: number; text: string }>,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  errorMessage: string | undefined,
  state: { timedOut: boolean; aborted: boolean },
  bin: string,
): EgoBrowserRunResult {
  const raw = mergeOutput(chunks)
  const notices: string[] = []
  const outputLines: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(NOTICE_PREFIX)) {
      const notice = line.slice(NOTICE_PREFIX.length).trim()
      if (notice) notices.push(notice)
    } else {
      outputLines.push(line)
    }
  }

  let output = outputLines.join('\n')
  const outputBytes = Buffer.byteLength(output, 'utf8')
  if (outputBytes > MAX_OUTPUT_BYTES) {
    const omittedBytes = outputBytes - MAX_OUTPUT_BYTES
    output = `[输出过大，已截断 ${omittedBytes} 字节，仅保留末尾 50KB]\n${Buffer.from(output, 'utf8').subarray(-MAX_OUTPUT_BYTES).toString('utf8')}`
  }

  const sections: string[] = []
  if (errorMessage) sections.push(`启动失败：${errorMessage}`)
  if (output) sections.push(output)
  sections.push(`退出码: ${exitCode === null ? 'unknown' : exitCode}${signal ? `（信号 ${signal}）` : ''}`)
  if (state.timedOut) sections.push('已超时，可在同一 TaskSpace 中继续。')
  if (state.aborted) sections.push('已中止，可在同一 TaskSpace 中继续。')
  if (notices.length > 0) {
    sections.push(`ego 提示：${notices.join('；')}（升级需先征得用户同意）`)
  }

  return {
    content: [{ type: 'text', text: sections.join('\n') }],
    details: {
      exitCode,
      ...(signal ? { signal } : {}),
      ...(state.timedOut ? { timedOut: true } : {}),
      ...(state.aborted ? { aborted: true } : {}),
      bin,
    },
  }
}

/** Execute one ego-browser Node.js script and return an Agent-compatible result. */
export async function runEgoBrowserScript(
  script: string,
  options: EgoBrowserRunOptions = {},
): Promise<EgoBrowserRunResult> {
  if (typeof script !== 'string' || script.length === 0) {
    throw new Error('script 必填且必须是非空字符串。')
  }
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const serverName = normalizeServerName(options.serverName)
  const bin = options.bin ?? resolveEgoBrowserBin()
  if (!bin) {
    return {
      content: [{ type: 'text', text: '未找到可执行的 ego-browser；请安装 ego-browser，或设置 EGO_BROWSER_BIN。\n退出码: unknown' }],
      details: { exitCode: null },
    }
  }

  return await new Promise<EgoBrowserRunResult>((resolve) => {
    const args = [
      ...(serverName ? [`--ego-server-name=${serverName}`] : []),
      'nodejs',
    ]
    let child: ChildProcess
    try {
      child = spawn(bin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        env: process.env,
      })
    } catch (error) {
      resolve(formatOutput([], null, null, error instanceof Error ? error.message : String(error), { timedOut: false, aborted: false }, bin))
      return
    }

    const chunks: Array<{ order: number; text: string }> = []
    let order = 0
    let settled = false
    let timedOut = false
    let aborted = false
    let errorMessage: string | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      stopProcessGroup(child, 'SIGTERM')
      killTimer = setTimeout(() => stopProcessGroup(child, 'SIGKILL'), 2_000)
    }, timeoutMs)

    const append = (chunk: Buffer | string): void => {
      chunks.push({ order: order++, text: chunk.toString() })
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.on('error', (error) => {
      errorMessage = error.message
    })
    const onAbort = (): void => {
      aborted = true
      stopProcessGroup(child, 'SIGTERM')
      killTimer ??= setTimeout(() => stopProcessGroup(child, 'SIGKILL'), 2_000)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()

    child.stdin?.on('error', (error) => {
      if (!errorMessage && (error as NodeJS.ErrnoException).code !== 'EPIPE') errorMessage = error.message
    })
    try {
      child.stdin?.end(script)
    } catch (error) {
      errorMessage ??= error instanceof Error ? error.message : String(error)
    }

    child.on('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(formatOutput(chunks, exitCode, signal, errorMessage, { timedOut, aborted }, bin))
    })
  })
}

export function buildEgoBrowserTools(sdk: PiSdk, resolvedBin = resolveEgoBrowserBin()): ToolDefinition[] {
  const bin = resolvedBin
  if (!bin) return []

  return [sdk.defineTool({
    name: 'EgoBrowser',
    label: '操作 ego 浏览器',
    description: '在 ego lite 浏览器中执行 ego-browser 的 Node 脚本（taskSpace/page API），用于打开网页、站内操作、填表、截图、读取登录态页面。',
    promptSnippet: '需要网页操作时使用 EgoBrowser；先读取 ego-browser 官方说明，并在同一个 TaskSpace 中复用 spaceId。',
    parameters: Type.Object({
      script: Type.String({ minLength: 1, description: '在 ego-browser Node.js 运行时中执行的 JavaScript 脚本。' }),
      timeoutMs: Type.Optional(Type.Number({ default: DEFAULT_TIMEOUT_MS, minimum: MIN_TIMEOUT_MS, maximum: MAX_TIMEOUT_MS, description: '超时时间（毫秒），默认 120000，范围 1000–600000。' })),
      serverName: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9_.-]{1,64}$', description: '可选 ego server 名称；只允许 1–64 位字母、数字、下划线、点或连字符。' })),
    }),
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<unknown>> {
      const input = params as { script: string; timeoutMs?: number; serverName?: string }
      return await runEgoBrowserScript(input.script, { timeoutMs: input.timeoutMs, serverName: input.serverName, signal, bin }) as AgentToolResult<unknown>
    },
  })] as unknown as ToolDefinition[]
}