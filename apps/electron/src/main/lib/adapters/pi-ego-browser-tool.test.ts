import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEgoBrowserTools, resolveEgoBrowserBin, runEgoBrowserScript } from './pi-ego-browser-tool'

const originalEnv = { ...process.env }
const tempDirs: string[] = []

afterEach(() => {
  process.env = { ...originalEnv }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'proma-ego-tool-'))
  tempDirs.push(dir)
  return dir
}

function fakeBrowser(body: string): string {
  const dir = tempDir()
  const scriptPath = join(dir, 'ego-browser')
  writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`)
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

function textOf(result: Awaited<ReturnType<typeof runEgoBrowserScript>>): string {
  return result.content[0].text
}

describe('EgoBrowser executable resolution and execution', () => {
  test('merges stdout and stderr, extracts notice, and includes exit code', async () => {
    const bin = fakeBrowser(`printf 'stdout-before\\n'; sleep 0.05; printf 'stderr-after\\n' >&2; printf '[ego-browser:notice] update available\\n' >&2; exit 7`)
    const result = await runEgoBrowserScript('console.log("ignored by fake")', { bin })
    const text = textOf(result)

    expect(text).toContain('stdout-before')
    expect(text).toContain('stderr-after')
    expect(text).toContain('退出码: 7')
    expect(text).toContain('ego 提示：update available（升级需先征得用户同意）')
    expect(text).not.toContain('[ego-browser:notice]')
  })

  test('passes the script through stdin and serverName as an argument', async () => {
    const dir = tempDir()
    const capture = join(dir, 'stdin.txt')
    const argsCapture = join(dir, 'args.txt')
    process.env.EGO_TEST_CAPTURE = capture
    process.env.EGO_TEST_ARGS = argsCapture
    const bin = fakeBrowser(`cat > "$EGO_TEST_CAPTURE"; printf '%s\\n' "$@" > "$EGO_TEST_ARGS"`)
    const script = 'const task = await taskSpace("same space");\nconsole.log(task.spaceId)'
    const result = await runEgoBrowserScript(script, { bin, serverName: 'my_server-1' })

    expect(textOf(result)).toContain('退出码: 0')
    expect(readFileSync(capture, 'utf8')).toBe(script)
    expect(readFileSync(argsCapture, 'utf8')).toBe('--ego-server-name=my_server-1\nnodejs\n')
  })

  test('validates serverName and timeoutMs', async () => {
    const bin = fakeBrowser('exit 0')
    await expect(runEgoBrowserScript('x', { bin, serverName: 'bad/name' })).rejects.toThrow('serverName')
    await expect(runEgoBrowserScript('x', { bin, timeoutMs: 999 })).rejects.toThrow('timeoutMs')
    await expect(runEgoBrowserScript('x', { bin, timeoutMs: 600001 })).rejects.toThrow('timeoutMs')
  })

  test('terminates the detached process group on timeout', async () => {
    const bin = fakeBrowser('cat >/dev/null; sleep 60')
    const startedAt = Date.now()
    const result = await runEgoBrowserScript('long running script', { bin, timeoutMs: 1_000 })
    const elapsedMs = Date.now() - startedAt

    expect(textOf(result)).toContain('已超时，可在同一 TaskSpace 中继续。')
    expect(textOf(result)).toContain('退出码:')
    expect(result.details?.timedOut).toBe(true)
    expect(elapsedMs).toBeLessThan(5_000)
  })

  test('keeps only the last 50KB and reports truncation', async () => {
    const bin = fakeBrowser("head -c 60000 /dev/zero | tr '\\0' 'x'")
    const result = await runEgoBrowserScript('large output', { bin })
    const text = textOf(result)

    expect(text).toContain('已截断')
    expect(text).toContain('退出码: 0')
    expect(text.endsWith('x\n退出码: 0')).toBe(true)
  })

  test('terminates the process group when AbortSignal is cancelled', async () => {
    const bin = fakeBrowser('cat >/dev/null; sleep 60')
    const controller = new AbortController()
    const promise = runEgoBrowserScript('abort me', { bin, timeoutMs: 10_000, signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    const result = await promise

    expect(textOf(result)).toContain('已中止，可在同一 TaskSpace 中继续。')
    expect(result.details?.aborted).toBe(true)
  })

  test('does not register when no executable can be resolved', () => {
    const dir = tempDir()
    process.env.EGO_BROWSER_BIN = join(dir, 'missing-ego-browser')
    process.env.PATH = dir
    process.env.HOME = dir
    const sdk = { defineTool: (definition: unknown) => definition } as any

    const resolved = resolveEgoBrowserBin(dir)
    expect(resolved).toBeNull()
    expect(buildEgoBrowserTools(sdk, resolved)).toEqual([])
  })
})