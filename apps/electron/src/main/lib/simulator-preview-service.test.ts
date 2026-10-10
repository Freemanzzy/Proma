import { describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildKillArgs, buildServeSimArgs, choosePort, cleanupSimulatorPreviewOnQuitWith, pickActiveDevice, readServeSimStreams, shouldRetryBundledServeSim, terminateOwnedChild } from './simulator-preview-service'

describe('simulator preview service helpers', () => {
  it('builds a pinned, loopback-only serve-sim command with fit and no panes', () => {
    expect(buildServeSimArgs('12345678-1234-1234-1234-123456789abc', 3201)).toEqual([
      '--yes', 'serve-sim@0.1.47', '--host', '127.0.0.1', '--port', '3201', '--fit', '--panes', 'none', '-q', '12345678-1234-1234-1234-123456789abc',
    ])
  })

  it('only builds --kill when an explicit simulator UDID is provided', () => {
    expect(buildKillArgs('12345678-1234-1234-1234-123456789abc')).toEqual(['--yes', 'serve-sim@0.1.47', '--kill', '12345678-1234-1234-1234-123456789abc'])
    expect(() => buildKillArgs('')).toThrow('必须指定模拟器 UDID')
  })

  it('selects the first available port from the configured range', async () => {
    const isAvailable = mock(async (port: number) => port === 3202)
    expect(await choosePort(isAvailable, 3200)).toBe(3202)
    expect(isAvailable.mock.calls.map(([port]) => port)).toEqual([3200, 3201, 3202])
  })

  it('retries a failed bundled serve-sim but never retries npx or a clean exit', () => {
    expect(shouldRetryBundledServeSim(true, 1, 'ERR_MODULE_NOT_FOUND: Cannot find package ws')).toBe(true)
    expect(shouldRetryBundledServeSim(true, 0, 'Cannot find package inspect-webkit')).toBe(true)
    expect(shouldRetryBundledServeSim(false, 1, 'Cannot find package ws')).toBe(false)
    expect(shouldRetryBundledServeSim(true, 0, '')).toBe(false)
  })

  it('does nothing on quit when no simulator child is owned', () => {
    const spawn = mock(() => { throw new Error('should not spawn') })
    const terminate = mock(() => undefined)
    const reset = mock(() => undefined)
    cleanupSimulatorPreviewOnQuitWith({ child: null, invocation: null, reset }, { spawn: spawn as never, terminate })
    expect(spawn).not.toHaveBeenCalled()
    expect(terminate).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
  })

  it('fires detached serve-sim cleanup, terminates the owned child, and resets quit state', () => {
    const udid = '12345678-1234-1234-1234-123456789abc'
    const kill = mock(() => true)
    const child = { pid: 321, exitCode: null, kill } as never
    const unref = mock(() => child)
    const once = mock(() => child)
    const cleanupProcess = { once, unref } as never
    const spawn = mock(() => cleanupProcess)
    const terminate = mock(() => undefined)
    const reset = mock(() => undefined)

    cleanupSimulatorPreviewOnQuitWith({
      child,
      invocation: { command: '/electron', scriptPath: '/serve-sim.js', env: { PATH: '/bin' } },
      udid,
      reset,
    }, { spawn: spawn as never, terminate })

    expect(spawn).toHaveBeenCalledWith('/electron', ['/serve-sim.js', '--kill', udid], {
      env: { PATH: '/bin' },
      detached: true,
      stdio: 'ignore',
    })
    expect(once).toHaveBeenCalledWith('error', expect.any(Function))
    expect(unref).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledWith(child)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('does not invoke npx for quit cleanup when the owned invocation lacks a bundled script', () => {
    const child = { pid: 321, exitCode: null, kill: mock(() => true) } as never
    const spawn = mock(() => { throw new Error('should not spawn') })
    const terminate = mock(() => undefined)
    const reset = mock(() => undefined)
    cleanupSimulatorPreviewOnQuitWith({
      child,
      invocation: { command: 'npx', env: {} },
      udid: '12345678-1234-1234-1234-123456789abc',
      reset,
    }, { spawn: spawn as never, terminate })
    expect(spawn).not.toHaveBeenCalled()
    expect(terminate).toHaveBeenCalledWith(child)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('falls back only by terminating the owned child PID', () => {
    const kill = mock(() => true)
    terminateOwnedChild({ pid: 123, exitCode: null, kill } as never)
    expect(kill).toHaveBeenCalledWith('SIGTERM')
    const exitedKill = mock(() => true)
    terminateOwnedChild({ pid: 123, exitCode: 0, kill: exitedKill } as never)
    expect(exitedKill).not.toHaveBeenCalled()
    terminateOwnedChild(null)
  })

  it('reads only the serve-sim streams owned by our PID', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-serve-sim-state-'))
    try {
      writeFileSync(join(dir, 'server-A.json'), JSON.stringify({ pid: 42, device: 'AAAA' }))
      writeFileSync(join(dir, 'server-B.json'), JSON.stringify({ pid: 42, device: 'BBBB' }))
      writeFileSync(join(dir, 'server-C.json'), JSON.stringify({ pid: 7, device: 'CCCC' }))
      writeFileSync(join(dir, 'server-bad.json'), '{')
      expect((await readServeSimStreams(42, dir)).sort()).toEqual(['AAAA', 'BBBB'])
      expect(await readServeSimStreams(42, join(dir, 'missing'))).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('follows the booted device when the launched one was switched away', () => {
    expect(pickActiveDevice('AIR', [{ udid: 'AIR', booted: false }, { udid: 'P17', booted: true }])).toBe('P17')
    expect(pickActiveDevice('AIR', [{ udid: 'AIR', booted: true }, { udid: 'P17', booted: true }])).toBe('AIR')
    expect(pickActiveDevice('AIR', [{ udid: 'AIR', booted: false }])).toBe('AIR')
  })
})
