import { describe, expect, test } from 'bun:test'
import { coalesceRequest, coalesceSessionListRead, invalidateSessionListReadCache } from './ipc-request-dedupe'

describe('coalesceRequest', () => {
  test('合并相同 key 的并发只读请求，并在完成后允许重拉', async () => {
    const pending = new Map<string, Promise<number>>()
    let calls = 0
    let resolveRequest!: (value: number) => void
    const request = () => { calls++; return new Promise<number>((resolve) => { resolveRequest = resolve }) }
    const first = coalesceRequest(pending, 'agent:list-sessions[]', request)
    const second = coalesceRequest(pending, 'agent:list-sessions[]', request)
    expect(calls).toBe(1)
    resolveRequest(7)
    await expect(Promise.all([first, second])).resolves.toEqual([7, 7])
    expect(pending.size).toBe(0)
    const again = coalesceRequest(pending, 'agent:list-sessions[]', () => Promise.resolve(++calls))
    await expect(again).resolves.toBe(2)
  })

  test('合并 active 列表五个并发请求、3秒复用，并在 metadata 更新后失效', async () => {
    const pending = new Map<string, Promise<number>>()
    const timers: Array<() => void> = []
    const schedule = (fn: () => void) => { timers.push(fn) }
    let calls = 0
    let resolveActive!: (value: number) => void
    const activeRequest = () => { calls++; return new Promise<number>((resolve) => { resolveActive = resolve }) }
    const concurrent = Array.from({ length: 5 }, () => coalesceSessionListRead(pending, 'agent:list-active-sessions', [], activeRequest, 3_000, schedule))
    expect(calls).toBe(1)
    resolveActive(105)
    await expect(Promise.all(concurrent)).resolves.toEqual([105, 105, 105, 105, 105])
    await expect(coalesceSessionListRead(pending, 'agent:list-active-sessions', [], async () => ++calls, 3_000, schedule)).resolves.toBe(105)
    expect(calls).toBe(1)

    invalidateSessionListReadCache(pending) // agent:session-metadata-changed invalidates session-list snapshots
    await expect(coalesceSessionListRead(pending, 'agent:list-active-sessions', [], async () => ++calls, 3_000, schedule)).resolves.toBe(2)
    await expect(coalesceSessionListRead(pending, 'agent:count-archived-sessions', [], async () => ++calls, 3_000, schedule)).resolves.toBe(3)
    await expect(coalesceSessionListRead(pending, 'agent:count-archived-sessions', [], async () => ++calls, 3_000, schedule)).resolves.toBe(3)
    expect(calls).toBe(3)
    invalidateSessionListReadCache(pending)
    await expect(coalesceSessionListRead(pending, 'agent:count-archived-sessions', [], async () => ++calls, 3_000, schedule)).resolves.toBe(4)
    expect(timers.length).toBeGreaterThan(0)
  })

  test('ttl 内串行请求复用成功结果，过期后重拉；失败不缓存', async () => {
    const pending = new Map<string, Promise<number>>()
    let calls = 0
    const timers: Array<() => void> = []
    const schedule = (fn: () => void) => { timers.push(fn) }
    await expect(coalesceRequest(pending, 'k', () => Promise.resolve(++calls), 3000, schedule)).resolves.toBe(1)
    await expect(coalesceRequest(pending, 'k', () => Promise.resolve(++calls), 3000, schedule)).resolves.toBe(1)
    expect(calls).toBe(1)
    timers.splice(0).forEach((fn) => fn())
    await expect(coalesceRequest(pending, 'k', () => Promise.resolve(++calls), 3000, schedule)).resolves.toBe(2)
    await expect(coalesceRequest(pending, 'e', () => Promise.reject(new Error('x')), 3000, schedule)).rejects.toThrow('x')
    expect(pending.has('e')).toBe(false)
  })
})
