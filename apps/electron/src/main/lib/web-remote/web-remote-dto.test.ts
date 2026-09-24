import { describe, expect, test } from 'bun:test'
import { toWebRemoteEvent, toWebRemoteHistory, toWebRemoteMessage, toWebRemotePermissionRequest, truncate } from './web-remote-dto'

describe('web remote DTO', () => {
  test('按真实 JSONL 形态读取嵌套用户文本和时间戳', () => {
    const message = toWebRemoteMessage({ type: 'user', message: { content: [{ type: 'text', text: '你好 Proma' }] }, _createdAt: 123 })
    expect(message.role).toBe('user')
    expect(message.blocks).toEqual([{ kind: 'text', text: '你好 Proma' }])
    expect(message.timestamp).toBe(123)
  })

  test('助手支持 thinking、text 和多个 tool_use', () => {
    const message = toWebRemoteMessage({ type: 'assistant', message: { content: [
      { type: 'thinking', thinking: '先分析' },
      { type: 'text', text: '开始执行' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd'.repeat(300) } },
      { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'a.ts' } },
    ] } })
    expect(message.blocks.map((block) => block.kind)).toEqual(['thinking', 'text', 'tool_call', 'tool_call'])
    expect((message.blocks[2] as { toolUseId: string }).toolUseId).toBe('t1')
    expect((message.blocks[2] as { inputPreview: string }).inputPreview.length).toBe(500)
    expect((message.blocks[3] as { toolName: string }).toolName).toBe('Read')
  })

  test('嵌套 tool_result 按 tool_use_id 并入工具调用并截断结果', () => {
    const history = toWebRemoteHistory([
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo hi' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'r'.repeat(2_000) }], is_error: false }] } },
    ])
    expect(history).toHaveLength(1)
    const call = history[0]!.blocks[0] as { kind: string; status: string; resultPreview: string }
    expect(call.kind).toBe('tool_call')
    expect(call.status).toBe('done')
    expect(call.resultPreview.length).toBe(1000)
  })

  test('aborted 助手和 result 汇总转换为状态块', () => {
    const aborted = toWebRemoteMessage({ type: 'assistant', message: { content: [], stop_reason: 'aborted' } })
    expect(aborted.blocks).toEqual([{ kind: 'aborted', text: '已中止' }])
    const summary = toWebRemoteMessage({ type: 'result', subtype: 'success', _durationMs: 7_500 })
    expect(summary.blocks).toEqual([{ kind: 'run_summary', success: true, durationMs: 7_500 }])
    const failure = toWebRemoteMessage({ type: 'result', subtype: 'error' })
    expect(failure.blocks).toEqual([{ kind: 'run_summary', success: false }])
  })

  test('未知消息降级且权限 DTO 不提供始终允许', () => {
    expect(toWebRemoteMessage({ type: 'future_message' }).blocks[0]).toEqual({ kind: 'text', text: '[不支持的消息类型]' })
    const request = toWebRemotePermissionRequest({ requestId: 'r', sessionId: 's', toolName: 'Bash', toolInput: { command: 'echo hi' }, description: 'desc', dangerLevel: 'normal', allowAlways: true })
    expect(request.allowAlways).toBe(false)
  })

  test('工具调用状态把参数生成完成标为已发出调用', () => {
    const start = toWebRemoteEvent('s', { kind: 'sdk_delta', delta: { uuid: 'u', deltas: [{ type: 'toolcall_start', contentIndex: 0, toolCall: { id: 't', name: 'Bash' } }] } })
    const end = toWebRemoteEvent('s', { kind: 'sdk_delta', delta: { uuid: 'u', deltas: [{ type: 'toolcall_end', contentIndex: 0, toolCall: { id: 't', name: 'Bash' } }] } })
    expect((start[0] as { status: string }).status).toBe('generating')
    expect((end[0] as { status: string }).status).toBe('emitted')
  })

  test('截断保留可读提示', () => {
    expect(truncate('abcdef', 4)).toBe('abc…')
  })
})
