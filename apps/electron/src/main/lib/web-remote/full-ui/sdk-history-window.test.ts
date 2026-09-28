import { describe, expect, test } from 'bun:test'
import { selectWebRemoteHistoryWindow, slimWebRemoteHistory } from './sdk-history-window'

describe('Web Remote SDK history window', () => {
  test('keeps complete user-to-user turns and reports omitted earlier messages', () => {
    const messages = [
      { type: 'user', text: 'u1' },
      { type: 'assistant', content: [{ type: 'tool_use', id: 'call-1' }] },
      { type: 'assistant', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'result' }] },
      { type: 'assistant', text: 'done-1' },
      { type: 'user', text: 'u2' },
      { type: 'assistant', text: 'done-2' },
    ]
    const window = selectWebRemoteHistoryWindow(messages, 90)
    expect(window.hasEarlier).toBe(true)
    expect(window.omittedCount).toBeGreaterThan(0)
    expect(window.messages.map((message) => message.type)).toEqual(['user', 'assistant'])
    const allFirstTurn = selectWebRemoteHistoryWindow(messages, 1_000)
    expect(allFirstTurn.messages).toEqual(messages)
  })

  test('truncates oversized tool outputs, replaces image blocks and leaves ordinary text intact', () => {
    const input = [
      { type: 'assistant', content: [{ type: 'text', text: 'x'.repeat(20_000) }] },
      { type: 'assistant', content: [{ type: 'tool_result', content: [{ type: 'text', text: 'y'.repeat(20_000) }, { type: 'image', source: { media_type: 'image/png', data: 'A'.repeat(8_000) } }] }] },
    ]
    const output = slimWebRemoteHistory(input) as Array<{ content: Array<Record<string, unknown>> }>
    expect((output[0]!.content[0]!.text as string)).toHaveLength(20_000)
    expect((output[1]!.content[0]!.content as Array<Record<string, unknown>>)[0]!.text).toContain('内容已截断，原文')
    expect((output[1]!.content[0]!.content as Array<Record<string, unknown>>)[1]!.text).toContain('图片已省略：image/png')
    expect(JSON.stringify(output)).not.toContain('A'.repeat(8000))
  })

  test('keeps a single oversized turn intact rather than splitting tool calls from results', () => {
    const messages = [
      { type: 'user', content: 'question' },
      { type: 'assistant', content: [{ type: 'tool_use', id: 'call-1' }] },
      { type: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'result' }] },
      { type: 'assistant', content: 'final answer' },
      { type: 'user', content: 'next question' },
      { type: 'assistant', content: 'next answer' },
    ]
    const window = selectWebRemoteHistoryWindow(messages, 1)
    expect(window.messages.map((message) => message.type)).toEqual(['user', 'assistant'])
    const wholeTurn = selectWebRemoteHistoryWindow(messages, 100_000, 4)
    expect(wholeTurn.messages).toHaveLength(4)
  })
})
