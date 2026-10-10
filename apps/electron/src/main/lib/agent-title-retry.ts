/** Retry a failed semantic title request once, then use a deterministic local title. */
export async function fetchAgentTitleWithFallback(
  fetch: () => Promise<string | null>,
  fallback: () => string | null,
  signal?: AbortSignal,
  delay: (ms: number, signal?: AbortSignal) => Promise<void> = abortableDelay,
  canRetry: () => boolean = () => true,
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) return null
    try {
      const title = await fetch()
      if (title) return title
    } catch {
      if (signal?.aborted) return null
    }
    if (signal?.aborted) return null
    if (!canRetry()) break
    if (attempt === 0) {
      try {
        await delay(2_000, signal)
      } catch {
        if (signal?.aborted) return null
      }
      if (signal?.aborted) return null
    }
  }
  if (signal?.aborted) return null
  console.warn('[Agent 标题生成] API 未返回可用标题，使用本地兜底')
  return fallback()
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  if (signal.aborted) return Promise.reject(new Error('Aborted'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(new Error('Aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
