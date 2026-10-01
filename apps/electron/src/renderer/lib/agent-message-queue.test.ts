import { describe, expect, test } from 'bun:test'
import {
  buildQueuedMessageSendPayload,
  getQueuedMessageDisplayParts,
  parseQueuedMessageMentions,
  selectQueuedMessageRecoverySessionIds,
} from './agent-message-queue'

describe('queued message @file mention path decoding (Agent 侧真实路径)', () => {
  test('Web Remote queue recovery selects only active running/queued sessions plus existing queue keys', () => {
    const sessions = [
      { id: 'running-active' },
      { id: 'queued-active' },
      { id: 'idle-active' },
      { id: 'running-archived', archived: true },
      { id: 'running-draft', isDraft: true },
    ]
    const streamStates = new Map([
      ['running-active', { running: true, backgroundWaiting: false }],
      ['running-archived', { running: true, backgroundWaiting: false }],
      ['running-draft', { running: true, backgroundWaiting: false }],
    ])
    const queues = new Map<string, readonly unknown[]>([
      ['queued-active', [{}]],
      ['queued-orphan', [{}]],
    ])
    expect(selectQueuedMessageRecoverySessionIds({ isWebRemote: true, sessions, streamStates, queues })).toEqual([
      'running-active', 'queued-active', 'queued-orphan',
    ])
  })

  test('desktop queue recovery still checks every listed session and existing queue key', () => {
    const sessions = [{ id: 'active' }, { id: 'archived', archived: true }]
    const queues = new Map<string, readonly unknown[]>([['orphan', [{}]]])
    expect(selectQueuedMessageRecoverySessionIds({ isWebRemote: false, sessions, streamStates: new Map(), queues })).toEqual([
      'active', 'archived', 'orphan',
    ])
  })
  test('decodes percent-encoded @file path back to the real path with spaces', () => {
    const text = '请查看 @file:%2FUsers%2Fme%2FMy%20report.pdf 这份报告'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('请查看 @file:/Users/me/My report.pdf 这份报告')
  })

  test('keeps legacy unencoded @file paths unchanged', () => {
    const text = '参考 @file:notes/brief.md 内容'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('参考 @file:notes/brief.md 内容')
  })

  test('decode does not affect skill / mcp / session mentions removal', () => {
    const text = '@file:%2FUsers%2Fme%2FMy%20report.pdf /skill:brainstorming #mcp:playwright &session:session-123'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('@file:/Users/me/My report.pdf')
    expect(result.mentionedSkills).toEqual(['brainstorming'])
    expect(result.mentionedMcpServers).toEqual(['playwright'])
    expect(result.mentionedSessionIds).toEqual(['session-123'])
  })

  test('buildQueuedMessageSendPayload sdkText contains the real (decoded) file path', () => {
    const payload = buildQueuedMessageSendPayload({
      id: 'msg-1',
      text: '看下 @file:%2FUsers%2Fme%2FMy%20report.pdf',
      createdAt: Date.now(),
    })
    expect(payload.sdkText).toContain('@file:/Users/me/My report.pdf')
  })

  test('getQueuedMessageDisplayParts shows the full filename for encoded paths with spaces', () => {
    const parts = getQueuedMessageDisplayParts('看下 @file:%2FUsers%2Fme%2FMy%20report.pdf 这份报告')
    const fileRef = parts.find((p) => p.type === 'reference' && p.referenceType === 'file')
    expect(fileRef).toBeDefined()
    if (fileRef && 'referenceType' in fileRef) {
      // id 保留协议原始值（编码）；label 是展示层解码后的完整文件名
      expect(fileRef.id).toBe('%2FUsers%2Fme%2FMy%20report.pdf')
      expect(fileRef.label).toBe('My report.pdf')
    }
  })

  test('preserves text immediately after a file mention without whitespace', () => {
    const text = '@file:Screenshot%202026-08-24%20at%2014.17.47.png还是做一个单独渲染的内容吧'
    const result = parseQueuedMessageMentions(text)

    expect(result.cleanedText).toBe('@file:Screenshot 2026-08-24 at 14.17.47.png还是做一个单独渲染的内容吧')
    expect(getQueuedMessageDisplayParts(text)).toEqual([
      {
        type: 'reference',
        referenceType: 'file',
        id: 'Screenshot%202026-08-24%20at%2014.17.47.png',
        label: 'Screenshot 2026-08-24 at 14.17.47.png',
      },
      { type: 'text', value: '还是做一个单独渲染的内容吧' },
    ])
  })

  test('parses and renders a CJK MCP server name', () => {
    const text = '#mcp:中文服务器 后续处理'
    const result = parseQueuedMessageMentions(text)

    expect(result.mentionedMcpServers).toEqual(['中文服务器'])
    expect(result.cleanedText).toBe('后续处理')
    expect(getQueuedMessageDisplayParts(text)).toEqual([
      {
        type: 'reference',
        referenceType: 'mcp',
        id: '中文服务器',
        label: '中文服务器',
      },
      { type: 'text', value: ' 后续处理' },
    ])
  })
})
