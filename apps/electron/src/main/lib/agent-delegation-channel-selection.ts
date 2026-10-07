export interface DelegationChannelModel {
  id: string
  name: string
  enabled: boolean
  source?: 'manual' | 'fetched'
}

export interface DelegationChannel {
  id: string
  name: string
  provider: string
  enabled: boolean
  models: DelegationChannelModel[]
}

export interface AvailableDelegationChannel {
  channelId: string
  channelName: string
  provider: string
  current: boolean
  models: Array<{ id: string; name: string; source?: 'manual' | 'fetched' }>
}

export function listAvailableDelegationChannels(
  channels: DelegationChannel[],
  currentChannelId: string,
): AvailableDelegationChannel[] {
  return channels
    .filter((channel) => channel.enabled && channel.provider !== 'proma')
    .map((channel) => ({
      channelId: channel.id,
      channelName: channel.name,
      provider: channel.provider,
      current: channel.id === currentChannelId,
      models: channel.models
        .filter((model) => model.enabled)
        .map(({ id, name, source }) => ({ id, name, source })),
    }))
}

export function resolveDelegationChannelSelection(input: {
  channels: DelegationChannel[]
  parentChannelId: string
  parentModelId?: string
  requestedChannelId?: string
  requestedModelId?: string
}): { channelId: string; modelId?: string } {
  const available = listAvailableDelegationChannels(input.channels, input.parentChannelId)
  const availableNames = available.length
    ? available.map((channel) => `${channel.channelName} (${channel.channelId})`).join(', ')
    : '无可用渠道'

  if (input.requestedChannelId === undefined) {
    if (input.requestedModelId === undefined) {
      return { channelId: input.parentChannelId, modelId: input.parentModelId?.trim() || undefined }
    }
    const parentChannel = input.channels.find((channel) => channel.id === input.parentChannelId)
    const modelId = input.requestedModelId.trim()
    if (!modelId) throw new Error('创建协作子会话模型 ID 不能为空')
    if (!parentChannel?.enabled || !parentChannel.models.some((model) => model.id === modelId && model.enabled)) {
      throw new Error(`创建协作子会话模型不属于当前渠道或未启用: ${modelId}。可用渠道: ${availableNames}`)
    }
    return { channelId: input.parentChannelId, modelId }
  }

  const target = input.channels.find((channel) => channel.id === input.requestedChannelId)
  if (!target || !target.enabled || target.provider === 'proma') {
    throw new Error(`目标渠道不存在、未启用或不可用于协作委派: ${input.requestedChannelId}。可用渠道: ${availableNames}`)
  }
  const enabledModels = target.models.filter((model) => model.enabled)
  if (input.requestedModelId !== undefined) {
    const modelId = input.requestedModelId.trim()
    if (!modelId) throw new Error('创建协作子会话模型 ID 不能为空')
    if (!enabledModels.some((model) => model.id === modelId)) {
      throw new Error(`创建协作子会话模型不属于目标渠道或未启用: ${modelId}。可用渠道: ${availableNames}`)
    }
    return { channelId: target.id, modelId }
  }

  const firstModel = enabledModels[0]
  if (!firstModel) {
    throw new Error(`目标渠道没有已启用的 Agent 模型。可用渠道: ${availableNames}`)
  }
  return { channelId: target.id, modelId: firstModel.id }
}
