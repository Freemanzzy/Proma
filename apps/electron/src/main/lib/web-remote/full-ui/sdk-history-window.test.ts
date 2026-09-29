import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readWebRemoteHistoryMedia, selectWebRemoteHistoryWindow, slimWebRemoteHistory, WEB_REMOTE_MEDIA_MARKER_PREFIX, WEB_REMOTE_TEXT_MARKER_PREFIX } from './sdk-history-window'

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

  test('truncates oversized tool outputs, creates structured media markers and leaves ordinary text intact', () => {
    const input = [
      { type: 'assistant', content: [{ type: 'text', text: 'x'.repeat(20_000) }] },
      { type: 'assistant', content: [{ type: 'tool_result', content: [{ type: 'text', text: 'y'.repeat(20_000) }, { type: 'image', source: { media_type: 'image/png', data: Buffer.alloc(300_000).toString('base64') } }] }] },
    ]
    const output = slimWebRemoteHistory(input) as Array<{ content: Array<Record<string, unknown>> }>
    expect((output[0]!.content[0]!.text as string)).toHaveLength(20_000)
    expect((output[1]!.content[0]!.content as Array<Record<string, unknown>>)[0]!.text).toContain('点按查看完整内容（原文')
    expect((output[1]!.content[0]!.content as Array<Record<string, unknown>>)[1]!.text).toContain(WEB_REMOTE_MEDIA_MARKER_PREFIX)
    expect((output[1]!.content[0]!.content as Array<Record<string, unknown>>)[1]!.text).toContain('点按加载')
    expect(JSON.stringify(output)).not.toContain('A'.repeat(8000))
  })

  test('inlines images only through 256 KB and budgets 1 MB from newest to oldest per page', () => {
    const asImage = (size: number, id: string) => ({ type: 'assistant', uuid: id, content: [{ type: 'image', source: { media_type: 'image/png', data: Buffer.alloc(size).toString('base64') } }] })
    const messages = [asImage(256_000, 'old'), asImage(256_000, 'a'), asImage(256_000, 'b'), asImage(256_000, 'c'), asImage(256_000, 'newest'), asImage(262_145, 'too-large')]
    const hasInlineData = (message: { content: Array<Record<string, unknown>> }) => {
      const text = String(message.content[0]?.text ?? '')
      const encoded = text.match(/\[\[proma-web-remote-media:([^\]]+)\]\]/)?.[1]
      return encoded ? typeof JSON.parse(Buffer.from(encoded, 'base64url').toString()).inlineData === 'string' : false
    }
    const result = slimWebRemoteHistory(messages, 'session') as Array<{ content: Array<Record<string, unknown>> }>
    expect(result[0]!.content[0]!.type).toBe('text')
    expect(result.slice(1, 5).every(hasInlineData)).toBe(true)
    expect(hasInlineData(result[5]!)).toBe(false)
    const page = selectWebRemoteHistoryWindow(messages, 1_000_000, messages.length, 'session')
    expect(hasInlineData(page.messages[4]!)).toBe(true)
    expect(hasInlineData(page.messages[0]!)).toBe(false)
  })

  test('returns full text and images only when message uuid, hash and block path match', () => {
    const longText = 'original result '.repeat(2_000)
    const image = Buffer.alloc(300_000).toString('base64')
    const messages = [{ type: 'assistant', uuid: 'stable-uuid', content: [{ type: 'tool_result', content: [{ type: 'text', text: longText }, { type: 'image', source: { media_type: 'image/png', data: image } }] }] }]
    const slimmed = slimWebRemoteHistory(messages, 'session')
    const textMarker = (slimmed[0]!.content[0]!.content[0]!.text as string).match(/\[\[proma-web-remote-text:([^\]]+)\]\]/)![1]!
    const imageMarker = (slimmed[0]!.content[0]!.content[1]!.text as string).match(/\[\[proma-web-remote-media:([^\]]+)\]\]/)![1]!
    const decodeMarker = (value: string) => JSON.parse(Buffer.from(value, 'base64url').toString())
    const textRequest = decodeMarker(textMarker)
    const imageRequest = decodeMarker(imageMarker)
    expect(textRequest.sessionId).toBe('session')
    expect(readWebRemoteHistoryMedia(messages, { ...textRequest, kind: 'text' }).text).toBe(longText)
    expect(readWebRemoteHistoryMedia(messages, { ...imageRequest, kind: 'media' })).toEqual({ mime: 'image/png', data: image })
    expect(() => readWebRemoteHistoryMedia(messages, { ...imageRequest, messageHash: 'wrong', kind: 'media' })).toThrow('消息已变化')
    expect(() => readWebRemoteHistoryMedia(messages, { ...imageRequest, path: ['bad'], kind: 'media' })).toThrow('图片数据不存在')
    expect(() => readWebRemoteHistoryMedia([], { ...imageRequest, kind: 'media' })).toThrow('无法唯一定位原始消息')
    const noUuidMessages = [{ type: 'assistant', content: 'stable by index and hash' }]
    const noUuidHash = createHash('sha256').update(JSON.stringify(noUuidMessages[0])).digest('hex')
    expect(readWebRemoteHistoryMedia(noUuidMessages, { sessionId: 'session', index: 0, messageHash: noUuidHash, path: ['content'], kind: 'text' }).text).toBe('stable by index and hash')
    expect(() => readWebRemoteHistoryMedia(noUuidMessages, { sessionId: 'session', index: 0, messageHash: noUuidHash, path: ['content'], kind: 'text', hash: 'wrong' })).toThrow('原文校验失败')
    expect(WEB_REMOTE_TEXT_MARKER_PREFIX).toContain('proma-web-remote-text')
  })

  test('keeps serialized page within its history budget after inlining media when multiple turns fit', () => {
    const messages = Array.from({ length: 40 }, (_, index) => [
      { type: 'user', uuid: `u-${index}`, content: [{ type: 'text', text: 'x'.repeat(40 * 1024) }, { type: 'image', source: { media_type: 'image/png', data: Buffer.alloc(200_000, index).toString('base64') } }] },
      { type: 'assistant', uuid: `a-${index}`, content: `answer-${index}` },
    ]).flat()
    const window = selectWebRemoteHistoryWindow(messages, 2 * 1024 * 1024)
    expect(Buffer.byteLength(JSON.stringify(window.messages), 'utf8')).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(window.hasEarlier).toBe(true)
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
