import { afterEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { renderWebRemoteMobilePatch } from './mobile-patch'

type ObserverCallback = (records: unknown[], observer: MutationObserver) => void

class ManualMutationObserver {
  static instances: ManualMutationObserver[] = []
  callback: ObserverCallback
  constructor(callback: ObserverCallback) {
    this.callback = callback
    ManualMutationObserver.instances.push(this)
  }
  observe() {}
  disconnect() {}
  takeRecords() { return [] }
  trigger() { this.callback([], this as unknown as MutationObserver) }
}

function createMobilePatchHarness() {
  ManualMutationObserver.instances = []
  const { window, document } = parseHTML(`<!doctype html><html><body>
    <div data-web-remote-sidebar="left"></div>
    <main data-web-remote-main="true"></main>
    <section data-web-remote-panel="right"><div role="tablist" aria-label="右侧工作区"><div><button role="tab" aria-selected="true">文件</button></div></div></section>
  </body></html>`)
  Object.defineProperty(window, 'innerWidth', { value: 412, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 915, configurable: true })
  Object.defineProperty(window, 'screen', { value: { width: 412 }, configurable: true })
  Object.defineProperty(window, 'visualViewport', { value: null, configurable: true })
  ;(window as any).setTimeout = () => 1
  ;(window as any).clearTimeout = () => {}
  ;(window as any).setInterval = () => 1
  ;(window as any).requestAnimationFrame = (callback: FrameRequestCallback) => callback(0)
  ;(window as any).location = { pathname: '/app/', search: '', reload() {} }
  Object.defineProperty(window.Element.prototype, 'innerText', {
    configurable: true,
    get(this: Element) { return this.textContent ?? '' },
  })

  const writes = new Map<string, number>()
  const bump = (key: string) => writes.set(key, (writes.get(key) ?? 0) + 1)
  const innerHTML = Object.getOwnPropertyDescriptor(window.Element.prototype, 'innerHTML')!
  Object.defineProperty(window.Element.prototype, 'innerHTML', {
    configurable: true,
    get: innerHTML.get,
    set(this: Element, value: string) {
      const marker = this.getAttributeNames().find((name) => name.startsWith('data-web-remote-')) ?? this.tagName.toLowerCase()
      bump(`${marker}:innerHTML`)
      innerHTML.set!.call(this, value)
    },
  })
  const replaceChildren = window.Element.prototype.replaceChildren
  window.Element.prototype.replaceChildren = function (...nodes: (Node | string)[]) {
    const marker = this.getAttributeNames().find((name) => name.startsWith('data-web-remote-')) ?? this.tagName.toLowerCase()
    bump(`${marker}:replaceChildren`)
    return replaceChildren.apply(this, nodes)
  }
  const insertBefore = window.Node.prototype.insertBefore
  window.Node.prototype.insertBefore = function <T extends Node>(node: T, child: Node | null): T {
    const marker = (this as Element).getAttributeNames?.().find((name) => name.startsWith('data-web-remote-')) ?? (this as Element).tagName?.toLowerCase() ?? 'document'
    bump(`${marker}:insertBefore`)
    return insertBefore.call(this, node, child) as T
  }

  ;(window as any).Notification = { permission: 'granted' }
  let resolveSubscription!: (response: { ok: boolean; json: () => Promise<{ subscribed: boolean }> }) => void
  const subscriptionResponse = new Promise<{ ok: boolean; json: () => Promise<{ subscribed: boolean }> }>((resolve) => { resolveSubscription = resolve })
  const fetchMock = () => subscriptionResponse
  const html = renderWebRemoteMobilePatch()
  const script = html.match(/<script nonce="__PROMA_NONCE__">([\s\S]*?)<\/script>/)?.[1]
  if (!script) throw new Error('mobile patch script not found')
  const run = new Function('window', 'document', 'MutationObserver', 'HTMLElement', 'Element', 'NodeFilter', 'fetch', script)
  run(window, document, ManualMutationObserver, window.HTMLElement, window.Element, window.NodeFilter, fetchMock)
  const ensureObserver = ManualMutationObserver.instances[0]
  const syncRightObserver = ManualMutationObserver.instances[1]
  const syncMenuObserver = ManualMutationObserver.instances[2]
  if (!ensureObserver || !syncRightObserver || !syncMenuObserver) throw new Error('expected ensure and state observers')
  const title = document.querySelector<HTMLButtonElement>('[data-web-remote-mobile-topbar-title]')!
  title.dispatchEvent(new window.Event('click', { bubbles: true }))
  return { window, document, writes, observers: [ensureObserver, syncRightObserver, syncMenuObserver], resolveSubscription }
}

describe('renderWebRemoteMobilePatch DOM write convergence', () => {
  afterEach(() => { ManualMutationObserver.instances = [] })

  test('媒体占位点击后原位显示图片，长文本点击后原位展开', async () => {
    const { window, document, observers } = createMobilePatchHarness()
    const mediaPayload = Buffer.from(JSON.stringify({ sessionId: 's', uuid: 'u', index: 0, messageHash: 'h', path: ['content', 0], mime: 'image/png', bytes: 300_000 })).toString('base64url')
    const textPayload = Buffer.from(JSON.stringify({ sessionId: 's', uuid: 'u', index: 0, messageHash: 'h', path: ['content', 1], bytes: 40_000, hash: 't' })).toString('base64url')
    const text = document.createElement('p'); text.textContent = `before [[proma-web-remote-media:${mediaPayload}]][图片 · 293.0 KB · 点按加载] and [[proma-web-remote-text:${textPayload}]][内容已截断] after`; document.body.appendChild(text)
    ;(window as any).__PROMA_WEB_REMOTE_INVOKE = async (channel: string, payload: { kind?: string }) => payload.kind === 'text' ? { text: 'expanded original text' } : { mime: 'image/png', data: 'aW1hZ2U=' }
    observers[0]!.trigger()
    const mediaButton = document.querySelector<HTMLButtonElement>('[data-media-kind="media"] button')
    const textButton = document.querySelector<HTMLButtonElement>('[data-media-kind="text"] button')
    expect(mediaButton?.textContent).toContain('图片 · 293.0 KB · 点按加载')
    expect(textButton?.textContent).toContain('点按查看完整内容（原文 39.1 KB）')
    expect(document.querySelectorAll('[data-web-remote-history-media]')).toHaveLength(2)
  })

  test('无法解析的媒体标记被替换为提示文本，不会在 observer 中反复处理', async () => {
    const { document, observers } = createMobilePatchHarness()
    const text = document.createElement('p'); text.textContent = 'x [[proma-web-remote-media:not_json]] y'; document.body.appendChild(text)
    for (let index = 0; index < 5; index++) observers[0]!.trigger()
    expect(document.body.textContent).not.toContain('[[proma-web-remote-')
    expect(document.body.textContent).toContain('图片标记无法解析')
  })

  test('repeated ensure/sync callbacks stop writing toolbar icons, notification, title, dropdown, and layout', async () => {
    const { document, writes, observers, resolveSubscription } = createMobilePatchHarness()
    resolveSubscription({ ok: true, json: async () => ({ subscribed: true }) })
    await Bun.sleep(0)
    expect(document.querySelector('[data-web-remote-notification-entry]')?.getAttribute('aria-label')).toBe('通知已开启')
    const before = new Map(writes)
    for (let index = 0; index < 100; index++) {
      observers[0]!.trigger()
      observers[1]!.trigger()
      observers[2]!.trigger()
    }
    expect(Object.fromEntries(writes)).toEqual(Object.fromEntries(before))
    expect(writes.get('data-web-remote-refresh:innerHTML')).toBe(1)
    expect(writes.get('data-web-remote-panel-toggle:innerHTML')).toBe(2)
    expect(writes.get('data-web-remote-mobile-menu:innerHTML')).toBe(1)
    expect(writes.get('data-web-remote-notification-entry:innerHTML')).toBe(2)
    expect(writes.get('data-web-remote-mobile-topbar-title:replaceChildren')).toBe(1)
    expect(writes.get('data-web-remote-mobile-tab-menu:replaceChildren')).toBe(1)
  })
})
