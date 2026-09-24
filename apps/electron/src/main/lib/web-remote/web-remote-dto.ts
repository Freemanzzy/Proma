import type { AgentStreamPayload, PermissionRequest, SDKMessage } from '@proma/shared'

export const TOOL_INPUT_LIMIT = 500
export const TOOL_RESULT_LIMIT = 1000

export type WebRemoteToolStatus = 'generating' | 'emitted' | 'done' | 'error'

export type WebRemoteBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_call'; toolUseId: string; toolName: string; inputPreview: string; status: WebRemoteToolStatus; resultPreview?: string; isError?: boolean }
  | { kind: 'tool_result'; toolUseId: string; resultPreview: string; isError: boolean }
  | { kind: 'aborted'; text: '已中止' }
  | { kind: 'run_summary'; success: boolean; durationMs?: number }

export interface WebRemoteMessage {
  type: 'message'
  id?: string
  role: 'user' | 'assistant' | 'tool' | 'system' | 'unknown'
  blocks: WebRemoteBlock[]
  timestamp?: number
}

export type WebRemoteEvent =
  | { type: 'sdk_message'; message: WebRemoteMessage }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_status'; toolUseId?: string; toolName: string; status: 'generating' | 'emitted' | 'completed' | 'failed'; input?: string; result?: string; isError?: boolean }
  | { type: 'permission_request'; request: WebRemotePermissionRequest }
  | { type: 'permission_resolved'; requestId: string; behavior: 'allow' | 'deny' }
  | { type: 'run_started' | 'run_completed' | 'run_stopped' }
  | { type: 'interaction_unavailable'; interaction: 'ask_user' | 'exit_plan_mode'; message: string }
  | { type: 'title_updated'; title: string }
  | { type: 'error'; message: string }
  | { type: 'refresh_required'; reason: string }

export interface WebRemotePermissionRequest {
  requestId: string
  sessionId: string
  toolName: string
  description: string
  command?: string
  dangerLevel: string
  allowAlways: false
  toolInput: string
}

