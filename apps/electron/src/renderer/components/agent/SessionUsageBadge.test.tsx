import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { badgePresentation, formatUsageNumber, SessionUsageBadge, shouldHideSessionUsageBadge } from './SessionUsageBadge'
import type { PersonalSessionUsageSummary } from '@proma/shared'

const base: PersonalSessionUsageSummary = { session: { requests: 2, input: 10, output: 2, cacheRead: 96, cacheWrite: 0, largeCacheRebuilds: 0, relativeCostIndex: 34_300_000, cacheHitRate: 0.96 }, lastRequest: { cacheWrite: 0, cacheHitRate: 0.96, largeCacheRebuild: false }, children: null }
describe('SessionUsageBadge formatting and responsive policy', () => {
  test('formats compact k/M values and percentages', () => {
    expect(formatUsageNumber(999)).toBe('999'); expect(formatUsageNumber(1200)).toBe('1.2k'); expect(formatUsageNumber(34_300_000)).toBe('34.3M')
    expect(badgePresentation(base)).toEqual({ label: '缓存 96% · 34.3M', warning: false })
  })
  test('renders nothing before this session has usage', () => {
    const previous = globalThis.window
    const previousNavigator = globalThis.navigator
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { __PROMA_WEB_REMOTE__: false, innerWidth: 1200, matchMedia: () => ({ matches: false }) } })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { maxTouchPoints: 0 } })
    try { expect(renderToStaticMarkup(<SessionUsageBadge sessionId="empty" />)).toBe('') }
    finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previous })
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator })
    }
  })
  test('marks the label amber only for a latest large rebuild', () => {
    const warning = { ...base, lastRequest: { cacheWrite: 300_000, cacheHitRate: 0.5, largeCacheRebuild: true } }
    expect(badgePresentation(warning).warning).toBe(true)
    expect(badgePresentation({ ...warning, lastRequest: { ...warning.lastRequest!, largeCacheRebuild: false } }).warning).toBe(false)
  })
  test('hides Web Remote touch/coarse/narrow layouts but permits desktop-width remote and local', () => {
    expect(shouldHideSessionUsageBadge(true, 1, false, 1200)).toBe(true)
    expect(shouldHideSessionUsageBadge(true, 0, true, 1200)).toBe(true)
    expect(shouldHideSessionUsageBadge(true, 0, false, 767)).toBe(true)
    expect(shouldHideSessionUsageBadge(true, 0, false, 1024)).toBe(false)
    expect(shouldHideSessionUsageBadge(false, 1, true, 400)).toBe(false)
  })
})
