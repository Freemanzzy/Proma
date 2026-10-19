import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, 'AgentHeader.tsx'), 'utf8')

function body(name: string): string {
  const start = source.indexOf(`const ${name} = React.useCallback(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('}, [', start)
  return source.slice(start, end)
}

describe('AgentHeader desktop rename focus', () => {
  test('desktop dropdown item uses the menu-aware entry, not the mobile synchronous-focus entry', () => {
    expect(source).toContain('<DropdownMenuItem onSelect={startMenuEdit}>')
    expect(source).not.toContain('<DropdownMenuItem onSelect={startEdit}>')
  })

  test('menu entry does not focus while the Radix menu is still open', () => {
    const menuEdit = body('startMenuEdit')
    expect(menuEdit).not.toContain('flushSync')
    expect(menuEdit).not.toMatch(/^\s*inputRef\.current\?\.focus\(\)/m)
    expect(menuEdit).toContain('menuEditPendingRef.current = true')
  })

  test('menu close hands focus to the title input instead of the hidden trigger', () => {
    const contentStart = source.indexOf('<DropdownMenuContent\n            align="start"')
    expect(contentStart).toBeGreaterThanOrEqual(0)
    const content = source.slice(contentStart, source.indexOf('<DropdownMenuItem onSelect={startMenuEdit}>', contentStart))
    expect(content).toContain('onCloseAutoFocus')
    expect(content).toContain('event.preventDefault()')
    expect(content).toContain('focusMenuEditInput()')
  })

  test('blur before the input is truly focused never saves (all platforms)', () => {
    const blurStart = source.indexOf('const handleInputBlur')
    const blur = source.slice(blurStart, source.indexOf('}\n', source.indexOf('requestAnimationFrame', blurStart)))
    expect(blur).toContain('if (!inputFocusReadyRef.current) return')
    expect(blur).not.toContain('isWebRemoteMobile && !inputFocusReadyRef.current')
  })
})
