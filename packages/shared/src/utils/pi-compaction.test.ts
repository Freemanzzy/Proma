import { describe, expect, it } from 'bun:test'
import {
  calculatePiAutoCompactionReserveTokens,
  calculatePiAutoCompactionReserveTokensForTrigger,
} from './pi-compaction'

describe('Feishu-bound Pi compaction trigger', () => {
  it.each([1_000_000, 200_000, 128_000])('caps bound sessions near 120K for %i context', (window) => {
    const original = calculatePiAutoCompactionReserveTokens(window)
    const reserve = calculatePiAutoCompactionReserveTokensForTrigger(window, original, 120_000)
    expect(reserve).toBe(Math.min(window, Math.max(original, window - 120_000)))
    expect(reserve).toBeLessThanOrEqual(window)
  })

  it('leaves unbound sessions at the original reserve', () => {
    for (const window of [1_000_000, 200_000, 128_000]) {
      const original = calculatePiAutoCompactionReserveTokens(window)
      expect(calculatePiAutoCompactionReserveTokensForTrigger(window, original)).toBe(original)
    }
  })
})
