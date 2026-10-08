import { describe, expect, test } from 'bun:test'
import { listCodexModels } from './pi-model-registry'

const credentials = {} as never

function listWithSdkModels(models: { id: string; name: string }[]) {
  return listCodexModels(credentials, async () => ({
    getAvailable: async () => models as never,
  }))
}

describe('listCodexModels patch merging', () => {
  test('adds complete patched models missing from the SDK list and preserves SDK-first order', async () => {
    const models = await listWithSdkModels([
      { id: 'sdk-model', name: 'SDK Model' },
    ])

    expect(models.map(({ id }) => id)).toEqual([
      'sdk-model',
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6.1-sol',
      'gpt-6-luna',
    ])
  })

  test('does not duplicate a patched model already present in the SDK list', async () => {
    const models = await listWithSdkModels([
      { id: 'gpt-6.1-sol', name: 'SDK GPT-6.1 Sol' },
    ])

    expect(models.filter(({ id }) => id === 'gpt-6.1-sol')).toHaveLength(1)
  })

  test('filters unsupported model prefixes after merging', async () => {
    const models = await listWithSdkModels([
      { id: 'gpt-5.5-mini', name: 'Unsupported GPT-5.5 Mini' },
    ])

    expect(models.some(({ id }) => id.startsWith('gpt-5.5'))).toBe(false)
    expect(models.some(({ id }) => id === 'gpt-6.1-sol')).toBe(true)
  })
})
