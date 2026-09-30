import { expect, test } from 'bun:test'
import { measureHarnessExceptionWindow } from './mobile-harness.mjs'

test('only the pre-action prefix is baseline; later CSP and other exceptions remain failures', () => {
  const wasmCsp = {
    text: 'Uncaught (in promise)',
    description: 'CompileError: WebAssembly.instantiate() violates Content Security Policy: unsafe-eval blocked by script-src',
  }
  const other = { text: 'Uncaught', description: 'TypeError: renderer action failed' }
  const window = measureHarnessExceptionWindow([wasmCsp, wasmCsp, other], 1)

  expect(window.baselineCount).toBe(1)
  expect(window.baselineCategories).toEqual(['WebAssembly.instantiate blocked by current script-src CSP'])
  expect(window.actionCount).toBe(2)
  expect(window.actionCategories).toEqual([
    'WebAssembly.instantiate blocked by current script-src CSP',
    'TypeError: renderer action failed',
  ])
  expect(window.actionExceptions).toEqual([wasmCsp, other])
})
