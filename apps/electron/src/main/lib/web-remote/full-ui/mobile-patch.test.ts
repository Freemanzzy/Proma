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

function createMobilePatchHarness(navigatorMock: { maxTouchPoints: number; userAgent: string } = { maxTouchPoints: 5, userAgent: 'Android' }) {
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
  const pendingTimeouts: Array<() => void> = []
  ;(window as any).setTimeout = (callback: () => void) => { pendingTimeouts.push(callback); return pendingTimeouts.length }
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
  const run = new Function('window', 'document', 'MutationObserver', 'HTMLElement', 'Element', 'NodeFilter', 'fetch', 'navigator', script)
  run(window, document, ManualMutationObserver, window.HTMLElement, window.Element, window.NodeFilter, fetchMock, navigatorMock)
  const ensureObserver = ManualMutationObserver.instances[0]
  const syncRightObserver = ManualMutationObserver.instances[1]
  const syncMenuObserver = ManualMutationObserver.instances[2]
  if (!ensureObserver || !syncRightObserver || !syncMenuObserver) throw new Error('expected ensure and state observers')
  const title = document.querySelector<HTMLButtonElement>('[data-web-remote-mobile-topbar-title]')!
  title.dispatchEvent(new window.Event('click', { bubbles: true }))
  const flushTimeouts = () => {
    let guard = 0
    while (pendingTimeouts.length > 0 && guard++ < 100) pendingTimeouts.shift()?.()
  }
  return { window, document, writes, observers: [ensureObserver, syncRightObserver, syncMenuObserver], resolveSubscription, flushTimeouts, pendingTimeoutCount: () => pendingTimeouts.length }
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

  test('侧栏内只有活跃会话/模式状态变化才关闭抽屉', () => {
    const { window, document, flushTimeouts, pendingTimeoutCount } = createMobilePatchHarness()
    const sidebar = document.querySelector<HTMLElement>('[data-web-remote-sidebar="left"]')!
    const body = document.body
    const current = document.createElement('div')
    current.dataset.sessionSwitchId = 'session-a'
    current.dataset.sessionSwitchType = 'agent'
    current.classList.add('agent-session-item-active')
    const arrow = document.createElement('button')
    arrow.type = 'button'
    arrow.setAttribute('aria-expanded', 'false')
    arrow.addEventListener('click', () => arrow.setAttribute('aria-expanded', 'true'))
    current.appendChild(arrow)
    const moreItem = document.createElement('button')
    moreItem.setAttribute('role', 'menuitem')
    moreItem.textContent = '重命名'
    moreItem.addEventListener('click', () => current.dataset.sessionSwitchTitle = 'renamed')
    current.appendChild(moreItem)
    const groupToggle = document.createElement('button')
    groupToggle.setAttribute('aria-expanded', 'true')
    groupToggle.addEventListener('click', () => current.classList.remove('agent-session-item-active'))
    const next = document.createElement('div')
    next.dataset.sessionSwitchId = 'session-b'
    next.dataset.sessionSwitchType = 'agent'
    next.addEventListener('click', () => window.setTimeout(() => {
      current.classList.remove('agent-session-item-active')
      next.classList.add('agent-session-item-active')
    }, 0))
    sidebar.append(groupToggle, current, next)

    body.dataset.webRemoteSidebarOpen = 'true'
    arrow.dispatchEvent(new window.Event('click', { bubbles: true }))
    flushTimeouts()
    expect(body.dataset.webRemoteSidebarOpen).toBe('true')
    expect(arrow.getAttribute('aria-expanded')).toBe('true')
    moreItem.dispatchEvent(new window.Event('click', { bubbles: true }))
    flushTimeouts()
    expect(body.dataset.webRemoteSidebarOpen).toBe('true')
    groupToggle.dispatchEvent(new window.Event('click', { bubbles: true }))
    flushTimeouts()
    expect(body.dataset.webRemoteSidebarOpen).toBe('true')
    current.classList.add('agent-session-item-active')

    expect(next.closest('[data-web-remote-sidebar="left"]')).toBe(sidebar)
    const pendingBeforeSessionClick = pendingTimeoutCount()
    next.dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(pendingTimeoutCount()).toBeGreaterThan(pendingBeforeSessionClick)
    flushTimeouts()
    expect(sidebar.querySelector('[data-session-switch-id].agent-session-item-active')?.getAttribute('data-session-switch-id')).toBe('session-b')
    expect(body.dataset.webRemoteSidebarOpen).toBeUndefined()

    const agentMode = document.createElement('button')
    agentMode.setAttribute('aria-label', '切换到 Agent 模式（悬停查看项目）')
    const agentIcon = document.createElement('span')
    agentIcon.classList.add('bg-primary/10')
    agentMode.appendChild(agentIcon)
    const chatMode = document.createElement('button')
    chatMode.setAttribute('aria-label', '切换到 Chat 模式')
    const chatIcon = document.createElement('span')
    chatMode.appendChild(chatIcon)
    sidebar.append(agentMode, chatMode)
    agentMode.addEventListener('click', () => window.setTimeout(() => { agentIcon.classList.remove('bg-primary/10'); chatIcon.classList.add('bg-primary/10') }, 0))
    body.dataset.webRemoteSidebarOpen = 'true'
    agentMode.dispatchEvent(new window.Event('click', { bubbles: true }))
    flushTimeouts()
    expect(body.dataset.webRemoteSidebarOpen).toBeUndefined()
  })

  test('触屏切换会话导致的程序焦点会 blur，用户触摸输入框后的焦点保留', () => {
    const { window, document } = createMobilePatchHarness({ maxTouchPoints: 5, userAgent: 'Android' })
    const sessionRow = document.createElement('button')
    sessionRow.dataset.sessionSwitchId = 'session-next'
    sessionRow.textContent = '下一会话'
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    let blurCount = 0
    Object.defineProperty(editor, 'blur', { configurable: true, value: () => { blurCount++ } })
    document.body.append(sessionRow, editor)

    sessionRow.dispatchEvent(new window.Event('touchstart', { bubbles: true }))
    editor.dispatchEvent(new window.Event('focusin', { bubbles: true }))
    expect(blurCount).toBe(1)

    editor.dispatchEvent(new window.Event('touchstart', { bubbles: true }))
    editor.dispatchEvent(new window.Event('focusin', { bubbles: true }))
    expect(blurCount).toBe(1)
    expect(document.documentElement.dataset.webRemoteFocusGuard).toBe('installed')
  })

  test('presence 定时心跳不再调用全量列表，解析后复用当前 session id', () => {
    const source = renderWebRemoteMobilePatch()
    expect(source).toContain('var presenceSession=null; var presenceTitle=\'\'; var presenceLookup=null; var presenceResolved=false;')
    expect(source).toContain('var lookup=forceLookup||titleText!==presenceTitle||!presenceResolved;')
    expect(source).toContain('window.setInterval(function(){reportPresence(false)},5000)')
    expect(source).not.toContain('window.setInterval(reportPresence,5000)')
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
