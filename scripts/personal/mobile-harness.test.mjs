import { expect, test } from 'bun:test'
import { measureHarnessExceptionWindow, resolveHarnessNetworkProfile } from './mobile-harness.mjs'

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

test('network profile defaults to 3/1 Mbps at 50 ms and allows an explicit 0.5 Mbps pressure run', () => {
  expect(resolveHarnessNetworkProfile()).toMatchObject({
    downloadMbps: 3,
    uploadMbps: 1,
    latencyMs: 50,
    downloadBitsPerSecond: 3_000_000,
    uploadBitsPerSecond: 1_000_000,
    downloadThroughput: 375_000,
    uploadThroughput: 125_000,
  })
  expect(resolveHarnessNetworkProfile({ downloadMbps: 0.5, uploadMbps: 1, latencyMs: 50 })).toMatchObject({
    downloadMbps: 0.5,
    downloadBitsPerSecond: 500_000,
    downloadThroughput: 62_500,
    connectionType: 'cellular2g',
  })
})