export function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 1))}…`
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function jsonPreview(value: unknown, limit: number): string {
  if (value === undefined) return ''
  try {
    return truncate(typeof value === 'string' ? value : JSON.stringify(value), limit)
  } catch {
    return '[无法显示]'
  }
}

function contentParts(message: Record<string, unknown>): Array<Record<string, unknown>> {
  const content = message.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.filter((part): part is Record<string, unknown> => !!part && typeof part === 'object')
}

function timestampOf(item: Record<string, unknown>, nested: Record<string, unknown>): number | undefined {
  return typeof item._createdAt === 'number' ? item._createdAt
    : typeof nested._createdAt === 'number' ? nested._createdAt
      : typeof item.timestamp === 'number' ? item.timestamp : undefined
}

function idOf(item: Record<string, unknown>, nested: Record<string, unknown>): string | undefined {
  return stringValue(item.uuid) ?? stringValue(item.id) ?? stringValue(nested.uuid) ?? stringValue(nested.id)
}

function textBlock(part: Record<string, unknown>): WebRemoteBlock | undefined {
  const text = stringValue(part.text)
  return text ? { kind: 'text', text } : undefined
}

function resultBlock(part: Record<string, unknown>): WebRemoteBlock {
  const content = part.content
  const resultText = Array.isArray(content)
    ? content.map((entry) => entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).text === 'string' ? (entry as Record<string, unknown>).text as string : '').join('')
    : typeof content === 'string' ? content : jsonPreview(content, TOOL_RESULT_LIMIT)
  return {
    kind: 'tool_result',
    toolUseId: stringValue(part.tool_use_id) ?? stringValue(part.toolUseId) ?? '',
    resultPreview: truncate(resultText, TOOL_RESULT_LIMIT),
    isError: part.is_error === true || part.isError === true,
  }
}

export function toolDisplayName(toolName: string): string {
  if (toolName === 'Bash') return '执行命令'
  if (toolName === 'Read') return '读取文件'
  if (toolName === 'Write') return '写入文件'
  if (toolName === 'Edit') return '编辑文件'
  if (toolName.startsWith('mcp__planning__')) return `规划：${toolName.slice('mcp__planning__'.length)}`
  if (toolName === 'EgoBrowser') return '操作浏览器'
  return toolName
}

export function toWebRemoteMessage(message: SDKMessage | unknown): WebRemoteMessage {
  const item = (message && typeof message === 'object' ? message : {}) as Record<string, unknown>
  const type = stringValue(item.type)
  const nested = item.message && typeof item.message === 'object' ? item.message as Record<string, unknown> : item
  const timestamp = timestampOf(item, nested)
  const id = idOf(item, nested)

  if (type === 'result') {
    const subtype = stringValue(item.subtype) ?? 'success'
    return { type: 'message', id, role: 'system', blocks: [{ kind: 'run_summary', success: subtype === 'success', ...(typeof item._durationMs === 'number' ? { durationMs: item._durationMs } : {}) }], timestamp }
  }

  const parts = contentParts(nested)
  if (type === 'user') {
    const blocks = parts.map((part) => part.type === 'tool_result' ? resultBlock(part) : textBlock(part)).filter((block): block is WebRemoteBlock => !!block)
    const hasToolResult = blocks.some((block) => block.kind === 'tool_result')
    return { type: 'message', id, role: hasToolResult ? 'tool' : 'user', blocks, timestamp }
  }

  if (type === 'assistant') {
    const blocks: WebRemoteBlock[] = []
    for (const part of parts) {
      if (part.type === 'thinking') {
        const text = stringValue(part.thinking)
        if (text) blocks.push({ kind: 'thinking', text })
      } else if (part.type === 'text') {
        const block = textBlock(part)
        if (block) blocks.push(block)
      } else if (part.type === 'tool_use') {
        blocks.push({
          kind: 'tool_call',
          toolUseId: stringValue(part.id) ?? '',
          toolName: stringValue(part.name) ?? 'unknown',
          inputPreview: jsonPreview(part.input, TOOL_INPUT_LIMIT),
          status: 'emitted',
        })
      }
    }
    if (blocks.length === 0 && nested.stop_reason === 'aborted') blocks.push({ kind: 'aborted', text: '已中止' })
    return { type: 'message', id, role: 'assistant', blocks, timestamp }
  }

  if (type === 'tool_result') return { type: 'message', id, role: 'tool', blocks: [resultBlock(item)], timestamp }
  if (type === 'system') return { type: 'message', id, role: 'system', blocks: parts.map(textBlock).filter((block): block is WebRemoteBlock => !!block), timestamp }
  return { type: 'message', id, role: 'unknown', blocks: [{ kind: 'text', text: '[不支持的消息类型]' }], timestamp }
}

export function mergeToolResults(messages: WebRemoteMessage[]): WebRemoteMessage[] {
  const result: WebRemoteMessage[] = []
  const calls = new Map<string, WebRemoteBlock & { kind: 'tool_call' }>()
  for (const message of messages) {
    const remaining: WebRemoteBlock[] = []
    for (const block of message.blocks) {
      if (block.kind === 'tool_call') {
        calls.set(block.toolUseId, block)
        remaining.push(block)
      } else if (block.kind === 'tool_result') {
        const call = calls.get(block.toolUseId)
        if (call) {
          call.status = block.isError ? 'error' : 'done'
          call.resultPreview = block.resultPreview
          call.isError = block.isError
        } else {
          remaining.push(block)
        }
      } else remaining.push(block)
    }
    if (remaining.length > 0) result.push({ ...message, blocks: remaining })
  }
  return result
}

export function toWebRemoteHistory(messages: Array<SDKMessage | unknown>): WebRemoteMessage[] {
  return mergeToolResults(messages.map(toWebRemoteMessage))
}

export function toWebRemotePermissionRequest(request: PermissionRequest): WebRemotePermissionRequest {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    toolName: request.toolName,
    description: truncate(request.description, TOOL_RESULT_LIMIT),
    ...(request.command ? { command: truncate(request.command, TOOL_INPUT_LIMIT) } : {}),
    dangerLevel: request.dangerLevel,
    allowAlways: false,
    toolInput: jsonPreview(request.toolInput, TOOL_INPUT_LIMIT),
  }
}

export function toWebRemoteEvent(_sessionId: string, payload: AgentStreamPayload): WebRemoteEvent[] {
  if (payload.kind === 'sdk_message') return [{ type: 'sdk_message', message: toWebRemoteMessage(payload.message) }]
  if (payload.kind === 'sdk_delta') {
    const events: WebRemoteEvent[] = []
    for (const delta of payload.delta.deltas) {
      if (delta.type === 'text_delta') events.push({ type: 'text_delta', text: delta.delta })
      if (delta.type === 'toolcall_start' && delta.toolCall) events.push({ type: 'tool_status', toolUseId: delta.toolCall.id, toolName: delta.toolCall.name, status: 'generating', input: jsonPreview(delta.toolCall.arguments, TOOL_INPUT_LIMIT) })
      if (delta.type === 'toolcall_end' && delta.toolCall) events.push({ type: 'tool_status', toolUseId: delta.toolCall.id, toolName: delta.toolCall.name, status: 'emitted', input: jsonPreview(delta.toolCall.arguments, TOOL_INPUT_LIMIT) })
    }
    return events
  }
  const event = payload.event
  switch (event.type) {
    case 'permission_request': return [{ type: 'permission_request', request: toWebRemotePermissionRequest(event.request) }]
    case 'permission_resolved': return [{ type: 'permission_resolved', requestId: event.requestId, behavior: event.behavior }]
    case 'ask_user_request': return [{ type: 'interaction_unavailable', interaction: 'ask_user', message: 'Agent 正在等你回答问题，请在桌面处理' }]
    case 'exit_plan_mode_request': return [{ type: 'interaction_unavailable', interaction: 'exit_plan_mode', message: 'Agent 正在等待审批计划，请在桌面处理' }]
    case 'run_started':
    case 'external_run_started': return [{ type: 'run_started' }]
    case 'run_completed': return [{ type: 'run_completed' }]
    case 'run_stopped': return [{ type: 'run_stopped' }]
    case 'title_updated': return [{ type: 'title_updated', title: truncate(event.title, 200) }]
    default: return []
  }
}

export function toWebRemoteRefreshEvent(): WebRemoteEvent {
  return { type: 'refresh_required', reason: '输出过多，请刷新会话历史' }
}
