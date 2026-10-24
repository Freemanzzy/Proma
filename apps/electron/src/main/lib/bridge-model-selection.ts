import type { Channel } from '@proma/shared'

export interface BridgeModelSelection {
  channelId?: string
  modelId?: string
}

/** Choose the first still-enabled channel/model pair in precedence order. */
export function resolveBridgeModelSelection(
  candidates: Array<BridgeModelSelection | undefined>,
  channels: Channel[],
): BridgeModelSelection & { valid: boolean; sourceIndex: number } {
  for (let sourceIndex = 0; sourceIndex < candidates.length; sourceIndex++) {
    const candidate = candidates[sourceIndex]
    if (!candidate?.channelId || !candidate.modelId) continue
    const channel = channels.find((item) => item.id === candidate.channelId && item.enabled)
    if (!channel || !channel.models.some((item) => item.id === candidate.modelId && item.enabled)) continue
    return { channelId: candidate.channelId, modelId: candidate.modelId, valid: true, sourceIndex }
  }
  const last = candidates.find((item) => item?.channelId || item?.modelId)
  return { channelId: last?.channelId, modelId: last?.modelId, valid: false, sourceIndex: -1 }
}
