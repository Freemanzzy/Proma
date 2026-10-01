import { describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { renderWebRemoteMobilePatch } from './mobile-patch'

class StubMutationObserver {
  constructor(_callback: MutationCallback) {}
  observe(): void {}
  disconnect(): void {}
  takeRecords(): MutationRecord[] { return [] }
}

describe('mobile presence deep-link lookup', () => {
  test('?session uses one active-list lookup to obtain the session title, never the full list', async () => {
    const { window, document } = parseHTML(`<!doctype html><html><body>
      <div data-web-remote-sidebar="left"><button data-session-switch-id="deep-session" data-session-switch-type="agent" class="agent-session-item-active">Deep link target</button></div>
      <main data-web-remote-main="true"></main>
      <section data-web-remote-panel="right"></section>
    </body></html>`)
    Object.defineProperty(window, 'innerWidth', { value: 412, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 915, configurable: true })
    Object.defineProperty(window, 'screen', { value: { width: 412 }, configurable: true })
    Object.defineProperty(window, 'visualViewport', { value: null, configurable: true })
    Object.defineProperty(window.Element.prototype, 'innerText', {
      configurable: true,
      get(this: Element) { return this.textContent ?? '' },
    })
    const location = { pathname: '/app/', search: '?session=deep-session', reload() {} }
    Object.defineProperty(window, 'location', { configurable: true, value: location })
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'denied' } })
    const pendingTimeouts: Array<() => void> = []
    const timeout = (callback: () => void): number => { pendingTimeouts.push(callback); return pendingTimeouts.length }
    ;(window as any).setTimeout = timeout
    ;(window as any).clearTimeout = () => {}
    ;(window as any).setInterval = () => 1
    ;(window as any).requestAnimationFrame = (callback: FrameRequestCallback) => callback(0)
    const history = { replaceState: (_state: unknown, _title: string, path: string) => { location.pathname = path; location.search = '' } }
    let activeCalls = 0
    let fullCalls = 0
    let targetClicks = 0
    ;(window as any).electronAPI = {
      listActiveAgentSessions: async () => { activeCalls++; return [{ id: 'deep-session', title: 'Deep link target' }] },
      listAgentSessions: async () => { fullCalls++; return [{ id: 'wrong-full-list', title: 'Deep link target' }] },
    }
    document.querySelector('button[data-session-switch-id]')?.addEventListener('click', () => { targetClicks++ })
    const script = renderWebRemoteMobilePatch().match(/<script nonce="__PROMA_NONCE__">([\s\S]*?)<\/script>/)?.[1]
    if (!script) throw new Error('mobile patch script not found')
    const run = new Function('window', 'document', 'MutationObserver', 'HTMLElement', 'Element', 'NodeFilter', 'fetch', 'navigator', 'location', 'history', 'setTimeout', script)
    run(window, document, StubMutationObserver, window.HTMLElement, window.Element, window.NodeFilter, async () => ({ ok: true }), { maxTouchPoints: 5, userAgent: 'Android' }, location, history, timeout)

    // The first timer is selectRequested(500ms); the later start retry is intentionally not flushed.
    pendingTimeouts.shift()?.()
    await Bun.sleep(0)
    await Bun.sleep(0)

    expect(activeCalls).toBe(1)
    expect(fullCalls).toBe(0)
    expect(targetClicks).toBe(1)
    expect(location.search).toBe('')
  })
})
