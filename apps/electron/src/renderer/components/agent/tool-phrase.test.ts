import { expect, test } from 'bun:test'
import { getToolPhrase } from './tool-phrase'

test('Read tool phrase identifies active workspace/shared Skill entries but not inactive Skills', () => {
  expect(getToolPhrase('Read', { file_path: '/home/jo/.proma/agent-workspaces/work/skills/example/SKILL.md' }).label).toBe('读取技能 example')
  expect(getToolPhrase('Read', { file_path: '/home/jo/.proma/shared-skills/example/SKILL.md' }).label).toBe('读取技能 example')
  expect(getToolPhrase('Read', { file_path: '/home/jo/.proma/shared-skills-inactive/example/SKILL.md' }).label).toBe('读取 SKILL.md')
})

test('Read tool phrase normalizes Windows separators for shared Skills', () => {
  expect(getToolPhrase('Read', { file_path: 'C:\\Users\\jo\\.proma\\shared-skills\\example\\SKILL.md' }).label).toBe('读取技能 example')
})
