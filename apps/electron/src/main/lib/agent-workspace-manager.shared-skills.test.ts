import { afterAll, expect, mock, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

const testHome = fs.mkdtempSync('/tmp/proma-shared-skills-home-')
mock.module('node:os', () => ({ ...os, homedir: () => testHome }))
mock.module('electron', () => ({ app: { isPackaged: false } }))
const previousDev = process.env.PROMA_DEV
const previousDataDirName = process.env.PROMA_DEV_DATA_DIR_NAME
process.env.PROMA_DEV = '1'
process.env.PROMA_DEV_DATA_DIR_NAME = '.proma-dev-fixture'

const paths = await import('./config-paths')
const manager = await import('./agent-workspace-manager')
afterAll(() => {
  fs.rmSync(testHome, { recursive: true, force: true })
  if (previousDev === undefined) delete process.env.PROMA_DEV; else process.env.PROMA_DEV = previousDev
  if (previousDataDirName === undefined) delete process.env.PROMA_DEV_DATA_DIR_NAME; else process.env.PROMA_DEV_DATA_DIR_NAME = previousDataDirName
})

function createSkill(dir: string, text: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(join(dir, 'SKILL.md'), `---\nname: fixture\ndescription: fixture skill\n---\n\n${text}\n`)
}

test('workspace create/copy, shared path redirection, legacy-link deletion, and skill toggling are isolated', async () => {
  const configDir = paths.getConfigDir()
  const active = join(configDir, 'shared-skills')
  const inactive = join(configDir, 'shared-skills-inactive')
  fs.mkdirSync(active, { recursive: true }); fs.mkdirSync(inactive, { recursive: true })
  const customSkill = join(active, 'custom-skill')
  createSkill(customSkill, 'user-edited shared content')
  const templateDir = paths.getDefaultSkillsDir()
  createSkill(join(templateDir, 'template-skill'), 'template content')

  const sharedWorkspace = await manager.createAgentWorkspace('Shared Workspace')
  const sharedWorkspaceDir = paths.getAgentWorkspacePath(sharedWorkspace.slug)
  expect(paths.getWorkspaceSkillsDir(sharedWorkspace.slug)).toBe(active)
  expect(paths.getInactiveSkillsDir(sharedWorkspace.slug)).toBe(inactive)
  expect(fs.existsSync(join(sharedWorkspaceDir, 'skills'))).toBe(false)
  expect(fs.readFileSync(join(customSkill, 'SKILL.md'), 'utf8')).toContain('user-edited shared content')
  expect(fs.existsSync(join(active, 'template-skill'))).toBe(false)
  await expect(manager.importSkillFromWorkspace(sharedWorkspace.slug, sharedWorkspace.slug, 'custom-skill')).rejects.toThrow(/已存在/)

  fs.rmSync(active, { recursive: true, force: true }); fs.rmSync(inactive, { recursive: true, force: true })
  const localWorkspace = await manager.createAgentWorkspace('Local Workspace')
  const localSkills = join(paths.getAgentWorkspacePath(localWorkspace.slug), 'skills')
  expect(fs.lstatSync(localSkills).isDirectory()).toBe(true)
  expect(fs.readFileSync(join(localSkills, 'template-skill', 'SKILL.md'), 'utf8')).toContain('template content')

  fs.mkdirSync(active, { recursive: true }); fs.mkdirSync(inactive, { recursive: true })
  createSkill(join(active, 'toggle-skill'), 'toggle fixture')
  expect(paths.getWorkspaceSkillsDir(sharedWorkspace.slug)).toBe(active)
  manager.toggleWorkspaceSkill(sharedWorkspace.slug, 'toggle-skill', false)
  expect(fs.existsSync(join(active, 'toggle-skill'))).toBe(false)
  expect(fs.existsSync(join(inactive, 'toggle-skill'))).toBe(true)
  manager.toggleWorkspaceSkill(localWorkspace.slug, 'toggle-skill', true)
  expect(fs.existsSync(join(active, 'toggle-skill'))).toBe(true)
  expect(fs.existsSync(join(inactive, 'toggle-skill'))).toBe(false)

  const oldLinksWorkspace = await manager.createAgentWorkspace('Old Links Workspace')
  const oldWorkspaceDir = paths.getAgentWorkspacePath(oldLinksWorkspace.slug)
  fs.symlinkSync(active, join(oldWorkspaceDir, 'skills'), 'dir')
  fs.symlinkSync(inactive, join(oldWorkspaceDir, 'skills-inactive'), 'dir')
  manager.deleteAgentWorkspace(oldLinksWorkspace.id)
  expect(fs.existsSync(oldWorkspaceDir)).toBe(false)
  expect(fs.existsSync(join(active, 'toggle-skill', 'SKILL.md'))).toBe(true)
})
