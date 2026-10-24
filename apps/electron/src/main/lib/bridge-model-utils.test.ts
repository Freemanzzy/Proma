import { describe, expect, it } from 'bun:test'
import type { Channel } from '@proma/shared'
import { resolveBridgeModelSelection } from './bridge-model-selection'

const channels = [
  { id: 'enabled', name: 'Enabled', enabled: true, models: [{ id: 'm1', name: 'M1', enabled: true }] },
  { id: 'disabled', name: 'Disabled', enabled: false, models: [{ id: 'm2', name: 'M2', enabled: true }] },
] as unknown as Channel[]

describe('resolveBridgeModelSelection', () => {
  it('uses the first enabled candidate in supplied precedence order', () => {
    expect(resolveBridgeModelSelection([
      { channelId: 'enabled', modelId: 'm1' },
      { channelId: 'enabled', modelId: 'other' },
    ], channels)).toEqual({ channelId: 'enabled', modelId: 'm1', valid: true, sourceIndex: 0 })
  })

  it('falls back when a higher-priority channel or model is unavailable', () => {
    expect(resolveBridgeModelSelection([
      { channelId: 'disabled', modelId: 'm2' },
      { channelId: 'enabled', modelId: 'm1' },
    ], channels)).toEqual({ channelId: 'enabled', modelId: 'm1', valid: true, sourceIndex: 1 })
    expect(resolveBridgeModelSelection([
      { channelId: 'enabled', modelId: 'missing' },
      { channelId: 'enabled', modelId: 'm1' },
    ], channels).sourceIndex).toBe(1)
  })

  it('returns invalid when no candidate is usable', () => {
    expect(resolveBridgeModelSelection([{ channelId: 'disabled', modelId: 'm2' }], channels).valid).toBe(false)
  })
})
