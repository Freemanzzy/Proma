import { describe, expect, test } from 'bun:test'
import { isGpt61SolModel, isGpt6SolFamily } from './model-family'
import { inferContextWindow } from './context-window'
import { resolveReasoningProfile } from '../types/reasoning-profile'
import { isCodexFastModeSupportedModel } from '../types/agent'

describe('GPT-6.1 Sol model support', () => {
  test('recognizes only the exact 6.1 Sol ID and existing Sol ID', () => {
    expect(isGpt61SolModel('gpt-6.1-sol')).toBe(true)
    expect(isGpt6SolFamily('gpt-6.1-sol')).toBe(false)
    expect(isGpt6SolFamily(' GPT-6-SOL ')).toBe(true)
    expect(isGpt6SolFamily('gpt-6.1-sol-preview')).toBe(false)
    expect(isGpt6SolFamily('gpt-6.10-sol')).toBe(false)
  })

  test('uses an Astra-shaped reasoning profile with a Sol default and shared context/Fast Mode support', () => {
    const solProfile = resolveReasoningProfile({ modelId: 'gpt-6-sol', transport: 'openai-responses' })
    const sol61Profile = resolveReasoningProfile({ modelId: 'gpt-6.1-sol', transport: 'openai-responses' })
    expect(sol61Profile?.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(sol61Profile?.levels).not.toContain('off')
    expect(solProfile?.levels).toContain('off')
    expect(sol61Profile?.defaultLevel).toBe('medium')
    expect(sol61Profile?.normalize('off')).toBe('low')
    expect(sol61Profile?.encodings['openai-responses']?.effortMap?.off).toBe('low')
    expect(sol61Profile?.encodings['openai-responses']?.effortMap?.minimal).toBe('low')
    expect(solProfile?.encodings['openai-responses']?.effortMap?.off).toBe('none')
    expect(inferContextWindow('gpt-6.1-sol')).toBe(inferContextWindow('gpt-6-sol'))
    expect(isCodexFastModeSupportedModel('gpt-6.1-sol')).toBe(true)
  })
})
