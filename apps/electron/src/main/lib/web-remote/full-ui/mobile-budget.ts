export interface WebRemoteNetworkHint { effectiveType?: string; downlink?: number }

export function isWebRemoteDataSaverEnabled(override: string | null | undefined, connection?: WebRemoteNetworkHint): boolean {
  if (override === 'on') return true
  if (override === 'off') return false
  return !!connection && (/^(slow-2g|2g)$/.test(connection.effectiveType ?? '') || (typeof connection.downlink === 'number' && connection.downlink < 1))
}

export function webRemoteHistoryBudgets(dataSaver: boolean): { historyBytes: number; inlineImageBytes: number } {
  return dataSaver ? { historyBytes: 256 * 1024, inlineImageBytes: 0 } : { historyBytes: 2 * 1024 * 1024, inlineImageBytes: 1024 * 1024 }
}
