import { describe, expect, test } from 'bun:test'
import { cleanUserMessageForTitle, createFallbackTitle } from './title-generation'

describe('title generation reference cleanup', () => {
  test('replaces encoded session labels before deriving a fallback title', () => {
    const message = `&session:07d56e0a-c2::${encodeURIComponent('对话卡顿原因排查')}  又一次对话卡主了。`

    const cleaned = cleanUserMessageForTitle(message)
    const title = createFallbackTitle(message)

    expect(cleaned).toBe('对话卡顿原因排查 又一次对话卡主了。')
    expect(title).toContain('对话卡顿原因排查')
    expect(title).not.toContain('&session')
    expect(title).not.toContain('07d56e0a')
    expect(title).not.toContain('%E5')
  })

  test('replaces file references with a decoded basename', () => {
    expect(cleanUserMessageForTitle('请看 @file:%2Ftmp%2FMy%20report.pdf 的内容'))
      .toBe('请看 My report.pdf 的内容')
  })

  test('drops bare references and returns null when no human-readable message remains', () => {
    expect(cleanUserMessageForTitle('&session:session-123')).toBe('')
    expect(createFallbackTitle('&session:session-123')).toBeNull()
  })

  test('removes raw Skill and MCP identifiers while retaining surrounding text', () => {
    expect(cleanUserMessageForTitle('先用 /skill:brainstorming #mcp:browser 继续'))
      .toBe('先用 继续')
  })
})
