/**
 * Bridge 日志脱敏工具。
 *
 * 外部 SDK 的错误、响应和回调载荷可能回显凭证；写入日志前必须经过这里。
 */

const REDACTED = '[REDACTED]'
const SENSITIVE_KEY_SOURCE = 'api[-_]?key|client[-_]?secret|app[-_]?secret|(?:access|refresh)[-_]?token|authorization|authentication|credential|password|session[-_]?webhook|webhook|download[-_]?code|[a-z0-9_-]*token'
const SENSITIVE_KEY_PATTERN = new RegExp(`(?:${SENSITIVE_KEY_SOURCE})`, 'i')
const SENSITIVE_KEY_VALUE_PATTERN = new RegExp(
  `((?:["']?(?:${SENSITIVE_KEY_SOURCE})["']?)\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^,\\s}\\]]+)`,
  'gi',
)
const SENSITIVE_QUERY_PATTERN = new RegExp(
  `([?&](?:${SENSITIVE_KEY_SOURCE})=)[^&#\\s]+`,
  'gi',
)
const AUTHORIZATION_VALUE_PATTERN = /((?:authorization|authentication)\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/gi

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

/** 脱敏自由文本中的键值、Authorization header 和 URL query 参数。 */
export function redactSensitiveLogText(text: string): string {
  return text
    .replace(AUTHORIZATION_VALUE_PATTERN, `$1${REDACTED}`)
    .replace(SENSITIVE_KEY_VALUE_PATTERN, `$1${REDACTED}`)
    .replace(SENSITIVE_QUERY_PATTERN, `$1${REDACTED}`)
}

/**
 * 递归脱敏准备输出到 Bridge 日志的值。
 * 仅删除秘密字段，保留 bot ID、client ID、HTTP 状态等排障信息。
 */
export function redactSensitiveLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactSensitiveLogText(value)
  if (value === null || typeof value !== 'object') return value

  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveLogText(value.message),
      stack: value.stack ? redactSensitiveLogText(value.stack) : undefined,
      cause: redactSensitiveLogValue(value.cause, seen),
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveLogValue(item, seen))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactSensitiveLogValue(item, seen),
    ]),
  )
}

/**
 * 把飞书 / axios 风格的错误压缩成一行可持久化的摘要（HTTP 状态、飞书 code/msg、错误消息）。
 * main.log 只持久化消息字符串，不包含附带的错误对象，因此诊断信息必须拼进消息本身。
 */
export function summarizeBridgeError(error: unknown): string {
  if (error === null || error === undefined) return 'unknown error'
  if (typeof error !== 'object') return redactSensitiveLogText(String(error)).slice(0, 300)
  const e = error as {
    message?: unknown
    code?: unknown
    response?: { status?: unknown; data?: { code?: unknown; msg?: unknown; message?: unknown } }
  }
  const parts: string[] = []
  const status = e.response?.status
  if (typeof status === 'number') parts.push(`status=${status}`)
  const data = e.response?.data
  if (data && typeof data === 'object') {
    if (data.code !== undefined) parts.push(`code=${String(data.code)}`)
    const msg = data.msg ?? data.message
    if (typeof msg === 'string' && msg) parts.push(`msg=${msg}`)
  }
  if (!parts.some((part) => part.startsWith('code=')) && (typeof e.code === 'string' || typeof e.code === 'number')) parts.push(`code=${String(e.code)}`)
  if (typeof e.message === 'string' && e.message) parts.push(`message=${e.message}`)
  return redactSensitiveLogText(parts.join(' ') || 'unknown error').slice(0, 300)
}

