import { afterEach, describe, expect, test } from 'bun:test'
import { build } from 'esbuild'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const tempOutputs: string[] = []

afterEach(() => {
  for (const path of tempOutputs.splice(0)) rmSync(path, { force: true })
})

describe('Web Remote bundled ws import', () => {
  test('具名 WebSocketServer 在 Node CJS bundle 中解析为构造函数', async () => {
    const sourcePath = new URL('./web-remote-server.ts', import.meta.url)
    const source = readFileSync(sourcePath, 'utf8')
    expect(source).toContain("import WebSocket, { WebSocketServer } from 'ws'")
    expect(source).not.toContain('.WebSocketServer ??')

    const result = await build({
      stdin: {
        contents: "import { WebSocketServer } from 'ws'; export default typeof WebSocketServer",
        resolveDir: process.cwd(),
        sourcefile: 'web-remote-ws-entry.ts',
      },
      platform: 'node',
      format: 'cjs',
      bundle: true,
      write: false,
      external: ['electron', '@earendil-works/pi-coding-agent', '@earendil-works/pi-agent-core', '@earendil-works/pi-ai', 'sharp'],
    })
    const output = result.outputFiles[0]
    if (!output) throw new Error('esbuild 未生成 bundle 输出')
    const outputPath = join(tmpdir(), `proma-web-remote-ws-${Date.now()}-${Math.random().toString(16).slice(2)}.cjs`)
    tempOutputs.push(outputPath)
    writeFileSync(outputPath, output.contents)

    const execution = spawnSync('node', ['-e', `process.stdout.write(String(require(${JSON.stringify(outputPath)}).default))`], { encoding: 'utf8' })
    expect(execution.status).toBe(0)
    expect(execution.stdout).toBe('function')
  })
})
