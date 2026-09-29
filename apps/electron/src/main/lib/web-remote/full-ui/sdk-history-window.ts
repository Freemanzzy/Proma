import { createHash } from 'node:crypto'

const DEFAULT_HISTORY_BUDGET_BYTES = 2 * 1024 * 1024
const TOOL_RESULT_LIMIT_BYTES = 16 * 1024
const INLINE_IMAGE_MAX_BYTES = 256 * 1024
const INLINE_IMAGE_PAGE_BUDGET_BYTES = 1024 * 1024
const EXPAND_TEXT_MAX_BYTES = 2 * 1024 * 1024
const FETCH_IMAGE_MAX_BYTES = 25 * 1024 * 1024
export const WEB_REMOTE_MEDIA_MARKER_PREFIX = '[[proma-web-remote-media:'
export const WEB_REMOTE_TEXT_MARKER_PREFIX = '[[proma-web-remote-text:'

export interface WebRemoteHistoryWindow<T> {
  messages: T[]
  omittedCount: number
  hasEarlier: boolean
  startIndex: number
}

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function messageUuid(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const uuid = (value as { uuid?: unknown }).uuid
  return typeof uuid === 'string' && uuid ? uuid : undefined
}

function dataImage(value: string): { mime: string; data: string; bytes: number } | undefined {
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i)
  if (!match) return undefined
  const data = match[2]!.replace(/\s/g, '')
  return { mime: match[1]!, data, bytes: Buffer.from(data, 'base64').byteLength }
}

function marker(kind: 'media' | 'text', payload: Record<string, unknown>): string {
  const prefix = kind === 'media' ? WEB_REMOTE_MEDIA_MARKER_PREFIX : WEB_REMOTE_TEXT_MARKER_PREFIX
  return `${prefix}${Buffer.from(JSON.stringify(payload)).toString('base64url')}]]`
}

function shortenText(text: string, meta: { sessionId: string; uuid?: string; index: number; messageHash: string; path: Array<string | number> }, limit = TOOL_RESULT_LIMIT_BYTES): string {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= limit) return text
  let end = Math.min(text.length, limit)
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > limit) end = Math.floor(end * 0.8)
  const token = marker('text', { sessionId: meta.sessionId, uuid: meta.uuid, index: meta.index, messageHash: meta.messageHash, path: meta.path, bytes, hash: createHash('sha256').update(text).digest('hex') })
  return `${text.slice(0, end)}\n\n${token}[内容已截断，点按查看完整内容（原文 ${(bytes / 1024).toFixed(1)} KB）]`
}

interface SlimContext { sessionId: string; index: number; uuid?: string; messageHash: string; budget: { inlineBytes: number; enabled: boolean }; path: Array<string | number>; inToolResult: boolean }
function slimValue(value: unknown, context: SlimContext): unknown {
  if (typeof value === 'string') {
    const image = dataImage(value)
    if (image) {
      const canInline = context.budget.enabled && image.bytes <= INLINE_IMAGE_MAX_BYTES && context.budget.inlineBytes + image.bytes <= INLINE_IMAGE_PAGE_BUDGET_BYTES
      if (canInline) context.budget.inlineBytes += image.bytes
      return marker('media', { sessionId: context.sessionId, uuid: context.uuid, index: context.index, messageHash: context.messageHash, path: context.path, mime: image.mime, bytes: image.bytes, ...(canInline ? { inlineData: image.data } : {}) })
    }
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => slimValue(item, { ...context, path: [...context.path, index] }))
  if (!value || typeof value !== 'object') return value
  const block = value as Record<string, unknown>
  const inToolResult = context.inToolResult || block.type === 'toolResult' || block.type === 'tool_result'
  if (block.type === 'image') {
    const source = block.source && typeof block.source === 'object' ? block.source as Record<string, unknown> : {}
    const mime = typeof source.media_type === 'string' ? source.media_type : typeof block.mimeType === 'string' ? block.mimeType : 'image/*'
    const data = typeof source.data === 'string' ? source.data : typeof block.data === 'string' ? block.data : ''
    const bytes = Buffer.from(data, 'base64').byteLength
    const canInline = context.budget.enabled && bytes > 0 && bytes <= INLINE_IMAGE_MAX_BYTES && context.budget.inlineBytes + bytes <= INLINE_IMAGE_PAGE_BUDGET_BYTES
    if (canInline) context.budget.inlineBytes += bytes
    const token = marker('media', { sessionId: context.sessionId, uuid: context.uuid, index: context.index, messageHash: context.messageHash, path: context.path, mime, bytes, ...(canInline ? { inlineData: data } : {}) })
    return { type: 'text', text: canInline ? `${token}[图片 · ${(bytes / 1024).toFixed(1)} KB]` : `${token}[图片 · ${(bytes / 1024).toFixed(1)} KB · 点按加载]` }
  }
  const output: Record<string, unknown> = {}
  for (const [childKey, child] of Object.entries(block)) {
    const childContext = { ...context, path: [...context.path, childKey], inToolResult }
    output[childKey] = typeof child === 'string' && inToolResult && /^(content|text|result|output)$/i.test(childKey)
      ? shortenText(child, childContext)
      : slimValue(child, childContext)
  }
  return output
}

