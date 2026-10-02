import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Web Remote touch thinking control', () => {
  test('touch click opens the panel before any desktop toggle logic', () => {
    const source = readFileSync(join(import.meta.dir, 'AgentView.tsx'), 'utf8')
    const start = source.indexOf('const handleButtonClick = (): void => {')
    const end = source.indexOf('\n  }', start)
    const handler = source.slice(start, end)
    const touchBranch = handler.indexOf('isWebRemoteFullUi() && (navigator.maxTouchPoints > 0 || window.matchMedia?.(\'(pointer: coarse)\').matches)')
    expect(touchBranch).toBeGreaterThanOrEqual(0)
    expect(handler.indexOf('setOpen(true)', touchBranch)).toBeGreaterThan(touchBranch)
    expect(handler.indexOf('return', touchBranch)).toBeGreaterThan(handler.indexOf('setOpen(true)', touchBranch))
    expect(handler.indexOf('if (codexConfig)')).toBeGreaterThan(handler.indexOf('return', touchBranch))
    expect(handler).toContain("codexConfig.onThinkingLevelChange(isEnabled ? 'off' : 'high')")
    expect(handler).toContain('onToggle()')
  })
})
