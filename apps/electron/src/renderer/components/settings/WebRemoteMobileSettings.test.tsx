import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WebRemoteMobileSettings } from './WebRemoteMobileSettings'

describe('WebRemoteMobileSettings', () => {
  test('hides the desktop-only admin partition in the web remote renderer', () => {
    const previous = globalThis.window
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { __PROMA_WEB_REMOTE__: true } })
    try {
      const html = renderToStaticMarkup(<WebRemoteMobileSettings />)
      expect(html).not.toContain('手机访问')
      expect(html).toContain('hidden')
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previous })
    }
  })

  test('renders the settings partition in the local desktop renderer', () => {
    const previous = globalThis.window
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { __PROMA_WEB_REMOTE__: false } })
    try {
      const html = renderToStaticMarkup(<WebRemoteMobileSettings />)
      expect(html).toContain('手机访问')
      expect(html).toContain('正在读取手机访问设置')
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previous })
    }
  })
})
