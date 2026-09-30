import { expect, test } from 'bun:test'
import { evaluateHarnessExceptionWindow, isHttp429Signal, measureHarnessExceptionWindow, resolveHarnessNetworkProfile, waitForHarnessExceptionQuietPeriod } from './mobile-harness.mjs'

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

test('baseline exceptions do not fail but any same-category action exception does', () => {
  const wasmCsp = { description: 'WebAssembly.instantiate blocked by unsafe-eval script-src' }
  const noNewException = evaluateHarnessExceptionWindow([wasmCsp], 1)
  expect(noNewException.passed).toBe(true)
  expect(noNewException.newActionExceptions).toBe(0)
  const repeatedWasmDuringAction = evaluateHarnessExceptionWindow([wasmCsp, wasmCsp], 1)
  expect(repeatedWasmDuringAction.passed).toBe(false)
  expect(repeatedWasmDuringAction.newActionExceptions).toBe(1)
  expect(repeatedWasmDuringAction.actionCategories).toEqual(['WebAssembly.instantiate blocked by current script-src CSP'])
})

test('delayed initialization exceptions settle before the action baseline is captured', async () => {
  const harness = { exceptions: [{ description: 'startup exception' }] }
  setTimeout(() => harness.exceptions.push({ description: 'late startup exception' }), 30)
  const baseline = await waitForHarnessExceptionQuietPeriod(harness, 30, 300)
  expect(baseline.baselineCount).toBe(2)
  expect(baseline.settledAfterMs).toBeGreaterThanOrEqual(100)
})

test('429 detection only accepts HTTP status fields or explicit status/error phrases', () => {
  expect(isHttp429Signal({ status: 429 })).toBe(true)
  expect(isHttp429Signal({ response: { status: '429' } })).toBe(true)
  expect(isHttp429Signal('HTTP 429')).toBe(true)
  expect(isHttp429Signal('status: 429')).toBe(true)
  expect(isHttp429Signal('429 Too Many Requests')).toBe(true)
  expect(isHttp429Signal('test session id 1381ced4-7e4f-4291-abcd')).toBe(false)
  expect(isHttp429Signal(429)).toBe(false)
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
