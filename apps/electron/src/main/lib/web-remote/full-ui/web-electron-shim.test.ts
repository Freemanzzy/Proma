import { describe, expect, test } from 'bun:test'
import { reassembleTextChunks, resolveWebRemoteImageResult, verifySentAgentMessage } from './web-electron-shim'

describe('Web Remote local image resolution', () => {
  test('returns a data URL and reads each image path once', async () => {
    let reads = 0
    const access = { sessionId: 'authorized-session' }
    const result = { url: 'proma-file://asset', resolvedPath: '/authorized/image.png' }
    const readBinary = async (_path: string, passedAccess: unknown, maxSize: number): Promise<unknown> => {
      reads += 1
      expect(passedAccess).toBe(access)
      expect(maxSize).toBe(8 * 1024 * 1024)
      return 'aGVsbG8='
    }

    expect(await resolveWebRemoteImageResult(result, access, readBinary)).toEqual({
      ...result,
      url: 'data:image/png;base64,aGVsbG8=',
    })
    expect(await resolveWebRemoteImageResult(result, access, readBinary)).toEqual({
      ...result,
      url: 'data:image/png;base64,aGVsbG8=',
    })
    expect(reads).toBe(1)
  })

  test('leaves non-images unchanged and returns null when the authorized read exceeds the limit', async () => {
    const pdf = { url: 'proma-file://doc', resolvedPath: '/authorized/doc.pdf' }
    expect(await resolveWebRemoteImageResult(pdf, undefined, async () => { throw new Error('must not read') })).toBe(pdf)
    const tooLarge = { url: 'proma-file://large', resolvedPath: '/authorized/large.webp' }
    expect(await resolveWebRemoteImageResult(tooLarge, undefined, async (_path, _access, maxSize) => {
      expect(maxSize).toBe(8 * 1024 * 1024)
      return null
    })).toBeNull()
  })
})

describe('mobile send acknowledgement fallback', () => {
  test('reassembles text chunks containing CJK and emoji exactly', () => {
    const source = '中文边界🙂🚀'
    expect(reassembleTextChunks(['中文', '边界', '🙂', '🚀'])).toBe(source)
  })
  test('finds the submitted text in a recent user message', async () => {
    const text = '用户发送的内容'.repeat(30)
    const result = await verifySentAgentMessage(text, async () => [
      { type: 'assistant', message: { role: 'assistant', content: text } },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: `prefix ${text}` }] } },
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
