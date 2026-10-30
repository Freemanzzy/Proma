import { createHash } from 'node:crypto'
import type { ImageContent, ModelImageResizeOptions } from '@earendil-works/pi-ai'

export const PROMA_READ_IMAGE_RESIZE: ModelImageResizeOptions = {
  maxWidth: 1568,
  maxHeight: 1568,
  maxBytes: 600 * 1024,
  jpegQuality: 80,
}

const RECOMPRESS_THRESHOLD = 1024 * 1024
const DEFAULT_HIGH = 8 * 1024 * 1024
const DEFAULT_LOW = 4 * 1024 * 1024
const DEFAULT_HIGH_COUNT = 20
const DEFAULT_LOW_COUNT = 12
const CACHE_MAX_ENTRIES = 64
const CACHE_MAX_BYTES = 64 * 1024 * 1024

type TextBlock = { type: 'text'; text: string; [key: string]: unknown }
type ImageBlock = ImageContent & { [key: string]: unknown }
type Block = TextBlock | ImageBlock | { type: string; [key: string]: unknown }
type PiMessage = { role?: unknown; content?: unknown; toolCallId?: unknown }
type Resize = (bytes: Uint8Array, mimeType: string, options?: ModelImageResizeOptions) => Promise<{ data: string; mimeType: string } | null>

export interface ImageBudgetStats {
  imagesBefore: number
  imageBytesBefore: number
  imagesAfter: number
  imageBytesAfter: number
  recompressed: number
  newlyRemoved: number
  removedTotal: number
  overBudgetProtected: boolean
  recompressFailed: number
}

export interface ImageBudgetResult<T extends PiMessage> {
  messages: T[]
  stats: ImageBudgetStats
}

const resizeCache = new Map<string, { value: { data: string; mimeType: string } | null; bytes: number }>()
let resizeCacheBytes = 0

function base64Bytes(data: string): number {
  return Buffer.byteLength(data, 'utf8')
}

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function getLimits() {
  const high = readLimit('PROMA_IMAGE_BUDGET_HIGH_BYTES', DEFAULT_HIGH)
  const low = Math.min(readLimit('PROMA_IMAGE_BUDGET_LOW_BYTES', DEFAULT_LOW), high)
  const highCount = readLimit('PROMA_IMAGE_BUDGET_HIGH_COUNT', DEFAULT_HIGH_COUNT)
  const lowCount = Math.min(readLimit('PROMA_IMAGE_BUDGET_LOW_COUNT', DEFAULT_LOW_COUNT), highCount)
  return { high, low, highCount, lowCount }
}

function imageBlocks(messages: PiMessage[]) {
  const result: Array<{ messageIndex: number; blockIndex: number; image: ImageBlock; key: string }> = []
  messages.forEach((message, messageIndex) => {
    if ((message.role !== 'user' && message.role !== 'toolResult') || !Array.isArray(message.content)) return
    message.content.forEach((block, blockIndex) => {
      if (block && typeof block === 'object' && (block as Block).type === 'image') {
        result.push({ messageIndex, blockIndex, image: block as ImageBlock, key: `${messageIndex}:${blockIndex}` })
      }
    })
  })
  return result
}

function findReadPath(messages: PiMessage[], toolCallId: unknown): string {
  if (typeof toolCallId !== 'string') return '原图片'
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content as Block[]) {
      if (block.type !== 'toolCall' || block.id !== toolCallId) continue
      const args = block.arguments as Record<string, unknown> | undefined
      if (typeof args?.path === 'string') return args.path
    }
  }
  return '原图片'
}

function cacheKey(image: ImageBlock): string {
  return createHash('sha256').update(image.mimeType).update('\0').update(image.data).digest('hex')
}

function getCached(key: string) {
  const entry = resizeCache.get(key)
  if (!entry) return undefined
  resizeCache.delete(key)
  resizeCache.set(key, entry)
  return entry.value
}

function setCached(key: string, value: { data: string; mimeType: string } | null) {
  const bytes = value?.data.length ?? 0
  const old = resizeCache.get(key)
  if (old) resizeCacheBytes -= old.bytes
  resizeCache.delete(key)
  if (bytes > CACHE_MAX_BYTES) return
  resizeCache.set(key, { value, bytes })
  resizeCacheBytes += bytes
  while (resizeCache.size > CACHE_MAX_ENTRIES || resizeCacheBytes > CACHE_MAX_BYTES) {
    const oldest = resizeCache.keys().next().value as string | undefined
    if (!oldest) break
    resizeCacheBytes -= resizeCache.get(oldest)?.bytes ?? 0
    resizeCache.delete(oldest)
  }
}

