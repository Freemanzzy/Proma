import { describe, expect, test } from 'bun:test'
import { isWebRemoteDataSaverEnabled, webRemoteHistoryBudgets } from './mobile-budget'

describe('Web Remote 弱网预算', () => {
  test('2G/低速 downlink 自动开启，用户 localStorage 开关优先', () => {
    expect(isWebRemoteDataSaverEnabled(null, { effectiveType: '2g' })).toBe(true)
    expect(isWebRemoteDataSaverEnabled(null, { downlink: 0.5 })).toBe(true)
    expect(isWebRemoteDataSaverEnabled(null, { effectiveType: '4g', downlink: 10 })).toBe(false)
    expect(isWebRemoteDataSaverEnabled('off', { effectiveType: '2g' })).toBe(false)
    expect(isWebRemoteDataSaverEnabled('on', { effectiveType: '4g' })).toBe(true)
  })

  test('弱网历史窗口 256 KiB 且禁止内联图，正常模式保留默认预算', () => {
    expect(webRemoteHistoryBudgets(true)).toEqual({ historyBytes: 256 * 1024, inlineImageBytes: 0 })
    expect(webRemoteHistoryBudgets(false)).toEqual({ historyBytes: 2 * 1024 * 1024, inlineImageBytes: 1024 * 1024 })
  })
})
