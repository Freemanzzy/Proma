export function coalesceRequest<T>(inFlight: Map<string, Promise<T>>, key: string, request: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing
  const pending = request().finally(() => inFlight.delete(key))
  inFlight.set(key, pending)
  return pending
}