export function slimWebRemoteHistory<T>(messages: T[], sessionId = '', startIndex = 0, inlineImages = true): T[] {
  const output = new Array<T>(messages.length)
  const budget = { inlineBytes: 0, enabled: inlineImages }
  for (let offset = messages.length - 1; offset >= 0; offset--) {
    const message = messages[offset]!
    const index = startIndex + offset
    const messageHash = createHash('sha256').update(JSON.stringify(message)).digest('hex')
    const context: SlimContext = { sessionId, index, uuid: messageUuid(message), messageHash, budget, path: [], inToolResult: false }
    output[offset] = slimValue(message, context) as T
  }
  return output
}

export function readWebRemoteHistoryMedia(messages: unknown[], request: { sessionId: string; uuid?: string; index?: number; messageHash: string; path: Array<string | number>; kind: 'media' | 'text'; hash?: string }): { mime?: string; data?: string; text?: string } {
  let index = request.index
  if (request.uuid) {
    const matches = messages.flatMap((message, i) => messageUuid(message) === request.uuid ? [i] : [])
    if (matches.length !== 1) throw new Error('无法唯一定位原始消息，请刷新历史后重试')
    index = matches[0]
  }
  if (index === undefined || !Number.isInteger(index) || index < 0 || index >= messages.length) throw new Error('原始消息已不存在，请刷新历史后重试')
  const message = messages[index]
  const hash = createHash('sha256').update(JSON.stringify(message)).digest('hex')
  if (hash !== request.messageHash) throw new Error('原始消息已变化，请刷新历史后重试')
  let target: unknown = message
  for (const part of request.path) {
    if ((typeof part !== 'string' && typeof part !== 'number') || !target || typeof target !== 'object') throw new Error('图片或文本定位路径无效')
    target = (target as Record<string | number, unknown>)[part]
  }
  if (request.kind === 'text') {
    if (typeof target !== 'string') throw new Error('完整文本内容不存在')
    const bytes = Buffer.byteLength(target, 'utf8')
    if (bytes > EXPAND_TEXT_MAX_BYTES) throw new Error('原文超过 2 MB 上限，请在桌面查看')
    if (request.hash && createHash('sha256').update(target).digest('hex') !== request.hash) throw new Error('原文校验失败，请刷新历史后重试')
    return { text: target }
  }
  let mime = 'image/*'; let data = ''
  if (typeof target === 'string') {
    const parsed = dataImage(target)
    if (!parsed) throw new Error('图片数据不存在')
    mime = parsed.mime; data = parsed.data
  } else if (target && typeof target === 'object') {
    const block = target as Record<string, unknown>
    const source = block.source && typeof block.source === 'object' ? block.source as Record<string, unknown> : {}
    mime = typeof source.media_type === 'string' ? source.media_type : typeof block.mimeType === 'string' ? block.mimeType : mime
    data = typeof source.data === 'string' ? source.data : typeof block.data === 'string' ? block.data : ''
  }
  const bytes = Buffer.from(data, 'base64').byteLength
  if (!data || bytes > FETCH_IMAGE_MAX_BYTES) throw new Error(bytes ? '图片超过 25 MB 上限，请在桌面查看' : '图片数据不存在')
  return { mime, data }
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
export function selectWebRemoteHistoryWindow<T>(messages: T[], budgetBytes = DEFAULT_HISTORY_BUDGET_BYTES, endIndex = messages.length, sessionId = ''): WebRemoteHistoryWindow<T> {
  const safeBudget = Number.isFinite(budgetBytes) ? Math.max(1, Math.floor(budgetBytes)) : DEFAULT_HISTORY_BUDGET_BYTES
  const slimmed = slimWebRemoteHistory(messages, '', 0, false)
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
  let selected = slimWebRemoteHistory(messages.slice(startIndex, boundedEnd), sessionId, startIndex, true)
  if (starts.length > 1 && utf8Bytes(selected) > safeBudget) {
    let low = starts.indexOf(startIndex) + 1
    let high = starts.length - 1
    let fittingStart = high
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidateStart = starts[middle]!
      const candidate = slimWebRemoteHistory(messages.slice(candidateStart, boundedEnd), sessionId, candidateStart, true)
      if (utf8Bytes(candidate) <= safeBudget) { fittingStart = middle; high = middle - 1 }
      else low = middle + 1
    }
    startIndex = starts[fittingStart]!
    selected = slimWebRemoteHistory(messages.slice(startIndex, boundedEnd), sessionId, startIndex, true)
  }
  return { messages: selected, omittedCount: startIndex, hasEarlier: startIndex > 0, startIndex }
}
