import { describe, expect, test } from 'bun:test'
import { isGpt6SolFamily } from './model-family'
import { inferContextWindow } from './context-window'
import { resolveReasoningProfile } from '../types/reasoning-profile'
import { isCodexFastModeSupportedModel } from '../types/agent'

describe('GPT-6.1 Sol model support', () => {
  test('recognizes only the exact 6.1 Sol ID and existing Sol ID', () => {
    expect(isGpt6SolFamily('gpt-6.1-sol')).toBe(true)
    expect(isGpt6SolFamily(' GPT-6-SOL ')).toBe(true)
    expect(isGpt6SolFamily('gpt-6.1-sol-preview')).toBe(false)
    expect(isGpt6SolFamily('gpt-6.10-sol')).toBe(false)
  })

  test('exposes GPT-6.1 Sol reasoning profile, ultra tier, context window, and Fast Mode', () => {
    const profile = resolveReasoningProfile({ modelId: 'gpt-6.1-sol', transport: 'openai-responses' })
    expect(profile?.id).toBe('openai-reasoning-sol-luna')
    expect(profile?.levels).toContain('ultra')
    expect(profile?.encodings['openai-responses']?.effortMap?.ultra).toBe('ultra')
    expect(inferContextWindow('gpt-6.1-sol')).toBe(272_000)
    expect(isCodexFastModeSupportedModel('gpt-6.1-sol')).toBe(true)
  })
})
