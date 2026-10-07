import { describe, expect, test } from 'bun:test'
import { configureBrowserFileInput, loadWebRemoteLargeImage, reassembleTextChunks, resolveWebRemoteImageResult, verifySentAgentMessage } from './web-electron-shim'

describe('Web Remote attachment picker', () => {
  test('keeps multiple and accept while omitting capture', () => {
    const attributes = new Map<string, string>()
    const input = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    } as unknown as HTMLInputElement
    configureBrowserFileInput(input)
    expect(input.type).toBe('file')
    expect(input.multiple).toBe(true)
    expect(input.accept).toBe('image/*,video/*,audio/*,.pdf,.txt,.md,.json,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip')
    expect(attributes.has('capture')).toBe(false)
  })
})

describe('Web Remote local image resolution', () => {
  test('returns a large-image placeholder then reads and caches the original with a 50 MiB limit', async () => {
    let initialReads = 0
    let originalReads = 0
    const access = { sessionId: 'large-authorized-session' }
    const result = { url: 'proma-file://large', resolvedPath: '/authorized/large-original.png' }
    const placeholder = await resolveWebRemoteImageResult(result, access, async (_path, _access, maxSize) => {
      initialReads += 1
      expect(maxSize).toBe(8 * 1024 * 1024)
      return null
    })
    expect(initialReads).toBe(1)
    expect(placeholder?.url).toContain('#proma-web-remote-large-image=')
    expect(decodeURIComponent(placeholder!.url.split(',')[1]!.split('#')[0]!)).toContain('图片较大，点按加载原图')
    const id = /proma-web-remote-large-image=(\d+)$/.exec(placeholder!.url)![1]!
    const readOriginal = async (path: string, passedAccess: unknown, maxSize: number) => {
      originalReads += 1
      expect(path).toBe(result.resolvedPath)
      expect(passedAccess).toBe(access)
      expect(maxSize).toBe(50 * 1024 * 1024)
      return 'aW1hZ2U='
    }
    expect(await loadWebRemoteLargeImage(id, readOriginal)).toBe('data:image/png;base64,aW1hZ2U=')
    expect(await loadWebRemoteLargeImage(id, readOriginal)).toBe('data:image/png;base64,aW1hZ2U=')
    expect(originalReads).toBe(1)
  })

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
    })).toMatchObject({ resolvedPath: '/authorized/large.webp' })
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
