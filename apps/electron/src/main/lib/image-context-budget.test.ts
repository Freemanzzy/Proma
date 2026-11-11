import { afterEach, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { resizeImage as piResizeImage } from '@earendil-works/pi-coding-agent'
import { classifyProviderErrorKind, clearImageResizeCacheForTests, createImageContextBudget, createSdkImageResizer, detectImageMimeType } from './image-context-budget'

type M = { role: string; content: Array<Record<string, unknown>>; toolCallId?: string; timestamp?: number }
const image = (length: number, fill = 'a') => ({ type: 'image', mimeType: 'image/png', data: fill.repeat(length) })
const JPEG_STUB = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])
const resize = async (_bytes: Uint8Array, _mimeType: string) => ({ data: JPEG_STUB.toString('base64'), mimeType: 'image/jpeg' })
const setBudgetEnv = (high: string, low: string, highCount = '20', lowCount = '12') => {
  process.env.PROMA_IMAGE_BUDGET_HIGH_BYTES = high
  process.env.PROMA_IMAGE_BUDGET_LOW_BYTES = low
  process.env.PROMA_IMAGE_BUDGET_HIGH_COUNT = highCount
  process.env.PROMA_IMAGE_BUDGET_LOW_COUNT = lowCount
}

afterEach(() => {
  for (const key of ['PROMA_IMAGE_BUDGET_HIGH_BYTES', 'PROMA_IMAGE_BUDGET_LOW_BYTES', 'PROMA_IMAGE_BUDGET_HIGH_COUNT', 'PROMA_IMAGE_BUDGET_LOW_COUNT']) delete process.env[key]
  clearImageResizeCacheForTests()
})

describe('image context budget', () => {
  test('returns original reference when within budget', async () => {
    const messages: M[] = [{ role: 'user', content: [{ type: 'text', text: 'look' }, image(12)] }]
    const result = await createImageContextBudget()(messages, resize)
    expect(result.messages).toBe(messages)
    expect(result.stats.imagesAfter).toBe(1)
  })

  test('recompresses large history images and caches repeated resize', async () => {
    let calls = 0
    const budget = createImageContextBudget()
    const doResize = async (...args: Parameters<typeof resize>) => { calls++; return resize(...args) }
    const messages: M[] = [{ role: 'user', content: [image(1_100_000)] }, { role: 'user', content: [{ type: 'text', text: 'current' }] }]
    const first = await budget(messages, doResize)
    const second = await budget(messages, doResize)
    expect(first.stats.recompressed).toBe(1)
    expect(second.stats.recompressed).toBe(1)
    expect(calls).toBe(1)
  })

  test('removes oldest images through LOW and keeps removals sticky', async () => {
    setBudgetEnv('40', '20')
    const budget = createImageContextBudget()
    const messages: M[] = [
      { role: 'user', content: [image(20, 'a')] },
      { role: 'user', content: [image(20, 'b')] },
      { role: 'user', content: [image(20, 'c')] },
      { role: 'user', content: [{ type: 'text', text: 'current' }] },
    ]
    const first = await budget(messages, resize)
    expect(first.stats.newlyRemoved).toBe(2)
    expect(first.messages[0]!.content[0]!.type).toBe('text')
    expect(first.messages[1]!.content[0]!.type).toBe('text')
    expect(first.stats.imagesAfter).toBe(1)
    const appended: M[] = [messages[0]!, messages[1]!, messages[2]!, { role: 'user', content: [image(20, 'd')] }, messages[3]!]
    const second = await budget(appended, resize)
    expect(second.stats.removedTotal).toBe(2)
    expect(second.stats.newlyRemoved).toBe(0)
    expect(second.messages[0]!.content[0]!.type).toBe('text')
  })

  test('does not remove images in the protected current turn and flags over-budget', async () => {
    setBudgetEnv('10', '5')
    const messages: M[] = [{ role: 'user', content: [{ type: 'text', text: 'current' }, image(20)] }]
    const result = await createImageContextBudget()(messages, resize)
    expect(result.stats.overBudgetProtected).toBe(true)
    expect(result.messages[0]!.content.some((block) => block.type === 'image')).toBe(true)
  })

  test('sticky user-image removals survive prefix compaction and do not affect neighboring images', async () => {
    setBudgetEnv('10', '8')
    const budget = createImageContextBudget()
    const original: M[] = [
      { role: 'user', timestamp: 100, content: [image(8, 'a')] },
      { role: 'user', timestamp: 200, content: [image(8, 'b')] },
      { role: 'user', timestamp: 300, content: [{ type: 'text', text: 'current' }] },
    ]
    const first = await budget(original, resize)
    expect(first.stats.newlyRemoved).toBe(1)
    const shifted: M[] = [
      { role: 'system', content: [{ type: 'text', text: 'compacted prefix' }] },
      ...original,
    ]
    const second = await budget(shifted, resize)
    expect(second.stats.newlyRemoved).toBe(0)
    expect(second.messages[1]!.content[0]!.type).toBe('text')
    expect(second.messages[2]!.content[0]!.type).toBe('image')
    expect(second.stats.removedTotal).toBe(1)
  })

  test('sticky toolResult removals survive prefix compaction', async () => {
    setBudgetEnv('10', '8')
    const budget = createImageContextBudget()
    const original: M[] = [
      { role: 'toolResult', toolCallId: 'read-7', content: [image(8, 'a')] },
      { role: 'toolResult', toolCallId: 'read-8', content: [image(8, 'b')] },
      { role: 'user', timestamp: 300, content: [{ type: 'text', text: 'current' }] },
    ]
    const first = await budget(original, resize)
    expect(first.stats.newlyRemoved).toBe(1)
    const shifted: M[] = [{ role: 'assistant', content: [{ type: 'text', text: 'compacted' }] }, ...original]
    const second = await budget(shifted, resize)
    expect(second.stats.newlyRemoved).toBe(0)
    expect(second.messages[1]!.content[0]!.type).toBe('text')
    expect(second.messages[2]!.content[0]!.type).toBe('image')
  })

  test('classifies provider errors without preserving raw messages', () => {
    expect(classifyProviderErrorKind('Request timed out')).toBe('timeout')
    expect(classifyProviderErrorKind('ECONNRESET while reading')).toBe('network')
    expect(classifyProviderErrorKind('HTTP status code 529 overloaded')).toBe('http-529')
    expect(classifyProviderErrorKind('provider rejected request')).toBe('other')
    expect(classifyProviderErrorKind(undefined)).toBe('other')
  })

  test('uses a Read toolCall path in the removal placeholder', async () => {
    setBudgetEnv('10', '5')
    const messages: M[] = [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: '/tmp/image.png' } }] },
      { role: 'toolResult', toolCallId: 'read-1', content: [image(20)] },
      { role: 'user', content: [{ type: 'text', text: 'describe' }] },
    ]
    const result = await createImageContextBudget()(messages, resize)
    expect(result.messages[1]!.content[0]!.text).toContain('/tmp/image.png')
  })

  test('keeps original image after a failed resize', async () => {
    const messages: M[] = [{ role: 'user', content: [image(1_100_000)] }, { role: 'user', content: [{ type: 'text', text: 'current' }] }]
    const result = await createImageContextBudget()(messages, async () => { throw new Error('failed') })
    expect(result.stats.recompressFailed).toBe(1)
    expect((result.messages[0]!.content[0] as { data: string }).data).toBe('a'.repeat(1_100_000))
  })

  test('honors valid test thresholds and falls back from invalid values', async () => {
    setBudgetEnv('10', '5', '2', '1')
    const messages: M[] = [
      { role: 'user', content: [image(3)] },
      { role: 'user', content: [image(3)] },
      { role: 'user', content: [image(3)] },
      { role: 'user', content: [{ type: 'text', text: 'current' }] },
    ]
    const result = await createImageContextBudget()(messages, resize)
    expect(result.stats.newlyRemoved).toBeGreaterThan(0)
    setBudgetEnv('invalid', 'invalid', 'invalid', 'invalid')
    const fallback = await createImageContextBudget()(messages, resize)
    expect(fallback.stats.newlyRemoved).toBe(0)
  })
})

