import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { serializeCodexCredentials } from '@proma/shared'

type ChannelManagerModule = typeof import('./channel-manager')

let channelManager: ChannelManagerModule
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV

mock.module('electron', () => ({
  BrowserWindow: class {},
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf-8'),
  },
  dialog: {},
  shell: {
    openExternal: async () => undefined,
  },
}))

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function writeChannels(channels: unknown[]): void {
  const configDir = join(tempHome, '.proma')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'channels.json'),
    JSON.stringify({ version: 2, channels }),
    'utf-8',
  )
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-channel-runtime-key-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  channelManager = await import('./channel-manager')
})

beforeEach(() => {
  rmSync(join(tempHome, '.proma'), { recursive: true, force: true })
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalPromaDev === undefined) {
    delete process.env.PROMA_DEV
  } else {
    process.env.PROMA_DEV = originalPromaDev
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('渠道运行时认证解析', () => {
  test('Given ChatGPT OAuth 渠道 When 解析运行时 key Then 返回 access token 而不是凭据 JSON', async () => {
    writeChannels([
      {
        id: 'codex-channel',
        name: 'ChatGPT',
        provider: 'openai-codex',
        baseUrl: '',
        apiKey: serializeCodexCredentials({
          access: 'oauth-access-token',
          refresh: 'oauth-refresh-token',
          expires: Date.now() + 3_600_000,
        }),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('codex-channel'))
      .resolves.toBe('oauth-access-token')
  })

  test('Given 存量 Codex 渠道 When 迁移 6.1 Sol Then 补入默认候选且保留用户禁用状态并幂等', () => {
    writeChannels([
      {
        id: 'codex-channel',
        name: 'ChatGPT',
        provider: 'openai-codex',
        baseUrl: '',
        apiKey: '',
        models: [{ id: 'gpt-6-sol', name: 'My Sol', enabled: false }],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    const first = channelManager.listChannels().find(({ id }) => id === 'codex-channel')
    expect(first?.models).toContainEqual({ id: 'gpt-6-sol', name: 'My Sol', enabled: false })
    expect(first?.models).toContainEqual({ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', enabled: true })
    const second = channelManager.listChannels().find(({ id }) => id === 'codex-channel')
    expect(second?.models).toEqual(first?.models)
  })

  test('Given 普通渠道 When 解析运行时 key Then 返回解密后的 API Key', async () => {
    writeChannels([
      {
        id: 'api-key-channel',
        name: 'Anthropic',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'plain-api-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('api-key-channel'))
      .resolves.toBe('plain-api-key')
  })
})
