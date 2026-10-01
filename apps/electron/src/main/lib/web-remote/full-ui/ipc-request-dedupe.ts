/**
 * 合并相同 key 的只读请求：并发请求共用一次；ttlMs > 0 时成功结果在 ttlMs 内继续复用（失败立即清除）。
 * 手机弱网下渲染进程会在启动与交互中连续多次拉取会话列表，短缓存避免重复下载。
 */
export const WEB_REMOTE_SESSION_LIST_READ_CHANNELS = new Set([
  'agent:list-sessions',
  'agent:list-active-sessions',
  'agent:list-archived-sessions',
  'agent:count-archived-sessions',
])

export function coalesceSessionListRead<T>(
  inFlight: Map<string, Promise<T>>,
  channel: string,
  args: unknown[],
  request: () => Promise<T>,
  ttlMs = 3_000,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
): Promise<T> {
  if (!WEB_REMOTE_SESSION_LIST_READ_CHANNELS.has(channel)) return request()
  return coalesceRequest(inFlight, JSON.stringify([channel, args]), request, ttlMs, schedule)
}

export function invalidateSessionListReadCache(inFlight: Map<string, Promise<unknown>>): void {
  for (const key of inFlight.keys()) {
    try {
      const parsed = JSON.parse(key) as unknown
      if (Array.isArray(parsed) && typeof parsed[0] === 'string' && WEB_REMOTE_SESSION_LIST_READ_CHANNELS.has(parsed[0])) {
        inFlight.delete(key)
      }
    } catch {}
  }
}

export function coalesceRequest<T>(inFlight: Map<string, Promise<T>>, key: string, request: () => Promise<T>, ttlMs = 0, schedule: (fn: () => void, ms: number) => unknown = setTimeout): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing
  const pending = request().then(
    (value) => { if (ttlMs > 0) schedule(() => { if (inFlight.get(key) === pending) inFlight.delete(key) }, ttlMs); else inFlight.delete(key); return value },
    (error) => { if (inFlight.get(key) === pending) inFlight.delete(key); throw error },
  )
  inFlight.set(key, pending)
  return pending
}
