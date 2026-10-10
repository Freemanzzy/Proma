import { afterEach, describe, expect, test, mock } from 'bun:test'
import { fetchTitle } from './sse-reader'

const fakeFetch = (impl: () => Promise<Response>): typeof fetch => impl as unknown as typeof fetch

const request = {
  url: 'https://example.invalid/title?token=secret-query',
  headers: { authorization: 'Bearer secret-key' },
  body: 'prompt',
} as Parameters<typeof fetchTitle>[0]
const adapter = {
  providerType: 'openai',
  parseTitleResponse: () => '标题',
} as unknown as Parameters<typeof fetchTitle>[1]

afterEach(() => mock.restore())

describe('fetchTitle failure logging', () => {
  test('HTTP 错误日志是一行，含状态与限长正文且不打印请求凭据', async () => {
    const warn = mock((..._args: unknown[]) => {})
    const originalWarn = console.warn
    console.warn = warn
    try {
      const title = await fetchTitle(request, adapter, fakeFetch(async () => new Response('bad\nrequest', { status: 503 })))
      expect(title).toBeNull()
      const line = String(warn.mock.calls[0]?.[0])
      expect(line).toContain('status=503')
      expect(line).toContain('error=bad request')
      expect(line).not.toContain('secret-key')
      expect(line).not.toContain('secret-query')
      expect(line.split('\n')).toHaveLength(1)
    } finally {
      console.warn = originalWarn
    }
  })

  test('400 错误标记为不可重试，429 与 5xx 可重试', async () => {
    for (const [status, retryable] of [[400, false], [429, true], [503, true]] as const) {
      let failure: { kind: string; status?: number; retryable: boolean } | undefined
      await fetchTitle(request, adapter, fakeFetch(async () => new Response('bad', { status })), (value) => {
        failure = value
      })
      expect(failure).toEqual({ kind: 'http', status, retryable })
    }
  })

  test('收到响应后的 JSON 解析失败不标记为可重试网络错误', async () => {
    let failure: { kind: string; retryable: boolean } | undefined
    await fetchTitle(request, adapter, fakeFetch(async () => new Response('not-json', { status: 200 })), (value) => {
      failure = value
    })
    expect(failure).toEqual({ kind: 'response', retryable: false })
  })

  test('异常日志写出 name/message 且不含查询串和请求头', async () => {
    const error = new TypeError('network\ntimeout')
    const errorLog = mock((..._args: unknown[]) => {})
    const originalError = console.error
    console.error = errorLog
    try {
      const title = await fetchTitle(request, adapter, fakeFetch(async () => { throw error }))
      expect(title).toBeNull()
      const line = String(errorLog.mock.calls[0]?.[0])
      expect(line).toContain('TypeError: network timeout')
      expect(line).not.toContain('secret-key')
      expect(line).not.toContain('secret-query')
    } finally {
      console.error = originalError
    }
  })
})
