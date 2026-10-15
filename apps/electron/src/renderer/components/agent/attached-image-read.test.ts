import { describe, expect, test } from 'bun:test'
import { readAttachedImageBase64 } from './attached-image-read'

describe('图片附件读取通道选择', () => {
  test('桌面保留原 readAttachment IPC，即使 sessionId 为空', async () => {
    const calls: string[] = []
    const api = {
      readAttachment: async (path: string) => { calls.push(`attachment:${path}`); return 'desktop-base64' },
      readBinaryBase64: async (path: string) => { calls.push(`binary:${path}`); return null },
    }
    const value = await readAttachedImageBase64(api as never, '/attachments/picture.png', null, false)
    expect(value).toBe('desktop-base64')
    expect(calls).toEqual(['attachment:/attachments/picture.png'])
  })

  test('Web Remote 使用 session-scoped binary IPC', async () => {
    const calls: unknown[][] = []
    const api = {
      readAttachment: async (path: string) => { calls.push(['attachment', path]); return 'desktop-base64' },
      readBinaryBase64: async (...args: unknown[]) => { calls.push(['binary', ...args]); return 'remote-base64' },
    }
    const value = await readAttachedImageBase64(api as never, '/workspace/picture.png', 'session-1', true)
    expect(value).toBe('remote-base64')
    expect(calls).toEqual([['binary', '/workspace/picture.png', { sessionId: 'session-1' }]])
  })

  test('Web Remote null response remains a failed read instead of a data URI', async () => {
    const api = {
      readAttachment: async () => 'desktop-base64',
      readBinaryBase64: async () => null,
    }
    expect(await readAttachedImageBase64(api as never, '/workspace/missing.png', 'session-1', true)).toBeNull()
  })
})
