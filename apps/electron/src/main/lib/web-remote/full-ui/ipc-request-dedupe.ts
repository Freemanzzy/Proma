/**
 * 合并相同 key 的只读请求：并发请求共用一次；ttlMs > 0 时成功结果在 ttlMs 内继续复用（失败立即清除）。
 * 手机弱网下渲染进程会在启动与交互中连续多次拉取会话列表，短缓存避免重复下载。
 */
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
