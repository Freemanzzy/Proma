import { describe, expect, test } from 'bun:test'
import { computeVisibleToolbarCount } from './InputToolbarOverflow'

const GAP = 6
const MORE = 36
const base = [{ key: 'a' }, { key: 'b' }, { key: 'compact' }]
const withBadge = [...base, { key: 'usage', hideWhenOverflow: true }]
const widths = { a: 36, b: 36, compact: 36, usage: 120 }
// a + b + compact = 36*3 + 6*2 = 120

describe('computeVisibleToolbarCount', () => {
  test('all items fit', () => {
    expect(computeVisibleToolbarCount(withBadge, widths, 400, GAP, MORE)).toBe(4)
  })

  test('hideable badge is dropped alone without reserving the more button; compact stays visible', () => {
    // 120 fits the three buttons exactly; the badge does not fit.
    expect(computeVisibleToolbarCount(withBadge, widths, 130, GAP, MORE)).toBe(3)
  })

  test('compact overflows at exactly the same width as without the badge', () => {
    for (const width of [60, 90, 110, 119, 120, 125]) {
      expect(computeVisibleToolbarCount(withBadge, widths, width, GAP, MORE))
        .toBe(Math.min(3, computeVisibleToolbarCount(base, widths, width, GAP, MORE)))
    }
  })

  test('an unmeasured hideable item does not disable overflow calculation', () => {
    const { usage: _unused, ...measured } = widths
    expect(computeVisibleToolbarCount(withBadge, measured, 90, GAP, MORE)).toBe(computeVisibleToolbarCount(base, widths, 90, GAP, MORE))
  })

  test('unmeasured regular items still show everything first', () => {
    expect(computeVisibleToolbarCount(base, { a: 36 }, 50, GAP, MORE)).toBe(3)
  })
})
