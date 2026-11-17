import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasRootProjectAgentsInstruction, resolveProjectInstructions, MAX_TOTAL_BYTES } from './project-instruction-resolver'

const temporaryProjects: string[] = []

function createProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'proma-project-instructions-'))
  temporaryProjects.push(projectRoot)
  return projectRoot
}

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true })
  }
})

describe('项目根 AGENTS 指令状态', () => {
  test('Given Linux 大小写不同的 AGENTS.MD When 解析项目指令 Then 标记项目地图已建立', () => {
    const projectRoot = createProject()
    writeFileSync(join(projectRoot, 'AGENTS.MD'), '# Project instructions')

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(manifest.sources).toHaveLength(1)
    expect(manifest.sources[0]).toMatchObject({ kind: 'agents', scopeRoot: '.' })
    expect(hasRootProjectAgentsInstruction(manifest)).toBe(true)
  })

  test('Given 项目内 AGENTS.md 符号链接 When 解析项目指令 Then 标记项目地图已建立', () => {
    const projectRoot = createProject()
    const instructionsDirectory = join(projectRoot, 'instructions')
    mkdirSync(instructionsDirectory)
    writeFileSync(join(instructionsDirectory, 'project.md'), '# Project instructions')
    symlinkSync(join('instructions', 'project.md'), join(projectRoot, 'AGENTS.md'))

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(manifest.sources).toHaveLength(1)
    expect(manifest.sources[0]).toMatchObject({ kind: 'agents', relativePath: 'AGENTS.md', scopeRoot: '.' })
    expect(hasRootProjectAgentsInstruction(manifest)).toBe(true)
  })

  test('Given 仅有 legacy CLAUDE.md When 解析项目指令 Then 项目地图仍标记未建立', () => {
    const projectRoot = createProject()
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# Legacy instructions')

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(hasRootProjectAgentsInstruction(manifest)).toBe(false)
  })

  test('Given 未创建的目标文件位于项目根内 When 解析项目指令 Then 仍保留根指令状态', () => {
    const projectRoot = createProject()
    writeFileSync(join(projectRoot, 'AGENTS.md'), '# Project instructions')

    const manifest = resolveProjectInstructions({
      projectRoot,
      targetPath: join(projectRoot, 'new-directory', 'new-file.ts'),
    })

    expect(hasRootProjectAgentsInstruction(manifest)).toBe(true)
  })
})


describe('项目指令字节上限', () => {
  test('accepts exactly 64 KB per source and 128 KB total, not one byte more', () => {
    const root = createProject()
    mkdirSync(join(root, 'child'))
    writeFileSync(join(root, 'AGENTS.md'), 'r'.repeat(64 * 1024))
    writeFileSync(join(root, 'child/AGENTS.md'), 'c'.repeat(64 * 1024))
    const exact = resolveProjectInstructions({ projectRoot: root, targetPath: join(root, 'child') })
    expect(MAX_TOTAL_BYTES).toBe(128 * 1024)
    expect(exact.sources).toHaveLength(2)
    expect(exact.totalBytes).toBe(MAX_TOTAL_BYTES)
    writeFileSync(join(root, 'child/AGENTS.md'), 'c'.repeat(64 * 1024 + 1))
    const oversized = resolveProjectInstructions({ projectRoot: root, targetPath: join(root, 'child') })
    expect(oversized.sources).toHaveLength(1)
    expect(oversized.diagnostics[0]?.message).toContain('64 KB')
  })

  test('total limit is enforced across nested distinct sources', () => {
    const root = createProject()
    mkdirSync(join(root, 'a/b'), { recursive: true })
    for (const dir of ['', 'a', 'a/b']) writeFileSync(join(root, dir, 'AGENTS.md'), 'x'.repeat(48 * 1024))
    const manifest = resolveProjectInstructions({ projectRoot: root, targetPath: join(root, 'a/b') })
    expect(manifest.sources).toHaveLength(2)
    expect(manifest.totalBytes).toBe(96 * 1024)
    expect(manifest.diagnostics[0]?.message).toContain('128 KB')
  })
})
