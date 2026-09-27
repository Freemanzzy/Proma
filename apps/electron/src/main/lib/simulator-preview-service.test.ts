import { describe, expect, it, mock } from 'bun:test'
import { buildKillArgs, buildServeSimArgs, choosePort, terminateOwnedChild } from './simulator-preview-service'

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

  it('falls back only by terminating the owned child PID', () => {
    const kill = mock(() => true)
    terminateOwnedChild({ pid: 123, exitCode: null, kill } as never)
    expect(kill).toHaveBeenCalledWith('SIGTERM')
    const exitedKill = mock(() => true)
    terminateOwnedChild({ pid: 123, exitCode: 0, kill: exitedKill } as never)
    expect(exitedKill).not.toHaveBeenCalled()
    terminateOwnedChild(null)
  })
})
