import { describe, expect, it } from 'bun:test'
import { canToggleDesktopMirror, cleanDesktopMirrorText, shouldMirrorDesktopRun } from './desktop-mirror'

describe('Feishu desktop mirroring policy', () => {
  it('only mirrors opted-in Feishu bindings for desktop-origin runs', () => {
    expect(shouldMirrorDesktopRun({ source: 'feishu', mirrorDesktopRuns: true }, 'desktop')).toBe(true)
    expect(shouldMirrorDesktopRun({ source: 'feishu' }, 'desktop')).toBe(false)
    expect(shouldMirrorDesktopRun({ source: 'session-mirror', mirrorDesktopRuns: true }, 'desktop')).toBe(false)
    expect(shouldMirrorDesktopRun({ source: 'feishu', mirrorDesktopRuns: true }, 'feishu')).toBe(false)
  })

  it('removes reference markers and truncates without exposing paths', () => {
    expect(cleanDesktopMirrorText('Read @file:%2FUsers%2Fme%2Fsecret.pdf and &session:abc::label #mcp:drive /skill:test')).toBe('Read and')
    expect(cleanDesktopMirrorText('x'.repeat(2_010))).toHaveLength(2_000)
  })

  it('allows only the bound user to toggle', () => {
    expect(canToggleDesktopMirror({ userId: 'ou_owner' }, 'ou_owner')).toBe(true)
    expect(canToggleDesktopMirror({ userId: 'ou_owner' }, 'ou_other')).toBe(false)
    expect(canToggleDesktopMirror(undefined, 'ou_owner')).toBe(false)
  })
})
