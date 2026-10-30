import { afterEach, describe, expect, test } from 'bun:test'
import { clearImageResizeCacheForTests, createImageContextBudget } from './image-context-budget'

type M = { role: string; content: Array<Record<string, unknown>>; toolCallId?: string }
const image = (length: number, fill = 'a') => ({ type: 'image', mimeType: 'image/png', data: fill.repeat(length) })
const resize = async (bytes: Uint8Array, mimeType: string) => ({ data: Buffer.alloc(Math.min(bytes.length, 20)).toString('base64'), mimeType: 'image/jpeg' })
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
