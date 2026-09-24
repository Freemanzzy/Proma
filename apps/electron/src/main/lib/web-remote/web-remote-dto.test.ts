import { describe, expect, test } from 'bun:test'
import { toWebRemoteEvent, toWebRemoteMessage, toWebRemotePermissionRequest, truncate } from './web-remote-dto'

describe('web remote DTO', () => {
  test('工具参数最多 500 字符，工具结果最多 1000 字符', () => {
    const message = toWebRemoteMessage({ type: 'assistant', uuid: 'a', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'x'.repeat(2_000) } }] })
    expect(message.toolInput?.length).toBe(500)
    const result = toWebRemoteMessage({ type: 'tool_result', toolName: 'Bash', result: 'r'.repeat(2_000) })
    expect(result.toolResult?.length).toBe(1000)
  })

  test('未知 SDK 消息降级且权限 DTO 不提供始终允许', () => {
    expect(toWebRemoteMessage({ type: 'future_message' }).text).toBe('[不支持的消息类型]')
    const request = toWebRemotePermissionRequest({
      requestId: 'r', sessionId: 's', toolName: 'Bash', toolInput: { command: 'echo hi' }, description: 'desc', dangerLevel: 'normal', allowAlways: true,
    })
    expect(request.allowAlways).toBe(false)
  })

  test('工具调用开始与结束都转换为状态事件', () => {
    const start = toWebRemoteEvent('s', { kind: 'sdk_delta', delta: { uuid: 'u', deltas: [{ type: 'toolcall_start', contentIndex: 0, toolCall: { id: 't', name: 'Bash' } }] } })
    const end = toWebRemoteEvent('s', { kind: 'sdk_delta', delta: { uuid: 'u', deltas: [{ type: 'toolcall_end', contentIndex: 0, toolCall: { id: 't', name: 'Bash' } }] } })
    expect(start[0]?.type).toBe('tool_status')
    expect(end[0]?.type).toBe('tool_status')
    expect((end[0] as { status?: string } | undefined)?.status).toBe('completed')
  })

  test('截断保留可读提示', () => {
    expect(truncate('abcdef', 4)).toBe('abc…')
  })
})
