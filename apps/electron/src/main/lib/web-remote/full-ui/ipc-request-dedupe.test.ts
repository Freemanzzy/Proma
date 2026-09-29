import { describe, expect, test } from 'bun:test'
import { coalesceRequest } from './ipc-request-dedupe'

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
