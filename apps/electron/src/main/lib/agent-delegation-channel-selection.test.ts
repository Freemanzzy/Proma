import { describe, expect, it } from 'bun:test'
import {
  listAvailableDelegationChannels,
  resolveDelegationChannelSelection,
  type DelegationChannel,
} from './agent-delegation-channel-selection'

const channels: DelegationChannel[] = [
  {
    id: 'parent',
    name: 'clipproxyapi',
    provider: 'anthropic',
    enabled: true,
    models: [{ id: 'claude-sonnet', name: 'Claude Sonnet', enabled: true }],
  },
  {
    id: 'codex',
    name: 'ChatGPT 订阅 (Codex)',
    provider: 'openai-codex',
    enabled: true,
    models: [
      { id: 'gpt-5.5', name: 'GPT-5.5', enabled: true },
      { id: 'disabled-model', name: 'Disabled', enabled: false },
    ],
  },
  {
    id: 'disabled',
    name: 'Disabled channel',
    provider: 'openai',
    enabled: false,
    models: [{ id: 'model', name: 'Model', enabled: true }],
  },
  {
    id: 'proma-official',
    name: 'Proma 官方',
    provider: 'proma',
    enabled: true,
    models: [{ id: 'proma-model', name: 'Proma model', enabled: true }],
  },
]

describe('delegation channel selection', () => {
  it('preserves parent channel and model when channelId is omitted', () => {
    expect(resolveDelegationChannelSelection({
      channels,
      parentChannelId: 'parent',
      parentModelId: 'claude-sonnet',
    })).toEqual({ channelId: 'parent', modelId: 'claude-sonnet' })
  })

  it('selects the requested channel and model', () => {
    expect(resolveDelegationChannelSelection({
      channels,
      parentChannelId: 'parent',
      requestedChannelId: 'codex',
      requestedModelId: 'gpt-5.5',
    })).toEqual({ channelId: 'codex', modelId: 'gpt-5.5' })
  })

  it('uses the first enabled model if only channelId is supplied', () => {
    expect(resolveDelegationChannelSelection({
      channels,
      parentChannelId: 'parent',
      requestedChannelId: 'codex',
    })).toEqual({ channelId: 'codex', modelId: 'gpt-5.5' })
  })

  it('rejects a model that is not enabled on the requested channel', () => {
    expect(() => resolveDelegationChannelSelection({
      channels,
      parentChannelId: 'parent',
      requestedChannelId: 'codex',
      requestedModelId: 'claude-sonnet',
    })).toThrow(/不属于目标渠道或未启用.*可用渠道/)
  })

  it('rejects disabled and Proma official channels', () => {
    for (const requestedChannelId of ['disabled', 'proma-official']) {
      expect(() => resolveDelegationChannelSelection({
        channels,
        parentChannelId: 'parent',
        requestedChannelId,
      })).toThrow(/不可用于协作委派.*可用渠道/)
    }
  })

  it('lists enabled channels in groups and marks the current channel', () => {
    expect(listAvailableDelegationChannels(channels, 'parent')).toEqual([
      {
        channelId: 'parent',
        channelName: 'clipproxyapi',
        provider: 'anthropic',
        current: true,
        models: [{ id: 'claude-sonnet', name: 'Claude Sonnet', source: undefined }],
      },
      {
        channelId: 'codex',
        channelName: 'ChatGPT 订阅 (Codex)',
        provider: 'openai-codex',
        current: false,
        models: [{ id: 'gpt-5.5', name: 'GPT-5.5', source: undefined }],
      },
    ])
  })
})
