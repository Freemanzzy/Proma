/**
 * 个人版：MCP 工具 inputSchema 兼容化。
 *
 * Anthropic Messages API 拒绝顶层含 oneOf / anyOf / allOf 的工具 input_schema（HTTP 400），
 * 单个 MCP 工具即可让整次请求失败（2026-11-05 nowledge-mem 的两个工具触发）。这里把顶层组合约束
 * 移出 schema，压缩成一句说明附加到工具描述；嵌套位置的组合约束保持不变（Anthropic 允许）。
 * 只放宽 schema、不收紧，参数仍由 MCP 服务端最终校验。
 */

const TOP_LEVEL_COMBINATORS = ['oneOf', 'anyOf', 'allOf'] as const
const NOTE_MAX_CHARS = 400
const warned = new Set<string>()

export interface NormalizedMcpInputSchema {
  schema: Record<string, unknown>
  /** 被移出的约束说明；无移出时为 null */
  note: string | null
}

function describeBranch(branch: unknown): string {
  if (!branch || typeof branch !== 'object' || Array.isArray(branch)) return JSON.stringify(branch)
  const record = branch as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length === 1 && keys[0] === 'required' && Array.isArray(record.required)) return `需提供 ${record.required.join(' + ')}`
  return JSON.stringify(branch)
}

export function normalizeMcpInputSchema(schema: Record<string, unknown>, toolKey = ''): NormalizedMcpInputSchema {
  const present = TOP_LEVEL_COMBINATORS.filter((key) => key in schema)
  if (present.length === 0) return { schema, note: null }
  const copy: Record<string, unknown> = { ...schema }
  const parts: string[] = []
  for (const key of present) {
    const branches = Array.isArray(copy[key]) ? copy[key] as unknown[] : [copy[key]]
    delete copy[key]
    const joiner = key === 'allOf' ? '，且 ' : key === 'oneOf' ? '，或（仅一项）' : '，或 '
    parts.push(branches.map(describeBranch).join(joiner))
  }
  let note = `参数约束：${parts.join('；')}`
  if (note.length > NOTE_MAX_CHARS) note = `${note.slice(0, NOTE_MAX_CHARS - 1)}…`
  if (toolKey && !warned.has(toolKey)) {
    warned.add(toolKey)
    console.warn(`[Pi MCP] 工具 ${toolKey} 的 inputSchema 顶层含 ${present.join('/')}，已移入描述以兼容 Anthropic`)
  }
  return { schema: copy, note }
}

function requiredOnly(branch: unknown): string[] | null {
  if (!branch || typeof branch !== 'object' || Array.isArray(branch)) return null
  const record = branch as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1 || keys[0] !== 'required' || !Array.isArray(record.required)) return null
  return record.required.every((item) => typeof item === 'string') ? record.required as string[] : null
}

/**
 * 执行前补回被移出的顶层约束校验（仅限 `{ required: [...] }` 形状的分支，这是 MCP 工具最常见的写法）。
 * 其他形状无法在本地等价校验，交由 MCP 服务端校验。返回错误说明；满足或无法检查时返回 null。
 */
export function checkRemovedTopLevelConstraints(original: Record<string, unknown>, args: Record<string, unknown>): string | null {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(args, key) && args[key] !== undefined
  for (const key of TOP_LEVEL_COMBINATORS) {
    if (!(key in original)) continue
    const raw = Array.isArray(original[key]) ? original[key] as unknown[] : [original[key]]
    const branches = raw.map(requiredOnly)
    if (branches.some((branch) => branch === null)) continue
    const satisfied = (branches as string[][]).filter((fields) => fields.every(has)).length
    const ok = key === 'anyOf' ? satisfied >= 1 : key === 'oneOf' ? satisfied === 1 : satisfied === branches.length
    if (!ok) return `参数不满足工具约束（${key}）：${raw.map(describeBranch).join(key === 'allOf' ? '，且 ' : '，或 ')}`
  }
  return null
}

/** 测试用：重置 WARN 去重 */
export function resetPersonalMcpSchemaWarningsForTest(): void { warned.clear() }
