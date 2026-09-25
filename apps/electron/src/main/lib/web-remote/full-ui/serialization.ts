const TYPE_KEY = '__proma_web_remote_type'

export type SerializedValue = unknown

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

/** JSON-safe transport codec used by both invoke arguments and pushed events. */
export function encodeWebRemoteValue(value: unknown, seen = new WeakSet<object>()): SerializedValue {
  if (value === undefined) return { [TYPE_KEY]: 'undefined' }
  if (value instanceof Date) return { [TYPE_KEY]: 'date', value: value.toISOString() }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return { [TYPE_KEY]: 'bytes', value: bytesToBase64(value) }
  }
  if (value instanceof Uint8Array) return { [TYPE_KEY]: 'bytes', value: bytesToBase64(value) }
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return { [TYPE_KEY]: 'bytes', value: bytesToBase64(new Uint8Array(value)) }
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error(`无法序列化 ${typeof value}`)
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) throw new Error('无法序列化循环引用')
    seen.add(value)
    try {
      if (Array.isArray(value)) return value.map((item) => encodeWebRemoteValue(item, seen))
      const output: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value)) output[key] = encodeWebRemoteValue(item, seen)
      return output
    } finally {
      seen.delete(value)
    }
  }
  return value
}

export function decodeWebRemoteValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeWebRemoteValue)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record[TYPE_KEY] === 'undefined') return undefined
  if (record[TYPE_KEY] === 'date' && typeof record.value === 'string') return new Date(record.value)
  if (record[TYPE_KEY] === 'bytes' && typeof record.value === 'string') {
    const bytes = base64ToBytes(record.value)
    return typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes
  }
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) output[key] = decodeWebRemoteValue(item)
  return output
}

export function encodeWebRemoteJson(value: unknown): string {
  return JSON.stringify(encodeWebRemoteValue(value))
}