export function clearImageResizeCacheForTests(): void {
  resizeCache.clear()
  resizeCacheBytes = 0
}

export function createImageContextBudget() {
  const removed = new Set<string>()
  return async function applyImageContextBudget<T extends PiMessage>(
    messages: T[],
    resizeImage: Resize,
  ): Promise<ImageBudgetResult<T>> {
    const before = imageBlocks(messages)
    const stats: ImageBudgetStats = {
      imagesBefore: before.length,
      imageBytesBefore: before.reduce((n, item) => n + base64Bytes(item.image.data), 0),
      imagesAfter: before.length,
      imageBytesAfter: before.reduce((n, item) => n + base64Bytes(item.image.data), 0),
      recompressed: 0,
      newlyRemoved: 0,
      removedTotal: removed.size,
      overBudgetProtected: false,
      recompressFailed: 0,
    }
    if (!before.length) return { messages, stats }

    let output = messages
    const replacements = new Map<string, Block>()
    for (const item of before) {
      if (removed.has(item.key) || typeof item.image.data !== 'string' || base64Bytes(item.image.data) <= RECOMPRESS_THRESHOLD) continue
      const key = cacheKey(item.image)
      let resized = getCached(key)
      if (resized === undefined) {
        try {
          resized = await resizeImage(Buffer.from(item.image.data, 'base64'), item.image.mimeType, PROMA_READ_IMAGE_RESIZE)
          setCached(key, resized)
        } catch {
          resized = null
          setCached(key, null)
        }
      }
      if (!resized) {
        stats.recompressFailed++
        continue
      }
      const data = resized.data
      if (data !== item.image.data || resized.mimeType !== item.image.mimeType) {
        replacements.set(item.key, { ...item.image, data, mimeType: resized.mimeType })
        stats.recompressed++
      }
    }
    if (replacements.size) output = replaceBlocks(output, replacements)

    const entries = imageBlocks(output)
    for (const entry of entries) {
      if (!removed.has(entry.key)) continue
      replacements.set(entry.key, {
        type: 'text',
        text: `[图片已移出上下文以控制请求体积：${findReadPath(output, output[entry.messageIndex]?.toolCallId)}。如需再次查看请重新 Read 该文件。]`,
      })
    }
    const sizes = new Map(entries.map((entry) => [entry.key, base64Bytes(entry.image.data)]))
    const { high, low, highCount, lowCount } = getLimits()
    let currentBytes = entries.reduce((sum, entry) => sum + (removed.has(entry.key) ? 0 : (sizes.get(entry.key) ?? 0)), 0)
    let currentCount = entries.filter((entry) => !removed.has(entry.key)).length
    if (currentBytes > high || currentCount > highCount) {
      const lastUserText = output.reduce((last, message, index) => message.role === 'user'
        && Array.isArray(message.content)
        && message.content.some((block) => (block as Block).type === 'text' && Boolean((block as TextBlock).text.trim()))
        ? index : last, -1)
      const removable = entries.filter((entry) => !removed.has(entry.key) && entry.messageIndex < lastUserText)
      for (const entry of removable) {
        if (currentBytes <= low && currentCount <= lowCount) break
        const imagePath = entry.image.type === 'image' ? findReadPath(output, output[entry.messageIndex]?.toolCallId) : '原图片'
        replacements.set(entry.key, {
          type: 'text',
          text: `[图片已移出上下文以控制请求体积：${imagePath}。如需再次查看请重新 Read 该文件。]`,
        })
        removed.add(entry.key)
        stats.newlyRemoved++
        currentBytes -= sizes.get(entry.key) ?? 0
        currentCount--
      }
      stats.overBudgetProtected = currentBytes > high || currentCount > highCount
    }
    if (replacements.size) output = replaceBlocks(output, replacements)
    stats.removedTotal = removed.size
    const after = imageBlocks(output)
    stats.imagesAfter = after.length
    stats.imageBytesAfter = after.reduce((sum, entry) => sum + base64Bytes(entry.image.data), 0)
    return { messages: output, stats }
  }
}

function replaceBlocks<T extends PiMessage>(messages: T[], replacements: Map<string, Block>): T[] {
  let changed = false
  const output = messages.map((message, messageIndex) => {
    if (!Array.isArray(message.content)) return message
    let contentChanged = false
    const content = (message.content as Block[]).map((block, blockIndex) => {
      const replacement = replacements.get(`${messageIndex}:${blockIndex}`)
      if (!replacement) return block
      contentChanged = true
      return replacement
    })
    if (!contentChanged) return message
    changed = true
    return { ...message, content } as T
  })
  return changed ? output : messages
}
