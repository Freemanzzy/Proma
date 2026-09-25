#!/usr/bin/env node
/**
 * Reusable Android-sized CDP smoke harness for the full Web Remote UI.
 *
 * Usage:
 *   bun scripts/personal/mobile-harness.mjs --url https://example.ts.net --suite smoke
 *
 * The host and session title are intentionally supplied by arguments/environment;
 * no private hostname is embedded in this file.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const DEFAULT_OUTPUT_DIR = join(tmpdir(), 'proma-mobile-harness')
let activeChrome = null
let activeProfile = null
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'

function parseArgs(argv) {
  const result = { url: process.env.PROMA_WEB_REMOTE_URL ?? '', suite: 'smoke', session: process.env.PROMA_WEB_REMOTE_SESSION ?? '独立站/test', width: 412, height: 915, deviceScaleFactor: 3, outputDir: DEFAULT_OUTPUT_DIR, chromePath: process.env.CHROME_PATH ?? '', pairScript: join(REPO_ROOT, 'scripts/personal/web-remote.sh') }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => argv[++i]
    if (arg === '--url') result.url = value()
    else if (arg === '--suite') result.suite = value()
    else if (arg === '--session') result.session = value()
    else if (arg === '--width') result.width = Number(value())
    else if (arg === '--height') result.height = Number(value())
    else if (arg === '--device-scale-factor') result.deviceScaleFactor = Number(value())
    else if (arg === '--output-dir') result.outputDir = resolve(value())
    else if (arg === '--chrome-path') result.chromePath = value()
    else if (arg === '--pair-script') result.pairScript = resolve(value())
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: mobile-harness.mjs --url <https://host> [--suite smoke] [--session 独立站/test] [--output-dir /tmp/out]')
      process.exit(0)
    } else throw new Error(`未知参数: ${arg}`)
  }
  if (!result.url) throw new Error('必须通过 --url 或 PROMA_WEB_REMOTE_URL 提供 Web Remote 地址')
  if (!/^https?:\/\//.test(result.url)) throw new Error('--url 必须是 http(s) 地址')
  if (!Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 240 || result.height < 400) throw new Error('视口尺寸无效')
  if (!(result.deviceScaleFactor >= 2 && result.deviceScaleFactor <= 3.5)) throw new Error('deviceScaleFactor 必须在 2 到 3.5 之间')
  return result
}

function pickChrome(explicit) {
  const candidates = [explicit, process.env.GOOGLE_CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', 'google-chrome', 'chromium']
  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate.includes('/') && existsSync(candidate)) return candidate
    if (!candidate.includes('/')) return candidate
  }
  throw new Error('找不到 Chrome/Chromium，请通过 --chrome-path 或 CHROME_PATH 指定')
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 0
    this.pending = new Map()
    this.listeners = new Map()
    this.ws.on('message', (raw) => {
      let message
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (message.id && this.pending.has(message.id)) {
        const request = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) request.reject(new Error(`CDP ${request.method}: ${message.error.message ?? 'error'} ${JSON.stringify(message.error.data ?? '')}`))
        else request.resolve(message.result)
        return
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params)
    })
  }

  async connect() {
    if (this.ws.readyState !== WebSocket.OPEN) await new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject) })
    return this
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? []
    listeners.push(listener)
    this.listeners.set(method, listeners)
  }

  command(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression, returnByValue = true) {
    const result = await this.command('Runtime.evaluate', { expression, returnByValue, awaitPromise: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? '页面脚本异常'}; expression=${expression.slice(0, 220)}`)
    return returnByValue ? result.result?.value : result.result
  }

  close() { this.ws.close() }
}

async function readDevToolsUrl(stderr, chrome, timeoutMs = 15_000) {
  let buffer = ''
  return new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome 未在 ${timeoutMs}ms 内输出 DevTools 地址；stderr=${buffer.slice(-1000)}`)), timeoutMs)
    const onData = (chunk) => {
      buffer += chunk.toString()
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); stderr.off('data', onData); resolveUrl(match[1]) }
    }
    stderr.on('data', onData)
    chrome.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`Chrome 提前退出 code=${code} signal=${signal}; stderr=${buffer.slice(-1000)}`)) })
  })
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!response.ok) throw new Error(`${response.status} ${typeof body === 'object' ? body?.error ?? JSON.stringify(body) : body}`)
  return body
}

function shellPair(pairScript) {
  return new Promise((resolvePair, reject) => {
    const child = spawn(pairScript, ['pair'], { cwd: REPO_ROOT, env: { ...process.env, PROMA_DEV: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('close', (code) => {
      const match = stdout.match(/配对码:\s*(\d{6})/)
      if (code !== 0 || !match) reject(new Error(`生成配对码失败 code=${code}; stdout=${stdout}; stderr=${stderr}`))
      else resolvePair({ code: match[1], output: stdout })
    })
  })
}

async function waitUntil(client, expression, timeoutMs = 30_000, intervalMs = 250) {
  const end = Date.now() + timeoutMs
  let last
  while (Date.now() < end) {
    last = await client.evaluate(expression)
    if (last) return last
    await delay(intervalMs)
  }
  throw new Error(`等待条件超时: ${String(expression).slice(0, 180)}; last=${JSON.stringify(last)}`)
}

function quoteJs(value) { return JSON.stringify(value) }

async function findElement(client, text, selector = 'body *') {
  const result = await client.evaluate(`(() => {
    const wanted=${quoteJs(text)};
    const nodes=[...document.querySelectorAll(${quoteJs(selector)})];
    const visible=(node)=>{const r=node.getBoundingClientRect();const s=getComputedStyle(node);return r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight&&s.visibility!=='hidden'&&s.display!=='none';};
    const matches=nodes.filter((item)=>visible(item)&&((item.innerText||item.textContent||'').includes(wanted))).sort((a,b)=>{const rank=(item)=>item.matches('button,[role="button"]')?0:((item.innerText||item.textContent||'').trim()===wanted?1:2);const ar=a.getBoundingClientRect();const br=b.getBoundingClientRect();return rank(a)-rank(b)||(ar.width*ar.height)-(br.width*br.height)});
    const node=matches[0];
    if(!node)return null; const r=node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,tag:node.tagName,text:(node.innerText||node.textContent||'').trim().slice(0,160)};
  })()`)
  if (!result) throw new Error(`找不到可见文本: ${text}`)
  return result
}

async function touchAt(client, x, y) {
  await client.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] })
  await client.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function touchText(client, text, selector = 'body *') {
  const point = await findElement(client, text, selector)
  await touchAt(client, point.x, point.y)
  return point
}

async function screenshot(client, outputDir, name) {
  const data = await client.command('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const path = join(outputDir, `${name}.png`)
  const buffer = Buffer.from(data.data, 'base64')
  await import('node:fs/promises').then(({ writeFile }) => writeFile(path, buffer))
  return path
}

async function createHarness(options) {
  mkdirSync(options.outputDir, { recursive: true })
  const profile = mkdtempSync(join(tmpdir(), 'proma-mobile-chrome-'))
  activeProfile = profile
  const chrome = spawn(pickChrome(options.chromePath), [
    '--headless=new', '--disable-gpu', '--no-proxy-server', '--no-first-run', '--no-default-browser-check', '--ignore-certificate-errors',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  activeChrome = chrome
  let devtoolsWs
  try {
    devtoolsWs = await readDevToolsUrl(chrome.stderr, chrome)
  } catch (error) {
    chrome.kill('SIGTERM')
    await delay(250)
    rmSync(profile, { recursive: true, force: true })
    throw error
  }
  const versionUrl = new URL(devtoolsWs); versionUrl.protocol = 'http:'; versionUrl.pathname = '/json/version'; versionUrl.search = ''
  await jsonFetch(versionUrl)
  const listUrl = new URL(versionUrl); listUrl.pathname = '/json/list'
  const targets = await jsonFetch(listUrl)
  const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  if (!pageTarget) throw new Error('Chrome 没有可用页面 target')
  const client = await new CdpClient(pageTarget.webSocketDebuggerUrl).connect()
  const consoleErrors = []; const exceptions = []
  client.on('Runtime.consoleAPICalled', (event) => { if (['error', 'assert'].includes(event.type)) consoleErrors.push({ type: event.type, args: event.args?.map((arg) => arg.value ?? arg.description) }) })
  client.on('Runtime.exceptionThrown', (event) => exceptions.push({ text: event.exceptionDetails?.text, description: event.exceptionDetails?.exception?.description }))
  await client.command('Runtime.enable')
  await client.command('Page.enable')
  await client.command('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: options.deviceScaleFactor, mobile: true, screenWidth: options.width, screenHeight: options.height })
  await client.command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await client.command('Network.setUserAgentOverride', { userAgent: ANDROID_UA, platform: 'Android' })
  const navigate = async (path) => { const target = new URL(path, options.url).toString(); await client.command('Page.navigate', { url: target }); await waitUntil(client, `document.readyState === 'complete' || document.readyState === 'interactive'`, 30_000) }
  const pair = async () => {
    const pairing = await shellPair(options.pairScript)
    await navigate('/')
    const label = `harness-${Date.now()}`
    const paired = await client.evaluate(`fetch('/api/pair',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:${quoteJs(pairing.code)},label:${quoteJs(label)}})}).then(async r=>({status:r.status,body:await r.json()}))`)
    if (!paired || paired.status !== 200) throw new Error(`页面配对失败: ${JSON.stringify(paired)}`)
    await navigate('/app/')
    await waitUntil(client, `document.body.innerText.includes('Agent') && !document.body.innerText.includes('正在启动 Proma')`, 60_000)
    return { ...paired.body, label, pairingOutput: pairing.output }
  }
  const openDrawer = async () => {
    if (await client.evaluate(`document.body.dataset.webRemoteSidebarOpen === 'true'`)) return
    const menu = await findElement(client, '☰', '[data-web-remote-mobile-menu],button')
    await touchAt(client, menu.x, menu.y)
    await waitUntil(client, `document.body.dataset.webRemoteSidebarOpen === 'true'`)
    await delay(300)
  }
  const clickSidebarText = async (text) => {
    await openDrawer()
    const aria = { 'MCP/Skills': 'MCP/Skills', Todo: 'Todo', '定时任务': '定时任务' }[text]
    const point = aria
      ? await findElement(client, text, `button[aria-label=${quoteJs(aria)}]`)
      : await touchText(client, text, '[data-web-remote-sidebar="left"] *')
    await delay(300)
    await client.evaluate(`delete document.body.dataset.webRemoteSidebarOpen`)
    return point
  }
  const openSession = async (title) => {
    const candidates = [title, ...(title.includes('/') ? [title.split('/').at(-1)] : [])].filter(Boolean)
    let point
    let selected = title
    try {
      await openDrawer()
      for (const candidate of candidates) {
        try { point = await findElement(client, candidate, '[data-web-remote-sidebar="left"] *'); selected = candidate; break } catch {}
        try { point = await findElement(client, candidate, '[data-session-id],button,[role="button"]'); selected = candidate; break } catch {}
      }
      if (!point) throw new Error(`找不到可见文本: ${title}`)
      await touchAt(client, point.x, point.y)
      await waitUntil(client, `document.body.innerText.includes(${quoteJs(selected)})`)
      return point
    } catch (error) {
      const bodyText = await client.evaluate('document.body.innerText').catch(() => '')
      throw new Error(`${error instanceof Error ? error.message : String(error)}; body=${String(bodyText).slice(0, 1200)}`)
    }
  }
  const inputAndSend = async (message) => {
    const input = await client.evaluate(`(() => { const n=document.querySelector('textarea:not([disabled]),[contenteditable="true"]'); if(!n)return null; const r=n.getBoundingClientRect(); n.focus(); return {x:r.left+r.width/2,y:r.top+r.height/2,tag:n.tagName}; })()`)
    if (!input) throw new Error('找不到消息输入框')
    await touchAt(client, input.x, input.y)
    await client.command('Input.insertText', { text: message })
    await client.evaluate(`(() => { const n=[...document.querySelectorAll('textarea,[contenteditable="true"]')].find((x)=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0}); if(n)n.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${quoteJs(message)}})); })()`)
    await delay(100)
    const send = await client.evaluate(`(() => { const nodes=[...document.querySelectorAll('button,[role="button"]')]; const visible=(x)=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>innerHeight-110&&x.getAttribute('aria-disabled')!=='true'&&!x.disabled}; const named=nodes.find(x=>visible(x)&&/^(发送|Send)$/.test((x.innerText||x.getAttribute('aria-label')||'').trim())); const bottom=nodes.filter(visible).sort((a,b)=>b.getBoundingClientRect().right-a.getBoundingClientRect().right)[0]; const n=named||bottom; if(!n)return null; const r=n.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,aria:n.getAttribute('aria-label'),text:(n.innerText||'').trim()}; })()`)
    if (!send) {
      const controls = await client.evaluate(`([...document.querySelectorAll('button,[role="button"]')].map((x)=>({text:(x.innerText||'').trim(),aria:x.getAttribute('aria-label'),disabled:x.disabled,rect:(()=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()})).filter((x)=>x.rect.w>0&&x.rect.h>0)).slice(-30)`)
      throw new Error(`找不到发送按钮 controls=${JSON.stringify(controls)}`)
    }
    await touchAt(client, send.x, send.y)
    return true
  }
  const waitText = (text, timeoutMs = 60_000) => waitUntil(client, `document.body.innerText.includes(${quoteJs(text)})`, timeoutMs)
  const invokeApi = (method, args = []) => client.evaluate(`window.electronAPI[${quoteJs(method)}](...${quoteJs(args)})`)
  const invokeRaw = (channel, args = []) => client.evaluate(`window.__PROMA_WEB_REMOTE_INVOKE(${quoteJs(channel)}, ...${quoteJs(args)})`)
  const clickText = (text, selector = 'body *') => touchText(client, text, selector)
  const freeze = () => client.command('Page.setWebLifecycleState', { state: 'frozen' })
  const resume = () => client.command('Page.setWebLifecycleState', { state: 'active' })
  const close = async () => {
    client.close()
    const exited = chrome.exitCode !== null ? Promise.resolve() : new Promise((resolve) => chrome.once('exit', resolve))
    if (chrome.exitCode === null) chrome.kill('SIGTERM')
    await Promise.race([exited, delay(3_000)])
    rmSync(profile, { recursive: true, force: true })
    activeChrome = null
    activeProfile = null
  }
  return { client, chrome, profile, pair, navigate, openDrawer, clickSidebarText, clickText, openSession, inputAndSend, waitText, invokeApi, invokeRaw, freeze, resume, screenshot: (name) => screenshot(client, options.outputDir, name), consoleErrors, exceptions, close }
}

async function runExtra(harness, options, result) {
  await harness.openSession(options.session)
  const workspaces = await harness.invokeApi('listAgentWorkspaces')
  const workspace = Array.isArray(workspaces) ? workspaces.find((item) => item && item.name === '独立站') ?? workspaces[0] : null
  const slug = workspace?.slug
  const suspicious = /(?:sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,})/
  const credentialChecks = {}
  const findLeaks = (value, path = '$') => {
    const leaks = []
    const walk = (item, currentPath) => {
      if (typeof item === 'string') {
        if (item === '[REDACTED]') return
        if (suspicious.test(item) || /(?:key|token|secret|password|credential|authorization)/i.test(currentPath)) leaks.push(currentPath)
        return
      }
      if (Array.isArray(item)) item.forEach((child, index) => walk(child, `${currentPath}[${index}]`))
      else if (item && typeof item === 'object') Object.entries(item).forEach(([key, child]) => walk(child, `${currentPath}.${key}`))
    }
    walk(value, path)
    return [...new Set(leaks)]
  }
  for (const [name, valuePromise] of [
    ['settings:get', harness.invokeApi('getSettings')],
    ['channel:list', harness.invokeApi('listChannels')],
    ['agent:get-mcp-config', slug ? harness.invokeApi('getWorkspaceMcpConfig', [slug]) : Promise.resolve(null)],
  ]) {
    try {
      const value = await valuePromise
      const leaks = findLeaks(value)
      credentialChecks[name] = { ok: leaks.length === 0, suspicious: leaks }
    } catch (error) {
      credentialChecks[name] = { ok: false, error: String(error) }
    }
  }
  result.credentialChecks = credentialChecks

  const forbiddenPath = '/tmp/proma-web-remote-outside-harness.md'
  try {
    await harness.invokeRaw('file:resolve-and-read', [forbiddenPath, slug ? { workspaceSlug: slug } : {}])
    result.fileScope = { outsidePathRejected: false }
  } catch (error) {
    result.fileScope = { outsidePathRejected: true, error: String(error).slice(0, 240) }
  }

  const panelAssertions = []
  for (const [label, title] of [['MCP/Skills', 'Skills'], ['Todo', 'Todo'], ['定时任务', '定时任务']] ) {
    try {
      await harness.clickSidebarText(label)
      await waitUntil(harness.client, `document.body.innerText.includes(${quoteJs(title)})`, 5_000)
      const path = await harness.screenshot(`panel-${label === 'MCP/Skills' ? 'mcp-skills' : label === 'Todo' ? 'todo' : 'automations'}`)
      result.screenshots.push(path)
      panelAssertions.push({ panel: label, title, dom: true, screenshot: path })
    } catch (error) {
      panelAssertions.push({ panel: label, title, dom: false, error: String(error) })
    }
  }
  try {
    const fileButton = await findElement(harness.client, '文件', '[data-web-remote-panel-toggle],button,[role="button"]')
    await touchAt(harness.client, fileButton.x, fileButton.y)
    await waitUntil(harness.client, `document.body.innerText.includes('文件')`, 5_000)
    const path = await harness.screenshot('panel-files')
    result.screenshots.push(path)
    panelAssertions.push({ panel: '文件', title: '文件', dom: true, screenshot: path })
  } catch (error) {
    panelAssertions.push({ panel: '文件', title: '文件', dom: false, error: String(error) })
  }
  result.panelAssertions = panelAssertions

  const todo = await harness.invokeApi('createTodo', [{ title: 'harness-confirm-test' }])
  const dialogs = []
  let dialogDecision = 'cancel'
  const onDialog = (event) => {
    if (event.type !== 'confirm') return
    dialogs.push(event.message)
    void harness.client.command('Page.handleJavaScriptDialog', { accept: dialogDecision === 'accept' })
  }
  harness.client.on('Page.javascriptDialogOpening', onDialog)
  let firstDeleteError = ''
  dialogDecision = 'cancel'
  try { await harness.invokeApi('deleteTodo', [todo.id]) } catch (error) { firstDeleteError = String(error) }
  const afterCancel = await harness.invokeApi('listTodos')
  const remainsAfterCancel = Array.isArray(afterCancel) && afterCancel.some((item) => item.id === todo.id || item.title === 'harness-confirm-test')
  dialogDecision = 'accept'
  await harness.invokeApi('deleteTodo', [todo.id]).catch(() => {})
  const afterConfirm = await harness.invokeApi('listTodos')
  const remainsAfterConfirm = Array.isArray(afterConfirm) && afterConfirm.some((item) => item.id === todo.id || item.title === 'harness-confirm-test')
  result.todoConfirm = { created: Boolean(todo?.id), cancelDialogSeen: dialogs.length >= 1, remainsAfterCancel, confirmDialogSeen: dialogs.length >= 2, remainsAfterConfirm, firstDeleteError: firstDeleteError.slice(0, 240) }

  const automations = await harness.invokeApi('listAutomations')
  let automationDialogSeen = false
  if (Array.isArray(automations) && automations[0]?.id) {
    dialogDecision = 'cancel'
    const before = dialogs.length
    await harness.invokeApi('runAutomationNow', [automations[0].id]).catch(() => {})
    automationDialogSeen = dialogs.length > before
  }
  result.automationConfirm = { dialogSeen: automationDialogSeen, cancelled: automationDialogSeen }

  try {
    const closePanel = await findElement(harness.client, '×', '[data-web-remote-panel-toggle],button,[role="button"]')
    await touchAt(harness.client, closePanel.x, closePanel.y)
    await delay(300)
  } catch {}
  await harness.navigate('/app/')
  await waitUntil(harness.client, `document.body.innerText.includes('Agent') && !document.body.innerText.includes('正在启动 Proma')`, 60_000)
  await harness.openSession(options.session)
  const beforeSkillText = await harness.client.evaluate('document.body.innerText')
  await harness.inputAndSend('/status')
  await delay(20_000)
  const skillText = await harness.client.evaluate('document.body.innerText')
  const skillChanged = skillText.length > beforeSkillText.length + 20 && skillText.includes('/status')
  const skillScreenshot = await harness.screenshot('extra-readonly-skill')
  result.screenshots.push(skillScreenshot)
  result.readonlySkill = { finalReplySeen: skillChanged, screenshot: skillScreenshot, tail: skillText.slice(-600) }
  if (!skillChanged) throw new Error('只读 Skill 未出现新的最终回复文本')
}

async function runSmoke(harness, options, result) {
  result.steps.push({ name: 'load', ok: true, url: new URL('/app/', options.url).toString() })
  await harness.openSession(options.session)
  result.steps.push({ name: 'open-session', ok: true, session: options.session })
  await harness.inputAndSend('只回复 pong')
  await harness.waitText('pong', 90_000)
  result.steps.push({ name: 'send-pong', ok: true })
  const targets = [
    ['MCP/Skills', 'mcp-skills'],
    ['Todo', 'todo'],
    ['定时任务', 'automations'],
    ['文件', 'files'],
  ]
  for (const [label, name] of targets) {
    try {
      if (label === '文件') {
        const button = await findElement(harness.client, '文件', '[data-web-remote-panel-toggle],button,[role="button"]')
        await touchAt(harness.client, button.x, button.y)
      } else {
        await harness.clickSidebarText(label)
      }
      await delay(350)
      const path = await harness.screenshot(name)
      result.screenshots.push(path)
      result.steps.push({ name: `open-${name}`, ok: true, screenshot: path })
    } catch (error) {
      result.steps.push({ name: `open-${name}`, ok: false, error: String(error) })
    }
  }
  // Restore the conversation for the last screenshot and make failures obvious in JSON.
  const finalScreenshot = await harness.screenshot('smoke-final')
  result.screenshots.push(finalScreenshot)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const result = { startedAt: new Date().toISOString(), options: { url: options.url, suite: options.suite, session: options.session, width: options.width, height: options.height, deviceScaleFactor: options.deviceScaleFactor, outputDir: options.outputDir }, steps: [], screenshots: [], consoleErrors: [], exceptions: [], pairedDeviceId: null, revoked: false, chromeExited: false, profileRemoved: false }
  let harness
  try {
    harness = await createHarness(options)
  } catch (error) {
    activeChrome?.kill('SIGTERM')
    if (activeProfile) rmSync(activeProfile, { recursive: true, force: true })
    throw error
  }
  let deviceId
  try {
    const paired = await harness.pair()
    deviceId = paired.deviceId
    result.pairedDeviceId = deviceId
    if (options.suite === 'smoke') await runSmoke(harness, options, result)
    else if (options.suite === 'extra') await runExtra(harness, options, result)
    else if (options.suite === 'all') { await runSmoke(harness, options, result); await runExtra(harness, options, result) }
    else throw new Error(`未知套件: ${options.suite}`)
  } catch (error) {
    result.error = error instanceof Error ? error.stack ?? error.message : String(error)
  } finally {
    result.consoleErrors = harness.consoleErrors
    result.exceptions = harness.exceptions
    try {
      await harness.close()
      result.chromeExited = harness.chrome.exitCode !== null || harness.chrome.signalCode !== null
      result.profileRemoved = !existsSync(harness.profile)
    } catch (error) { result.cleanupError = String(error) }
    if (deviceId) {
      try {
        const child = spawn(options.pairScript, ['revoke', deviceId], { cwd: REPO_ROOT, env: { ...process.env, PROMA_DEV: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''; let stderr = ''
        child.stdout.on('data', (chunk) => { stdout += chunk.toString() }); child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
        await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`revoke failed code=${code} stdout=${stdout} stderr=${stderr}`))) })
        result.revoked = true
        result.revokeOutput = stdout.trim()
      } catch (error) { result.revokeError = String(error) }
    }
    result.finishedAt = new Date().toISOString()
    const jsonPath = join(options.outputDir, `mobile-harness-${Date.now()}.json`)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`))
    console.log(JSON.stringify({ ...result, jsonPath }, null, 2))
    if (result.error || result.revokeError || !result.revoked) process.exitCode = 1
  }
}

await main()
