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

interface MobilePatchHarnessOptions {
  search?: string
  location?: { pathname: string; search: string; reload(): void }
  history?: { replaceState(state: unknown, title: string, path: string): void }
}

const mobilePatchPrototypeRestorers: Array<() => void> = []

function restoreDescriptor(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(target, key, descriptor)
  else Reflect.deleteProperty(target, key)
}

function createMobilePatchHarness(
  navigatorMock: { maxTouchPoints: number; userAgent: string } = { maxTouchPoints: 5, userAgent: 'Android' },
  options: MobilePatchHarnessOptions = {},
) {
  ManualMutationObserver.instances = []
  const { window, document } = parseHTML(`<!doctype html><html><body>
    <div data-web-remote-sidebar="left"></div>
    <main data-web-remote-main="true"></main>
    <section data-web-remote-panel="right"><div role="tablist" aria-label="右侧工作区"><div><button role="tab" aria-selected="true">文件</button></div></div></section>
  </body></html>`)
  const elementPrototype = window.Element.prototype
  const nodePrototype = window.Node.prototype
  const originalDescriptors = {
    innerText: Object.getOwnPropertyDescriptor(elementPrototype, 'innerText'),
    innerHTML: Object.getOwnPropertyDescriptor(elementPrototype, 'innerHTML'),
    replaceChildren: Object.getOwnPropertyDescriptor(elementPrototype, 'replaceChildren'),
    insertBefore: Object.getOwnPropertyDescriptor(nodePrototype, 'insertBefore'),
  }
  mobilePatchPrototypeRestorers.push(() => {
    restoreDescriptor(elementPrototype, 'innerText', originalDescriptors.innerText)
    restoreDescriptor(elementPrototype, 'innerHTML', originalDescriptors.innerHTML)
    restoreDescriptor(elementPrototype, 'replaceChildren', originalDescriptors.replaceChildren)
    restoreDescriptor(nodePrototype, 'insertBefore', originalDescriptors.insertBefore)
  })
  for (const key of ['__PROMA_PUSH_PRESENCE_INSTALLED', '__PROMA_WEB_REMOTE_HISTORY_META']) {
    try { delete (window as any)[key] } catch {}
  }
  Object.defineProperty(window, 'innerWidth', { value: 412, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 915, configurable: true })
  Object.defineProperty(window, 'screen', { value: { width: 412 }, configurable: true })
  Object.defineProperty(window, 'visualViewport', { value: null, configurable: true })
  const pendingTimeouts: Array<() => void> = []
  const pendingIntervals: Array<() => void> = []
  const fakeSetTimeout = (callback: () => void) => { pendingTimeouts.push(callback); return pendingTimeouts.length }
  const fakeClearTimeout = () => {}
  const fakeSetInterval = (callback: () => void) => { pendingIntervals.push(callback); return pendingIntervals.length }
  const fakeClearInterval = () => {}
  ;(window as any).setTimeout = fakeSetTimeout
  ;(window as any).clearTimeout = fakeClearTimeout
  ;(window as any).setInterval = fakeSetInterval
  ;(window as any).clearInterval = fakeClearInterval
  ;(window as any).requestAnimationFrame = (callback: FrameRequestCallback) => callback(0)
  const location = options.location ?? { pathname: '/app/', search: options.search ?? '', reload() {} }
  const history = options.history ?? { replaceState: (_state: unknown, _title: string, path: string) => { location.pathname = path; location.search = '' } }
  Object.defineProperty(window, 'location', { configurable: true, value: location })
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
  const fetchRequests: Array<{ url: string; options?: unknown }> = []
  const fetchMock = (input: string | URL, options?: unknown) => {
    fetchRequests.push({ url: String(input), options })
    return subscriptionResponse
  }
  const html = renderWebRemoteMobilePatch()
  const script = html.match(/<script nonce="__PROMA_NONCE__">([\s\S]*?)<\/script>/)?.[1]
  if (!script) throw new Error('mobile patch script not found')
  const run = new Function('window', 'document', 'MutationObserver', 'HTMLElement', 'Element', 'NodeFilter', 'fetch', 'navigator', 'location', 'history', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', script)
  run(window, document, ManualMutationObserver, window.HTMLElement, window.Element, window.NodeFilter, fetchMock, navigatorMock, location, history, fakeSetTimeout, fakeSetInterval, fakeClearTimeout, fakeClearInterval)
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
  const flushNextTimeout = () => pendingTimeouts.shift()?.()
  return { window, document, location, history, writes, observers: [ensureObserver, syncRightObserver, syncMenuObserver], resolveSubscription, fetchRequests, flushTimeouts, flushNextTimeout, flushIntervals: () => pendingIntervals.forEach((callback) => callback()), pendingTimeoutCount: () => pendingTimeouts.length }
}

describe('renderWebRemoteMobilePatch DOM write convergence', () => {
  afterEach(() => {
    for (const restore of mobilePatchPrototypeRestorers.splice(0).reverse()) restore()
    ManualMutationObserver.instances = []
  })

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

  test('大图占位可点按加载，显示加载状态后替换为缓存原图', async () => {
    const { window, document, observers } = createMobilePatchHarness()
    const image = document.createElement('img')
    image.setAttribute('src', 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E#proma-web-remote-large-image=781')
    document.body.appendChild(image)
    let reads = 0
    ;(window as any).__PROMA_WEB_REMOTE_LOAD_LARGE_IMAGE = async (id: string) => {
      expect(id).toBe('781')
      reads += 1
      return 'data:image/png;base64,aW1hZ2U='
    }
    observers[0]!.trigger()
    const button = document.querySelector<HTMLButtonElement>('[data-web-remote-large-image-button="781"]')!
    expect(button.textContent).toBe('图片较大（>8 MB），点按加载原图')
    expect(image.hidden).toBe(true)
    const loading = button.dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(button.textContent).toBe('正在加载…')
    await Promise.resolve()
    await Promise.resolve()
    expect(image.getAttribute('src')).toBe('data:image/png;base64,aW1hZ2U=')
    expect(image.hidden).toBe(false)
    expect(document.querySelector('[data-web-remote-large-image-button="781"]')).toBeNull()
    expect(reads).toBe(1)
    void loading
  })

  test('大图读取失败时显示无法读取并允许重试', async () => {
    const { window, document, observers } = createMobilePatchHarness()
    const image = document.createElement('img')
    image.setAttribute('src', 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E#proma-web-remote-large-image=782')
    document.body.appendChild(image)
    ;(window as any).__PROMA_WEB_REMOTE_LOAD_LARGE_IMAGE = async () => { throw new Error('offline') }
    observers[0]!.trigger()
    const button = document.querySelector<HTMLButtonElement>('[data-web-remote-large-image-button="782"]')!
    button.dispatchEvent(new window.Event('click', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(button.textContent).toBe('图片无法读取，点按重试')
    expect(button.disabled).toBe(false)
    expect(image.hidden).toBe(true)
  })

  test('点击侧栏子任务后打开右侧抽屉并可关闭', () => {
    const { window, document, observers } = createMobilePatchHarness()
    const sidebar = document.querySelector<HTMLElement>('[data-web-remote-sidebar="left"]')!
    const child = document.createElement('div')
    child.dataset.webRemoteDelegationChild = 'true'
    child.dataset.sessionSwitchId = 'child-session'
    child.dataset.sessionSwitchType = 'agent'
    child.setAttribute('role', 'button')
    child.textContent = '子任务内容入口'
    sidebar.appendChild(child)
    const tabList = document.querySelector('[data-web-remote-panel="right"] [role="tablist"]')!
    tabList.querySelectorAll('[role="tab"]').forEach((tab) => tab.setAttribute('aria-selected', 'false'))
    const tasks = document.createElement('button')
    tasks.setAttribute('role', 'tab')
    tasks.dataset.webRemoteDelegationTab = 'true'
    tasks.setAttribute('aria-selected', 'false')
    tasks.textContent = 'Proma 个人版 Fork：阶段一+二（Luna 执行）'
    const files = document.createElement('button')
    files.setAttribute('role', 'tab')
    files.setAttribute('aria-selected', 'true')
    files.textContent = '文件'
    tabList.append(tasks, files)
    const panelContent = document.createElement('div')
    panelContent.dataset.webRemoteDelegationContent = 'true'
    panelContent.textContent = '协作子任务输出'
    document.querySelector('[data-web-remote-panel="right"]')!.appendChild(panelContent)

    child.dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(document.body.dataset.webRemoteRightOpen).toBeUndefined()
    expect(document.body.dataset.webRemotePendingDelegationOpen).toBe('true')
    tasks.setAttribute('aria-selected', 'true')
    files.setAttribute('aria-selected', 'false')
    expect(document.querySelector('[data-web-remote-panel="right"] [role="tab"][data-web-remote-delegation-tab="true"][aria-selected="true"]')?.textContent).toBe('Proma 个人版 Fork：阶段一+二（Luna 执行）')
    observers[0]!.trigger()
    expect(document.body.dataset.webRemoteRightOpen).toBe('true')
    expect(panelContent.textContent).toContain('协作子任务输出')
    const toggle = document.querySelector<HTMLButtonElement>('[data-web-remote-panel-toggle]')!
    toggle.dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(document.body.dataset.webRemoteRightOpen).toBeUndefined()
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

  test('presence fallback只查 active 列表，5秒心跳复用同一标题/当前会话的解析结果', () => {
    const source = renderWebRemoteMobilePatch()
    expect(source).toContain('var presenceSession=null; var presenceLookup=null; var presenceResolved=false; var presenceResolvedKey=\'\'; var presenceLookupKey=\'\';')
    expect(source).toContain('window.electronAPI?.listActiveAgentSessions?.()')
    expect(source).not.toContain('window.electronAPI?.listAgentSessions?.()')
    expect(source).toContain('var lookup=!presenceResolved||lookupKey!==presenceResolvedKey;')
    expect(source).toContain('window.setInterval(function(){reportPresence()},5000)')
  })

  test('presence prefers HISTORY_META.sessionId and makes no session-list request', async () => {
    const { window, document, fetchRequests, flushIntervals } = createMobilePatchHarness()
    let fullListCalls = 0
    let activeListCalls = 0
    ;(window as any).__PROMA_WEB_REMOTE_HISTORY_META = { sessionId: 'history-session' }
    ;(window as any).electronAPI = {
      listAgentSessions: async () => { fullListCalls++; return [] },
      listActiveAgentSessions: async () => { activeListCalls++; return [] },
    }
    const title = document.createElement('button')
    title.setAttribute('aria-label', '会话菜单：History Session')
    document.body.appendChild(title)
    flushIntervals()
    await Bun.sleep(0)
    expect(fullListCalls).toBe(0)
    expect(activeListCalls).toBe(0)
    const request = fetchRequests.find((item) => item.url === '/api/push/presence')
    expect(JSON.parse(String((request?.options as { body?: string })?.body))).toMatchObject({ sessionId: 'history-session' })
  })

  test('presence 解析在无当前 session ID 时只回退到 active 列表', async () => {
    const { window, document, fetchRequests, flushIntervals } = createMobilePatchHarness()
    let fullListCalls = 0
    let activeListCalls = 0
    ;(window as any).electronAPI = {
      listAgentSessions: async () => { fullListCalls++; return [{ id: 'full-only', title: 'Presence Session' }] },
      listActiveAgentSessions: async () => { activeListCalls++; return [{ id: 'active-session', title: 'Presence Session' }] },
    }
    const title = document.createElement('button')
    title.setAttribute('aria-label', '会话菜单：Presence Session')
    document.body.appendChild(title)
    flushIntervals()
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(fullListCalls).toBe(0)
    expect(activeListCalls).toBe(1)
    const request = fetchRequests.find((item) => item.url === '/api/push/presence')
    expect(JSON.parse(String((request?.options as { body?: string })?.body))).toMatchObject({ sessionId: 'active-session' })
  })

  test('通知 deep-link 按指定 ID 查 active 列表一次并使用完整标题选会话', async () => {
    const { window, document, location, flushNextTimeout } = createMobilePatchHarness(
      { maxTouchPoints: 5, userAgent: 'Android' },
      { search: '?session=deep-session' },
    )
    let activeCalls = 0
    let fullCalls = 0
    let targetClicks = 0
    ;(window as any).electronAPI = {
      listActiveAgentSessions: async () => { activeCalls++; return [{ id: 'deep-session', title: 'Deep link target' }] },
      listAgentSessions: async () => { fullCalls++; return [{ id: 'wrong-full-list', title: 'Deep link target' }] },
    }
    const target = document.createElement('button')
    target.textContent = 'Deep link target'
    target.addEventListener('click', () => { targetClicks++ })
    document.querySelector('[data-web-remote-sidebar="left"]')!.appendChild(target)

    flushNextTimeout()
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(activeCalls).toBe(1)
    expect(fullCalls).toBe(0)
    expect(targetClicks).toBe(1)
    expect(location.search).toBe('')
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
