import { afterEach, describe, expect, test, mock } from 'bun:test'
import { fetchAgentTitleWithFallback } from './agent-title-retry'

afterEach(() => mock.restore())

describe('fetchAgentTitleWithFallback', () => {
  test('失败后重试并返回成功标题', async () => {
    let calls = 0
    const delay = mock(async () => {})
    const result = await fetchAgentTitleWithFallback(
      async () => (++calls === 1 ? null : '语义标题'),
      () => '本地标题',
      undefined,
      delay,
    )
    expect(result).toBe('语义标题')
    expect(calls).toBe(2)
    expect(delay).toHaveBeenCalledWith(2_000, undefined)
  })

  test('两次失败后返回本地兜底', async () => {
    let calls = 0
    const fallback = mock(() => '本地标题')
    const result = await fetchAgentTitleWithFallback(
      async () => { calls += 1; return null },
      fallback,
      undefined,
      async () => {},
    )
    expect(result).toBe('本地标题')
    expect(calls).toBe(2)
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  test('abort 时不重试且不兜底', async () => {
    const controller = new AbortController()
    let calls = 0
    const fallback = mock(() => '本地标题')
    const result = await fetchAgentTitleWithFallback(
      async () => { calls += 1; controller.abort(); return null },
      fallback,
      controller.signal,
      async () => {},
    )
    expect(result).toBeNull()
    expect(calls).toBe(1)
    expect(fallback).not.toHaveBeenCalled()
  })

  test('自定义渠道既有本地标题行为保持不变', async () => {
    const result = await fetchAgentTitleWithFallback(
      async () => null,
      () => '自定义渠道的本地标题',
      undefined,
      async () => {},
    )
    expect(result).toBe('自定义渠道的本地标题')
  })
})
