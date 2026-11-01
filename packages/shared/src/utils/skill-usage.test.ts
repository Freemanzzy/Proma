import { expect, test } from 'bun:test'
import { getSkillRootFromEntryPath, getSkillSlugFromEntryPath } from './skill-usage'

test('Skill entry recognition accepts workspace and shared active paths but excludes inactive paths', () => {
  expect(getSkillSlugFromEntryPath('/home/jo/.proma/agent-workspaces/work/skills/example/SKILL.md')).toBe('example')
  expect(getSkillSlugFromEntryPath('/home/jo/.proma/shared-skills/example/SKILL.md')).toBe('example')
  expect(getSkillSlugFromEntryPath('/home/jo/.proma/shared-skills-inactive/example/SKILL.md')).toBeNull()
  expect(getSkillSlugFromEntryPath('/home/jo/.proma/agent-workspaces/work/skills-inactive/example/SKILL.md')).toBeNull()
  expect(getSkillRootFromEntryPath('/home/jo/.proma/agent-workspaces/work/skills/example/SKILL.md')).toBe('/home/jo/.proma/agent-workspaces/work/skills')
  expect(getSkillRootFromEntryPath('/home/jo/.proma/shared-skills/example/SKILL.md')).toBe('/home/jo/.proma/shared-skills')
  expect(getSkillRootFromEntryPath('/home/jo/.proma/shared-skills-inactive/example/SKILL.md')).toBeNull()
})

test('Skill entry recognition normalizes Windows separators for shared paths', () => {
  const path = 'C:\\Users\\jo\\.proma\\shared-skills\\example\\SKILL.md'
  expect(getSkillSlugFromEntryPath(path)).toBe('example')
  expect(getSkillRootFromEntryPath(path)).toBe('C:/Users/jo/.proma/shared-skills')
})
