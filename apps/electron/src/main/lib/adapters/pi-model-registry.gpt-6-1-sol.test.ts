import { describe, expect, test } from 'bun:test'
import { getCodexCatalogModels } from './pi-model-registry'

describe('GPT-6.1 Sol Codex catalog entry', () => {
  test('is returned with the Codex Responses provider and shared GPT-6 context window', async () => {
    const models = await getCodexCatalogModels()
    const model = models.find(({ id }) => id === 'gpt-6.1-sol')
    const sol = models.find(({ id }) => id === 'gpt-6-sol')
    expect(model).toMatchObject({
      id: 'gpt-6.1-sol',
      name: 'GPT-6.1 Sol',
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      baseUrl: expect.any(String),
      contextWindow: sol?.contextWindow,
      input: ['text', 'image'],
    })
    expect(model?.contextWindow).toBe(sol?.contextWindow)
  })
})
