import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { shouldUseJavaScriptRegexEngine } from './shiki-service.ts'

const SERVICE_PATH = join(import.meta.dir, 'shiki-service.ts')

/**
 * 在独立子进程中模拟 Web Remote 手机页的 CSP：禁止编译 WebAssembly，
 * 再初始化高亮器。子进程隔离模块单例与全局 WebAssembly 改动，不影响其他测试。
 */
function runUnderWasmBlockingCsp(webRemote: boolean): { ok: boolean; colors: number; error?: string } {
  const script = `
    const blocked = () => { throw new WebAssembly.CompileError('WebAssembly.instantiate(): Refused to compile or instantiate WebAssembly module because neither \\'wasm-eval\\' nor \\'unsafe-eval\\' is an allowed source of script') }
    WebAssembly.instantiate = async () => blocked()
    WebAssembly.instantiateStreaming = async () => blocked()
    WebAssembly.compile = async () => blocked()
    WebAssembly.Module = function () { blocked() }
    globalThis.__PROMA_WEB_REMOTE__ = ${webRemote ? 'true' : 'false'}
    const { highlightCode, highlightToTokens } = await import(${JSON.stringify(SERVICE_PATH)})
    try {
      await highlightCode({ code: 'const a = "x"', language: 'typescript' })
      const samples = [
        ['typescript', 'export const answer: number = 42 // note'],
        ['python', 'def greet(name):\\n    return f"hi {name}"'],
        ['shellscript', 'for f in *.md; do echo "$f"; done'],
        ['json', '{"key": [1, true, null]}'],
      ]
      const colors = new Set()
      for (const [language, code] of samples) {
        const result = highlightToTokens({ code, language })
        if (!result || result.language !== language) throw new Error('no tokens for ' + language)
        for (const line of result.lines) for (const token of line) if (token.color) colors.add(token.color)
      }
      console.log(JSON.stringify({ ok: true, colors: colors.size }))
    } catch (error) {
      console.log(JSON.stringify({ ok: false, colors: 0, error: String(error).slice(0, 200) }))
    }
  `
  const child = Bun.spawnSync([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe', timeout: 60_000 })
  const lines = child.stdout.toString().trim().split('\n')
  return JSON.parse(lines[lines.length - 1] || '{"ok":false,"colors":0,"error":"no output"}')
}

describe('shouldUseJavaScriptRegexEngine', () => {
  test('只在 Web Remote 标记为 true 时启用', () => {
    expect(shouldUseJavaScriptRegexEngine({ __PROMA_WEB_REMOTE__: true })).toBe(true)
    expect(shouldUseJavaScriptRegexEngine({ __PROMA_WEB_REMOTE__: 'true' })).toBe(false)
    expect(shouldUseJavaScriptRegexEngine({ __PROMA_WEB_REMOTE__: false })).toBe(false)
    expect(shouldUseJavaScriptRegexEngine({})).toBe(false)
    expect(shouldUseJavaScriptRegexEngine(null)).toBe(false)
    expect(shouldUseJavaScriptRegexEngine(undefined)).toBe(false)
  })
})

describe('禁止 WebAssembly 的 CSP 下初始化高亮器', () => {
  test('Web Remote 使用 JavaScript 正则引擎，代码块有多种语法颜色', () => {
    const result = runUnderWasmBlockingCsp(true)
    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.colors).toBeGreaterThanOrEqual(4)
  }, 70_000)

  test('对照：非 Web Remote 仍走 WebAssembly 引擎，在该 CSP 下初始化失败', () => {
    const result = runUnderWasmBlockingCsp(false)
    expect(result.ok).toBe(false)
    expect(result.error ?? '').toContain('WebAssembly')
  }, 70_000)
})
