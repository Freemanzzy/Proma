/**
 * GPT-6 model-family recognition shared by channel, runtime, and UI code.
 *
 * Astra can carry hyphenated SKU suffixes returned by Codex. Sol and Luna are
 * exact IDs so nearby names are never routed as an official model by mistake.
 * The explicit GPT-6.1 Sol ID is included without accepting other near-matches.
 */
const GPT_6_ASTRA_FAMILY_PATTERN = /^gpt-6-astra(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/
const GPT_6_SOL_MODEL_IDS = new Set(['gpt-6-sol', 'gpt-6.1-sol'])
const GPT_6_LUNA_MODEL_ID = 'gpt-6-luna'

function normalizeModelId(modelId: string | undefined): string | undefined {
  return modelId?.trim().toLowerCase().replace(/\[1m\]$/i, '')
}

export function isGpt6AstraFamily(modelId: string | undefined): boolean {
  const normalized = normalizeModelId(modelId)
  return normalized !== undefined && GPT_6_ASTRA_FAMILY_PATTERN.test(normalized)
}

export function isGpt6SolFamily(modelId: string | undefined): boolean {
  const normalized = normalizeModelId(modelId)
  return normalized !== undefined && GPT_6_SOL_MODEL_IDS.has(normalized)
}

export function isGpt6LunaFamily(modelId: string | undefined): boolean {
  return normalizeModelId(modelId) === GPT_6_LUNA_MODEL_ID
}
