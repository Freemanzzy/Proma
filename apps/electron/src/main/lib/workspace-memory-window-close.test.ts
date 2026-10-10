import { describe, expect, test } from 'bun:test'
import { shouldInterceptWorkspaceMemoryClose } from './workspace-memory-window-close'

describe('workspace memory window close guard', () => {
  test('allows close without renderer confirmation while the application is quitting', () => {
    expect(shouldInterceptWorkspaceMemoryClose({ isQuitting: true, approved: false, rendererReady: true, webContentsDestroyed: false })).toBe(false)
  })

  test('continues to request renderer confirmation for a normal dirty-capable close', () => {
    expect(shouldInterceptWorkspaceMemoryClose({ isQuitting: false, approved: false, rendererReady: true, webContentsDestroyed: false })).toBe(true)
  })
})