/** 生成一张噪点 PNG（压缩率低，base64 超过 1 MiB，触发重压缩）。 */
function noisyPng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = randomBytes((width * 3 + 1) * height)
  for (let row = 0; row < height; row++) raw[row * (width * 3 + 1)] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

describe('SDK resize 接线（2026-11-11：重压缩后 Codex 报 unsupported image format）', () => {
  test('真实 Pi resizeImage：重压缩结果是可识别的图片，不是二次 base64', async () => {
    const png = noisyPng(1716, 995)
    const messages: M[] = [
      { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }] },
      { role: 'user', content: [{ type: 'text', text: 'current' }] },
    ]
    expect(png.toString('base64').length).toBeGreaterThan(1024 * 1024)
    const result = await createImageContextBudget()(messages, createSdkImageResizer(piResizeImage))
    expect(result.stats.recompressed).toBe(1)
    const out = result.messages[0]!.content[0] as { data: string; mimeType: string }
    const bytes = Buffer.from(out.data, 'base64')
    expect(detectImageMimeType(bytes)).toBe(out.mimeType)
    expect(['image/jpeg', 'image/png']).toContain(out.mimeType)
    expect(out.data.length).toBeLessThan(600 * 1024)
  }, 30_000)

  test('兼容字节返回；二次 base64 或无法识别的数据视为失败并保留原图', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(32)])
    const fromBytes = await createSdkImageResizer(async () => ({ data: new Uint8Array(jpeg), mimeType: 'image/jpeg' }))(new Uint8Array(1), 'image/png')
    expect(fromBytes).toEqual({ data: jpeg.toString('base64'), mimeType: 'image/jpeg' })
    const doubleEncoded = Buffer.from(jpeg.toString('base64')).toString('base64')
    expect(await createSdkImageResizer(async () => ({ data: doubleEncoded, mimeType: 'image/jpeg' }))(new Uint8Array(1), 'image/png')).toBeNull()
    // mimeType 以文件头为准
    expect(await createSdkImageResizer(async () => ({ data: jpeg.toString('base64'), mimeType: 'image/png' }))(new Uint8Array(1), 'image/png')).toEqual({ data: jpeg.toString('base64'), mimeType: 'image/jpeg' })
    const messages: M[] = [{ role: 'user', content: [image(1_100_000)] }, { role: 'user', content: [{ type: 'text', text: 'current' }] }]
    const kept = await createImageContextBudget()(messages, createSdkImageResizer(async () => ({ data: doubleEncoded, mimeType: 'image/jpeg' })))
    expect(kept.stats.recompressed).toBe(0)
    expect(kept.stats.recompressFailed).toBe(1)
    expect(kept.messages[0]!.content[0]).toBe(messages[0]!.content[0])
  })

  test('文件头识别', () => {
    expect(detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detectImageMimeType(Buffer.from('GIF89a', 'latin1'))).toBe('image/gif')
    expect(detectImageMimeType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp')
    expect(detectImageMimeType(Buffer.from('/9j/4AAQ', 'latin1'))).toBeNull()
  })
})
