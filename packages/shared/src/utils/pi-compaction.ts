/** Pi 自动压缩开始时的上下文占用比例。 */
export const PI_AUTO_COMPACTION_THRESHOLD_RATIO = 0.8

/**
 * 将目标上下文占用比例换算为 Pi SDK 的 reserveTokens 配置。
 *
 * Pi 在 `contextTokens > contextWindow - reserveTokens` 时自动压缩，
 * 因此预留 20% 的窗口即可在约 80% 占用时开始压缩。
 */
export function calculatePiAutoCompactionReserveTokens(contextWindow: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new TypeError('Pi context window must be a positive finite number')
  }

  return Math.ceil(contextWindow * (1 - PI_AUTO_COMPACTION_THRESHOLD_RATIO))
}

/** 返回 Pi SDK 会开始自动压缩的上下文 token 阈值。 */
export function calculatePiAutoCompactionThresholdTokens(contextWindow: number): number {
  return contextWindow - calculatePiAutoCompactionReserveTokens(contextWindow)
}

/** Bound sessions may start compaction at an explicit token trigger without changing other sessions. */
export function calculatePiAutoCompactionReserveTokensForTrigger(
  contextWindow: number,
  originalReserveTokens: number,
  triggerTokens?: number,
): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new TypeError('Pi context window must be a positive finite number')
  }
  if (triggerTokens == null) return Math.min(contextWindow, originalReserveTokens)
  if (!Number.isFinite(triggerTokens) || triggerTokens < 0) {
    throw new TypeError('Pi compaction trigger must be a non-negative finite number')
  }
  return Math.min(contextWindow, Math.max(originalReserveTokens, contextWindow - triggerTokens))
}
