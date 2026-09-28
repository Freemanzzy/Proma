const DEFAULT_HISTORY_BUDGET_BYTES = 2 * 1024 * 1024
const TOOL_RESULT_LIMIT_BYTES = 16 * 1024

export interface WebRemoteHistoryWindow<T> {
  messages: T[]
  omittedCount: number
  hasEarlier: boolean
  startIndex: number
}

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function shortenText(text: string, limit = TOOL_RESULT_LIMIT_BYTES): string {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= limit) return text
  let end = Math.min(text.length, limit)
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > limit) end = Math.floor(end * 0.8)
  return `${text.slice(0, end)}\n\n[内容已截断，原文 ${(bytes / 1024).toFixed(1)} KB；完整内容请在桌面查看]`
}

function isImageData(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)
}

function slimValue(value: unknown, key = '', inToolResult = false): unknown {
  if (typeof value === 'string') {
    if (isImageData(value)) {
      const mime = value.match(/^data:(image\/[a-z0-9.+-]+);base64,/i)?.[1] ?? 'image/*'
      const bytes = Math.floor(value.replace(/\s/g, '').length * 3 / 4)
      return `[图片已省略：${mime}，约 ${(bytes / 1024).toFixed(1)} KB；完整内容请在桌面查看]`
    }
    return inToolResult && /^(content|text|result|output)$/i.test(key) ? shortenText(value) : value
  }
  if (Array.isArray(value)) return value.map((item) => slimValue(item, '', inToolResult))
  if (!value || typeof value !== 'object') return value
  const block = value as Record<string, unknown>
  const isToolResult = inToolResult || block.type === 'toolResult' || block.type === 'tool_result'
  if (block.type === 'image') {
    const source = block.source && typeof block.source === 'object' ? block.source as Record<string, unknown> : {}
    const mime = typeof source.media_type === 'string' ? source.media_type : typeof block.mimeType === 'string' ? block.mimeType : 'image/*'
    const data = typeof source.data === 'string' ? source.data : typeof block.data === 'string' ? block.data : ''
    const bytes = Math.floor(data.length * 3 / 4)
    return { type: 'text', text: `[图片已省略：${mime}${bytes ? `，约 ${(bytes / 1024).toFixed(1)} KB` : ''}；完整内容请在桌面查看]` }
  }
  const output: Record<string, unknown> = {}
  for (const [childKey, child] of Object.entries(block)) output[childKey] = slimValue(child, childKey, isToolResult)
  return output
}

export function slimWebRemoteHistory<T>(messages: T[]): T[] {
  return messages.map((message) => slimValue(message) as T)
}

function messageRole(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as { type?: unknown; role?: unknown; message?: { role?: unknown } }
  const role = record.type ?? record.role ?? record.message?.role
  return typeof role === 'string' ? role : undefined
}

function toolIds(value: unknown, blockType: 'tool_use' | 'tool_result'): string[] {
  const found: string[] = []
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') return
    if (Array.isArray(item)) { for (const child of item) visit(child); return }
    const record = item as Record<string, unknown>
    if (record.type === blockType) {
      const id = blockType === 'tool_use' ? record.id : record.tool_use_id
      if (typeof id === 'string') found.push(id)
    }
    for (const child of Object.values(record)) visit(child)
  }
  visit(value)
  return found
}

/** Select complete user-to-user turns from the tail; a single oversized turn remains intact. */
export function selectWebRemoteHistoryWindow<T>(messages: T[], budgetBytes = DEFAULT_HISTORY_BUDGET_BYTES, endIndex = messages.length): WebRemoteHistoryWindow<T> {
  const safeBudget = Number.isFinite(budgetBytes) ? Math.max(1, Math.floor(budgetBytes)) : DEFAULT_HISTORY_BUDGET_BYTES
  const slimmed = slimWebRemoteHistory(messages)
  const boundedEnd = Math.min(slimmed.length, Math.max(0, Math.floor(endIndex)))
  const page = slimmed.slice(0, boundedEnd)
  if (page.length === 0) return { messages: [], omittedCount: 0, hasEarlier: false, startIndex: 0 }
  const starts = [0]
  const pendingToolIds = new Set<string>()
  for (let i = 0; i < page.length; i++) {
    const message = page[i]
    const role = messageRole(message)
    if (role === 'user') {
      const results = toolIds(message, 'tool_result')
      const isToolContinuation = results.some((id) => pendingToolIds.has(id))
      if (i > 0 && !isToolContinuation) starts.push(i)
      if (!isToolContinuation) pendingToolIds.clear()
      for (const id of results) pendingToolIds.delete(id)
    }
    if (role === 'assistant') for (const id of toolIds(message, 'tool_use')) pendingToolIds.add(id)
  }
  let startIndex = starts[starts.length - 1] ?? 0
  let bytes = 0
  for (let turn = starts.length - 1; turn >= 0; turn--) {
    const candidateStart = starts[turn]!
    const candidateEnd = turn + 1 < starts.length ? starts[turn + 1]! : page.length
    const turnBytes = utf8Bytes(page.slice(candidateStart, candidateEnd))
    if (bytes > 0 && bytes + turnBytes > safeBudget) break
    bytes += turnBytes
    startIndex = candidateStart
    if (bytes >= safeBudget) break
  }
  return {
    messages: page.slice(startIndex),
    omittedCount: startIndex,
    hasEarlier: startIndex > 0,
    startIndex,
  }
}
