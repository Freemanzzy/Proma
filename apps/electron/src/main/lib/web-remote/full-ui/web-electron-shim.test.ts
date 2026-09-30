import { describe, expect, test } from 'bun:test'
import { reassembleTextChunks, verifySentAgentMessage } from './web-electron-shim'

describe('mobile send acknowledgement fallback', () => {
  test('reassembles text chunks containing CJK and emoji exactly', () => {
    const source = '中文边界🙂🚀'
    expect(reassembleTextChunks(['中文', '边界', '🙂', '🚀'])).toBe(source)
  })
  test('finds the submitted text in a recent user message', async () => {
    const text = '用户发送的内容'.repeat(30)
    const result = await verifySentAgentMessage(text, async () => [
      { role: 'assistant', content: text },
      { role: 'user', content: [{ type: 'text', text: `prefix ${text}` }] },
    ])
    expect(result).toBe('found')
  })

  test('reports missing text when recent user messages do not contain it', async () => {
    const result = await verifySentAgentMessage('本次发送内容', async () => [
      { role: 'user', content: '之前的消息' },
    ])
    expect(result).toBe('not-found')
  })

  test('distinguishes history verification failure', async () => {
    const result = await verifySentAgentMessage('本次发送内容', async () => { throw new Error('offline') })
    expect(result).toBe('check-failed')
  })
})
