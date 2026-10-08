import { describe, expect, test } from 'bun:test'
import { getCodexCatalogModels } from './pi-model-registry'

describe('GPT-6.1 Sol Codex catalog entry', () => {
  test('is returned with the Codex Responses provider and 272K context window', async () => {
    const model = (await getCodexCatalogModels()).find(({ id }) => id === 'gpt-6.1-sol')
    expect(model).toMatchObject({
      id: 'gpt-6.1-sol',
      name: 'GPT-6.1 Sol',
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      baseUrl: expect.any(String),
      contextWindow: 272_000,
      input: ['text', 'image'],
    })
  })
})
