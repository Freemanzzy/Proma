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

  test('uses the GPT-6 Sol reasoning levels and context window and supports Fast Mode', () => {
    const solProfile = resolveReasoningProfile({ modelId: 'gpt-6-sol', transport: 'openai-responses' })
    const sol61Profile = resolveReasoningProfile({ modelId: 'gpt-6.1-sol', transport: 'openai-responses' })
    expect(sol61Profile?.id).toBe(solProfile?.id)
    expect(sol61Profile?.levels).toEqual(solProfile?.levels)
    expect(sol61Profile?.levels).not.toContain('ultra')
    expect(inferContextWindow('gpt-6.1-sol')).toBe(inferContextWindow('gpt-6-sol'))
    expect(isCodexFastModeSupportedModel('gpt-6.1-sol')).toBe(true)
  })
})
