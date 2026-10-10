import { describe, expect, test } from 'bun:test'
import { detectThinkingCapability } from './thinking-capability.ts'

describe('Claude thinking capability versions', () => {
  test('Claude Opus/Sonnet 5.5 and later omit explicit disabled thinking', () => {
    for (const modelId of [
      'claude-opus-5-5',
      'claude-opus-5-5-20251022',
      'claude-opus-5-5-latest',
      'claude-sonnet-5-5-20251022',
      'claude-haiku-5-6-latest',
    ]) {
      expect(detectThinkingCapability('anthropic', modelId).disableStrategy).toBe('omit-field')
    }
  })

  test('older Claude models retain their existing disable strategy and mode', () => {
    expect(detectThinkingCapability('anthropic', 'claude-opus-4-7')).toEqual({
      mode: 'adaptive-only',
      disableStrategy: 'explicit-disabled',
    })
    expect(detectThinkingCapability('anthropic', 'claude-sonnet-5')).toMatchObject({
      mode: 'adaptive-preferred',
      disableStrategy: 'explicit-disabled',
    })
    expect(detectThinkingCapability('anthropic', 'claude-opus-4-6')).toMatchObject({
      mode: 'adaptive-preferred',
      disableStrategy: 'explicit-disabled',
    })
  })
})
