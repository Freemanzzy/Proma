import type { AgentStreamPayload, PermissionRequest, SDKMessage } from '@proma/shared'

export const TOOL_INPUT_LIMIT = 500
export const TOOL_RESULT_LIMIT = 1000

export interface WebRemoteMessage {
  type: 'message'
  id?: string
  role: 'user' | 'assistant' | 'tool' | 'system' | 'unknown'
  text?: string
  toolName?: string
  toolInput?: string
  toolResult?: string
  isError?: boolean
  timestamp?: number
}

export type WebRemoteEvent =
  | { type: 'sdk_message'; message: WebRemoteMessage }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_status'; toolName: string; status: 'started' | 'completed'; input?: string; result?: string; isError?: boolean }
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

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const item = part as Record<string, unknown>
      if (item.type === 'text') return stringValue(item.text) ?? ''
      if (item.type === 'input_text') return stringValue(item.text) ?? ''
      return ''
    })
    .join('')
}

function firstToolUse(content: unknown): { name?: string; input?: unknown; id?: string } | undefined {
  if (!Array.isArray(content)) return undefined
  const part = content.find((candidate) => candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).type === 'tool_use')
  if (!part || typeof part !== 'object') return undefined
  const item = part as Record<string, unknown>
  return { name: stringValue(item.name), input: item.input, id: stringValue(item.id) }
}

function jsonPreview(value: unknown, limit: number): string | undefined {
  if (value === undefined) return undefined
  try {
    return truncate(typeof value === 'string' ? value : JSON.stringify(value), limit)
  } catch {
    return '[无法显示]'
  }
}

export function toWebRemoteMessage(message: SDKMessage | unknown): WebRemoteMessage {
  const item = (message && typeof message === 'object' ? message : {}) as Record<string, unknown>
  const type = stringValue(item.type)
  const timestamp = typeof item.timestamp === 'number' ? item.timestamp : undefined
  const id = stringValue(item.uuid) ?? stringValue(item.id)

  if (type === 'user') {
    return { type: 'message', id, role: 'user', text: contentText(item.message ?? item.content), timestamp }
  }
  if (type === 'assistant') {
    const nested = item.message && typeof item.message === 'object' ? item.message as Record<string, unknown> : item
    const tool = firstToolUse(nested.content ?? item.content)
    const text = contentText(nested.content ?? item.content)
    return {
      type: 'message', id, role: 'assistant', text: text || undefined,
      ...(tool?.name ? { toolName: tool.name } : {}),
      ...(tool?.input !== undefined ? { toolInput: jsonPreview(tool.input, TOOL_INPUT_LIMIT) } : {}),
      timestamp,
    }
  }
  if (type === 'tool_result' || type === 'result') {
    const content = item.content ?? item.result ?? item.output
    return {
      type: 'message', id, role: 'tool', toolName: stringValue(item.toolName) ?? stringValue(item.name),
      toolResult: jsonPreview(content, TOOL_RESULT_LIMIT),
      isError: item.is_error === true || item.isError === true,
      timestamp,
    }
  }
  if (type === 'system') return { type: 'message', id, role: 'system', text: contentText(item.content ?? item.message), timestamp }
  return { type: 'message', id, role: 'unknown', text: '[不支持的消息类型]', timestamp }
}

export function toWebRemotePermissionRequest(request: PermissionRequest): WebRemotePermissionRequest {
  let toolInput = '{}'
  try {
    toolInput = truncate(JSON.stringify(request.toolInput), TOOL_INPUT_LIMIT)
  } catch {
    toolInput = '[无法显示]'
  }
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    toolName: request.toolName,
    description: truncate(request.description, TOOL_RESULT_LIMIT),
    ...(request.command ? { command: truncate(request.command, TOOL_INPUT_LIMIT) } : {}),
    dangerLevel: request.dangerLevel,
    allowAlways: false,
    toolInput,
  }
}

export function toWebRemoteEvent(sessionId: string, payload: AgentStreamPayload): WebRemoteEvent[] {
  if (payload.kind === 'sdk_message') return [{ type: 'sdk_message', message: toWebRemoteMessage(payload.message) }]
  if (payload.kind === 'sdk_delta') {
    const events: WebRemoteEvent[] = []
    for (const delta of payload.delta.deltas) {
      if (delta.type === 'text_delta') events.push({ type: 'text_delta', text: delta.delta })
      if (delta.type === 'toolcall_start' && delta.toolCall) {
        events.push({ type: 'tool_status', toolName: delta.toolCall.name, status: 'started', input: jsonPreview(delta.toolCall.arguments, TOOL_INPUT_LIMIT) })
      }
      if (delta.type === 'toolcall_end' && delta.toolCall) {
        events.push({ type: 'tool_status', toolName: delta.toolCall.name, status: 'completed', input: jsonPreview(delta.toolCall.arguments, TOOL_INPUT_LIMIT) })
      }
    }
    return events
  }
  const event = payload.event
  switch (event.type) {
    case 'permission_request': return [{ type: 'permission_request', request: toWebRemotePermissionRequest(event.request) }]
    case 'permission_resolved': return [{ type: 'permission_resolved', requestId: event.requestId, behavior: event.behavior }]
    case 'ask_user_request': return [{ type: 'interaction_unavailable', interaction: 'ask_user', message: '请在桌面处理 AskUserQuestion' }]
    case 'exit_plan_mode_request': return [{ type: 'interaction_unavailable', interaction: 'exit_plan_mode', message: '请在桌面处理 ExitPlanMode' }]
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
