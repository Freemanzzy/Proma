import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { EXTERNAL_WORKSPACE_READ_ONLY_MESSAGE, isBashCommandReadOnly, isPathWithinRoots, isPowerShellCommandReadOnly, resolveExternalWorkspaceToolDecision } from './workspace-readonly-policy'

const dirs: string[] = []
function tempDir(): string { const p = mkdtempSync(join(tmpdir(), 'workspace-ro-')); dirs.push(p); return p }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('external workspace read-only policy', () => {
  it('allows own workspace writes and denies writes outside', () => {
    const own = tempDir(); const other = tempDir()
    expect(isPathWithinRoots(join(own, 'new', 'file.txt'), [own], own)).toBe(true)
    expect(isPathWithinRoots(join(other, 'file.txt'), [own], own)).toBe(false)
  })

  it('rejects symlink escapes and judges nonexistent paths by their existing parent', () => {
    const own = tempDir(); const outside = tempDir()
    symlinkSync(outside, join(own, 'escape'))
    expect(isPathWithinRoots(join(own, 'escape', 'new.txt'), [own], own)).toBe(false)
    mkdirSync(join(own, 'nested'))
    expect(isPathWithinRoots(join(own, 'nested', 'not-yet-created', 'file'), [own], own)).toBe(true)
    writeFileSync(join(outside, 'existing'), 'x')
    expect(isPathWithinRoots(join(own, 'escape', 'existing'), [own], own)).toBe(false)
  })

  it('allows own writes and denies external writes before bypass mode can allow them', () => {
    const own = tempDir(); const other = tempDir()
    const ownWrite = resolveExternalWorkspaceToolDecision('bypassPermissions', 'Write', { file_path: join(own, 'new.txt') }, [own], own)
    expect(ownWrite?.behavior).toBe('allow')
    const outsideWrite = resolveExternalWorkspaceToolDecision('bypassPermissions', 'Write', { file_path: join(other, 'new.txt') }, [own], own)
    expect(outsideWrite).toEqual({ behavior: 'deny', message: EXTERNAL_WORKSPACE_READ_ONLY_MESSAGE })
    expect(resolveExternalWorkspaceToolDecision('bypassPermissions', 'NotebookEdit', { notebook_path: join(other, 'nb.ipynb') }, [own], own)?.behavior).toBe('deny')
    const bashWrite = resolveExternalWorkspaceToolDecision('bypassPermissions', 'Bash', { command: 'echo x > file' }, [own], own)
    expect(bashWrite?.behavior).toBe('deny')
    expect(resolveExternalWorkspaceToolDecision('bypassPermissions', 'Bash', { command: 'git status' }, [own], own)?.behavior).toBe('allow')
    expect(resolveExternalWorkspaceToolDecision('bypassPermissions', 'Read', { file_path: join(other, 'read.txt') }, [own], own)).toBeNull()
    expect(resolveExternalWorkspaceToolDecision('bypassPermissions', 'TerminalExecute', { command: 'rm file' }, [own], own)?.behavior).toBe('deny')
    expect(resolveExternalWorkspaceToolDecision('bypassPermissions', 'REPL', {}, [own], own)?.behavior).toBe('deny')
  })

  it('uses the conservative existing Bash and PowerShell classifiers', () => {
    for (const command of ['pwd', 'ls -la', 'git status', 'grep x file']) expect(isBashCommandReadOnly(command)).toBe(true)
    for (const command of ['echo x > file', 'rm file', 'mv a b', 'sed -i s/a/b file', 'git commit -m x']) expect(isBashCommandReadOnly(command)).toBe(false)
    expect(isPowerShellCommandReadOnly('Get-Content file')).toBe(true)
    expect(isPowerShellCommandReadOnly('Remove-Item file')).toBe(false)
  })
})
