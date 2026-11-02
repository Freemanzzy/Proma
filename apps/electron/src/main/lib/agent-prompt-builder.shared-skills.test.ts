import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, mock, test } from 'bun:test'
import * as nodeOs from 'node:os'

test('system prompt points new shared-mode Skill writes at shared-skills and preserves the legacy path otherwise', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-prompt-shared-skills-'))
  const previous = {
    home: process.env.HOME,
    dev: process.env.PROMA_DEV,
    dataDirName: process.env.PROMA_DEV_DATA_DIR_NAME,
  }
  process.env.PROMA_DEV = '1'
  process.env.PROMA_DEV_DATA_DIR_NAME = '.proma-dev-prompt-test'
  mock.module('node:os', () => ({ ...nodeOs, homedir: () => home }))

  try {
    const { getConfigDir } = await import('./config-paths')
    const { buildSystemPrompt } = await import('./agent-prompt-builder')
    const configDir = getConfigDir()
    const workspaceSlug = 'prompt-skills-fixture'
    const build = () => buildSystemPrompt({
      workspaceSlug,
      sessionId: 'prompt-test-session',
      permissionMode: 'bypassPermissions',
      productivityTools: { todosEnabled: false, calendarEnabled: false, obsidianEnabled: false },
    })

    const legacyPrompt = build()
    const expectedLegacy = `Skills：\`${join(configDir, 'agent-workspaces', workspaceSlug, 'skills')}\``
    expect(legacyPrompt).toContain(expectedLegacy)

    mkdirSync(join(configDir, 'shared-skills'))
    mkdirSync(join(configDir, 'shared-skills-inactive'))
    const sharedPrompt = build()
    expect(sharedPrompt).toContain(`Skills：\`${join(configDir, 'shared-skills')}\``)
    expect(sharedPrompt).not.toContain(`Skills：\`${join(configDir, 'agent-workspaces', workspaceSlug, 'skills')}\``)
  } finally {
    if (previous.home === undefined) delete process.env.HOME
    else process.env.HOME = previous.home
    mock.restore()
    if (previous.dev === undefined) delete process.env.PROMA_DEV
    else process.env.PROMA_DEV = previous.dev
    if (previous.dataDirName === undefined) delete process.env.PROMA_DEV_DATA_DIR_NAME
    else process.env.PROMA_DEV_DATA_DIR_NAME = previous.dataDirName
    rmSync(home, { recursive: true, force: true })
  }
})
