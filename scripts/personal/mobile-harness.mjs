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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const DEFAULT_OUTPUT_DIR = join(tmpdir(), 'proma-mobile-harness')
let activeChrome = null
let activeProfile = null

export function assertOwnedSessionMutation(sessionId, createdSessionIds, operation) {
  if (!sessionId || !createdSessionIds.has(sessionId)) throw new Error(`拒绝对本次运行新建会话以外的目标执行 ${operation}: ${sessionId ?? '(null)'}`)
}

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'

function parseArgs(argv) {
  const result = { url: process.env.PROMA_WEB_REMOTE_URL ?? '', suite: 'smoke', session: process.env.PROMA_WEB_REMOTE_SESSION ?? '独立站/test', width: 412, height: 915, deviceScaleFactor: 3, userAgent: 'android', outputDir: DEFAULT_OUTPUT_DIR, chromePath: process.env.CHROME_PATH ?? '', pairScript: join(REPO_ROOT, 'scripts/personal/web-remote.sh') }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => argv[++i]
    if (arg === '--url') result.url = value()
    else if (arg === '--suite') result.suite = value()
    else if (arg === '--session') result.session = value()
    else if (arg === '--width') result.width = Number(value())
    else if (arg === '--height') result.height = Number(value())
    else if (arg === '--device-scale-factor') result.deviceScaleFactor = Number(value())
    else if (arg === '--user-agent') result.userAgent = value()
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
  if (!(result.deviceScaleFactor >= 1 && result.deviceScaleFactor <= 3.5)) throw new Error('deviceScaleFactor 必须在 1 到 3.5 之间')
  if (!['android', 'iphone', 'desktop'].includes(result.userAgent)) throw new Error('--user-agent 仅支持 android|iphone|desktop')
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

  off(method, listener) {
    const listeners = this.listeners.get(method) ?? []
    this.listeners.set(method, listeners.filter((item) => item !== listener))
  }

  command(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression, returnByValue = true) {
    let result
    try {
      result = await this.command('Runtime.evaluate', { expression, returnByValue, awaitPromise: true, userGesture: true })
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; expression=${expression.slice(0, 320)}`)
    }
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

function sdkMessageRole(message) {
  if (message?.type === 'assistant' || message?.type === 'user' || message?.type === 'system') return message.type
  return typeof message?.role === 'string' ? message.role : ''
}

function sdkMessageText(message) {
  const content = message?.message?.content ?? message?.content ?? message?.text ?? ''
  const collect = (value) => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map(collect).filter(Boolean).join(' ')
    if (value && typeof value === 'object') return collect(value.text ?? value.content ?? value.message ?? '')
    return ''
  }
  return collect(content)
}

async function findElement(client, text, selector = 'body *') {
  const result = await client.evaluate(`(() => {
    const wanted=${quoteJs(text)};
    const nodes=[...document.querySelectorAll(${quoteJs(selector)})];
    const visible=(node)=>{const r=node.getBoundingClientRect();const s=getComputedStyle(node);return r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight&&s.visibility!=='hidden'&&s.display!=='none';};
    const accessibleName=(node)=>{const aria=node.getAttribute('aria-label');if(aria)return aria.trim();const ids=(node.getAttribute('aria-labelledby')||'').split(/\\s+/).filter(Boolean);if(ids.length)return ids.map((id)=>document.getElementById(id)?.innerText||'').join(' ').trim();return(node.innerText||node.textContent||node.getAttribute('title')||'').trim();};
    const matches=nodes.filter((item)=>visible(item)&&((item.innerText||item.textContent||'').includes(wanted)||accessibleName(item).includes(wanted))).sort((a,b)=>{const rank=(item)=>{const name=accessibleName(item);if(name===wanted&&item.matches('button,[role="button"]'))return 0;if(name===wanted)return 1;if(item.matches('button,[role="button"]'))return 2;return 3};const ar=a.getBoundingClientRect();const br=b.getBoundingClientRect();return rank(a)-rank(b)||(ar.width*ar.height)-(br.width*br.height)});
    const node=matches[0];
    if(!node)return null; const r=node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,tag:node.tagName,role:node.getAttribute('role'),ariaLabel:node.getAttribute('aria-label'),text:(node.innerText||node.textContent||'').trim().slice(0,160)};
  })()`)
  if (!result) throw new Error(`找不到可访问名称或可见文本: ${text}`)
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
  await client.command('Network.enable')
  let activeNavigation = null
  const loadMetrics = []
  client.on('Network.requestWillBeSent', (event) => {
    if (activeNavigation) activeNavigation.requestIds.add(event.requestId)
  })
  client.on('Network.responseReceived', (event) => {
    if (!activeNavigation) return
    activeNavigation.responses += 1
    if (event.response?.fromDiskCache || event.response?.fromServiceWorker || event.response?.fromPrefetchCache) activeNavigation.cachedResponses += 1
  })
  client.on('Network.loadingFinished', (event) => {
    if (!activeNavigation || activeNavigation.finishedIds.has(event.requestId)) return
    activeNavigation.finishedIds.add(event.requestId)
    activeNavigation.transferBytes += Number(event.encodedDataLength ?? 0)
  })
  const mobile = options.userAgent !== 'desktop' && options.width < 768
  await client.command('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: options.deviceScaleFactor, mobile, screenWidth: options.width, screenHeight: options.height })
  if (mobile) await client.command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  if (options.userAgent !== 'desktop') {
    const userAgent = options.userAgent === 'iphone'
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
      : ANDROID_UA
    await client.command('Network.setUserAgentOverride', { userAgent, platform: options.userAgent === 'iphone' ? 'iPhone' : 'Android' })
  }
  let activeSessionId = null
  const createdSessionIds = new Set()
  let sessionManifestBefore = null
  let sessionManifestAfter = null
  const readSessionManifest = async () => {
    const sessions = await client.evaluate('window.electronAPI.listAgentSessions()')
    return (Array.isArray(sessions) ? sessions : []).map((item) => ({ id: item?.id, title: item?.title, permissionMode: item?.permissionMode })).filter((item) => item.id).sort((a, b) => a.id.localeCompare(b.id))
  }
  const installInteractionStreamAudit = async () => {
    return client.evaluate(`(() => { window.__PROMA_HARNESS_STREAM_EVENTS=[]; window.__PROMA_HARNESS_UNSUBSCRIBE_STREAM?.(); window.__PROMA_HARNESS_UNSUBSCRIBE_STREAM=window.electronAPI.onAgentStreamEvent((item)=>{ const event=item?.payload?.kind==='proma_event'?item.payload.event:null; if(event && ['ask_user_request','ask_user_resolved','exit_plan_mode_request','exit_plan_mode_resolved'].includes(event.type)) window.__PROMA_HARNESS_STREAM_EVENTS.push({sessionId:item.sessionId,type:event.type,requestId:event.request?.requestId??event.requestId}); }); return true; })()`)
  }
  const navigate = async (path) => {
    const target = new URL(path, options.url).toString()
    const startedAt = Date.now()
    activeNavigation = { path, requestIds: new Set(), finishedIds: new Set(), responses: 0, cachedResponses: 0, transferBytes: 0 }
    await client.command('Page.navigate', { url: target })
    await waitUntil(client, `document.readyState === 'complete' || document.readyState === 'interactive'`, 30_000)
    await delay(2_000)
    const metric = { path, requests: activeNavigation.requestIds.size, responses: activeNavigation.responses, cachedResponses: activeNavigation.cachedResponses, transferBytes: activeNavigation.transferBytes, durationMs: Date.now() - startedAt }
    loadMetrics.push(metric)
    activeNavigation = null
    return metric
  }
  const pair = async () => {
    const pairing = await shellPair(options.pairScript)
    await navigate('/')
    const label = `harness-${Date.now()}`
    const paired = await client.evaluate(`fetch('/api/pair',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:${quoteJs(pairing.code)},label:${quoteJs(label)}})}).then(async r=>({status:r.status,body:await r.json()}))`)
    if (!paired || paired.status !== 200) throw new Error(`页面配对失败: ${JSON.stringify(paired)}`)
    const firstAppLoad = await navigate('/app/')
    await waitUntil(client, `document.body.innerText.includes('Agent') && !document.body.innerText.includes('正在启动 Proma')`, 60_000)
    return { ...paired.body, label, pairingOutput: pairing.output, firstAppLoad }
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
  const createHarnessSession = async (title) => {
    const workspaces = await client.evaluate('window.electronAPI.listAgentWorkspaces()')
    const workspace = Array.isArray(workspaces) ? workspaces.find((item) => item?.name === '独立站') : null
    if (!workspace?.id) throw new Error('找不到“独立站”工作区，拒绝在其他工作区创建 harness 会话')
    const existingIds = new Set((await readSessionManifest()).map((item) => item.id))
    await openDrawer()
    const currentWorkspaceId = await client.evaluate('window.electronAPI.getSettings().then((settings)=>settings?.agentWorkspaceId)')
    if (currentWorkspaceId !== workspace.id) {
      const workspaceHeading = await findElement(client, '独立站', '[data-web-remote-sidebar="left"] *')
      await touchAt(client, workspaceHeading.x, workspaceHeading.y)
      await waitUntil(client, `window.electronAPI.getSettings().then((settings)=>settings?.agentWorkspaceId===${quoteJs(workspace.id)})`, 10_000)
    }
    const plus = await client.evaluate('(() => { const n=document.querySelector(\'button[aria-label="新建任务"]\'); if(!n)return null; const r=n.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()')
    if (!plus) throw new Error('手机端找不到新建任务按钮')
    await touchAt(client, plus.x, plus.y)
    await waitUntil(client, 'Boolean(document.querySelector(\'textarea:not([disabled]),[contenteditable="true"]\'))', 10_000)
    const created = await waitUntil(client, `window.electronAPI.listAgentSessions().then((items)=>items.find((item)=>item?.id&&!${JSON.stringify([...existingIds])}.includes(item.id)&&item.workspaceId===${quoteJs(workspace.id)}))`, 15_000)
    if (!created?.id) throw new Error(`无法取得本次创建的会话 ID: ${JSON.stringify(created)}`)
    createdSessionIds.add(created.id)
    assertOwnedSessionMutation(created.id, createdSessionIds, '标题更新')
    const renamed = await client.evaluate(`window.electronAPI.updateAgentSessionTitle(${quoteJs(created.id)}, ${quoteJs(title)})`)
    if (renamed?.id !== created.id || renamed?.title !== title) throw new Error(`仅本次会话的标题更新失败: ${JSON.stringify(renamed)}`)
    activeSessionId = created.id
    return renamed
  }
  const setPermissionMode = async (mode) => {
    assertOwnedSessionMutation(activeSessionId, createdSessionIds, '权限模式变更')
    if (mode !== 'plan' && mode !== 'bypassPermissions') throw new Error(`未知权限模式: ${mode}`)
    const targetLabel = mode === 'plan' ? '计划模式' : '完全自动'
    const current = await client.evaluate('document.querySelector(\'button[aria-label="计划模式"],button[aria-label="完全自动"]\')?.getAttribute("aria-label")')
    if (current !== targetLabel) {
      const button = await client.evaluate('(() => { const n=document.querySelector(\'button[aria-label="计划模式"],button[aria-label="完全自动"]\'); if(!n)return null; const r=n.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,aria:n.getAttribute("aria-label")}; })()')
      if (!button) {
        const diagnostic = await client.evaluate('({body:document.body.innerText.slice(-1000),buttons:[...document.querySelectorAll("button")].map((n)=>({aria:n.getAttribute("aria-label"),text:(n.innerText||"").trim()})).filter((x)=>x.aria||x.text).slice(-40)})')
        throw new Error(`手机端找不到权限模式切换控件: ${JSON.stringify(diagnostic)}`)
      }
      await client.evaluate(`document.querySelector('button[aria-label="计划模式"],button[aria-label="完全自动"]')?.click()`)
      await waitUntil(client, `Boolean(document.querySelector('button[aria-label=${quoteJs(targetLabel)}]'))`, 10_000)
    }
    return true
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
      const sessionMetas = await client.evaluate('window.electronAPI.listAgentSessions().then((xs)=>xs.map((m)=>({id:m?.id,title:m?.title,workspaceId:m?.workspaceId,updatedAt:m?.updatedAt})))')
      const matchingSessions = Array.isArray(sessionMetas)
        ? sessionMetas.filter((item) => item?.title === selected || item?.title === title || item?.title === title.split('/').at(-1))
        : []
      const sessionMeta = matchingSessions.sort((a, b) => Number(b?.updatedAt ?? 0) - Number(a?.updatedAt ?? 0))[0]
      if (!sessionMeta?.id) throw new Error(`无法解析当前会话 ID: ${title}`)
      activeSessionId = sessionMeta.id
      return point
    } catch (error) {
      const bodyText = await client.evaluate('document.body.innerText').catch(() => '')
      throw new Error(`${error instanceof Error ? error.message : String(error)}; body=${String(bodyText).slice(0, 1200)}`)
    }
  }
  const readHistory = async () => {
    if (!activeSessionId) {
      const sessions = await client.evaluate('window.electronAPI.listAgentSessions().then((xs)=>xs.map((m)=>({id:m?.id,title:m?.title,workspaceId:m?.workspaceId,updatedAt:m?.updatedAt})))')
      const latest = Array.isArray(sessions) ? [...sessions].sort((a, b) => Number(b?.updatedAt ?? 0) - Number(a?.updatedAt ?? 0))[0] : null
      if (latest?.id) activeSessionId = latest.id
    }
    if (!activeSessionId) throw new Error('当前会话 ID 尚未建立')
    const history = await client.evaluate(`window.electronAPI.getAgentSessionSDKMessages(${quoteJs(activeSessionId)})`)
    if (!Array.isArray(history)) throw new Error(`会话历史返回格式无效: ${typeof history}`)
    return history
  }
  const waitForUserSubmission = async (userText, timeoutMs = 15_000) => {
    const end = Date.now() + timeoutMs
    let last = []
    while (Date.now() < end) {
      last = await readHistory()
      if (last.some((message) => sdkMessageRole(message) === 'user' && sdkMessageText(message).includes(userText))) return last
      await delay(250)
    }
    throw new Error(`消息未提交到会话历史: ${userText}; historyTail=${JSON.stringify(last.slice(-4).map((message) => ({ role: sdkMessageRole(message), text: sdkMessageText(message).slice(0, 180) })))}`)
  }
  const waitForAssistantReply = async (userText, expectedText, timeoutMs = 90_000) => {
    const end = Date.now() + timeoutMs
    let last = []
    while (Date.now() < end) {
      last = await readHistory()
      const userIndex = [...last].map((message) => sdkMessageRole(message) === 'user' && sdkMessageText(message).includes(userText)).lastIndexOf(true)
      const assistantReply = userIndex >= 0
        ? last.slice(userIndex + 1).find((message) => sdkMessageRole(message) === 'assistant' && sdkMessageText(message).includes(expectedText))
        : null
      const pageAssistantHasText = await client.evaluate(`([...document.querySelectorAll('[data-message-role="assistant"]')].some((node) => (node.innerText || '').includes(${quoteJs(expectedText)})))`)
      if (assistantReply && pageAssistantHasText) return { history: last, assistant: assistantReply }
      await delay(500)
    }
    throw new Error(`未找到用户消息之后的 assistant 回复: ${expectedText}; historyTail=${JSON.stringify(last.slice(-6).map((message) => ({ role: sdkMessageRole(message), text: sdkMessageText(message).slice(0, 220) })))}`)
  }
  const waitForRunning = async (timeoutMs = 20_000) => {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      const snapshots = await client.evaluate('window.electronAPI.listActiveAgentSessionSnapshots()')
      if (Array.isArray(snapshots) && snapshots.some((snapshot) => snapshot?.sessionId === activeSessionId && snapshot?.running !== false)) return snapshots
      await delay(250)
    }
    throw new Error(`冻结前未观察到当前会话运行中: ${activeSessionId}`)
  }

  const waitForAbortedAssistant = async (userText, timeoutMs = 30_000) => {
    const end = Date.now() + timeoutMs
    let last = []
    while (Date.now() < end) {
      last = await readHistory()
      const userIndex = [...last].map((message) => sdkMessageRole(message) === 'user' && sdkMessageText(message).includes(userText)).lastIndexOf(true)
      const aborted = userIndex >= 0
        ? last.slice(userIndex + 1).find((message) => sdkMessageRole(message) === 'assistant' && (message.stop_reason === 'aborted' || message.message?.stop_reason === 'aborted' || message.subtype === 'aborted'))
        : null
      if (aborted) return { history: last, assistant: aborted }
      await delay(500)
    }
    throw new Error(`未找到中止后的 assistant 记录: ${userText}; historyTail=${JSON.stringify(last.slice(-6).map((message) => ({ role: sdkMessageRole(message), text: sdkMessageText(message).slice(0, 220), stopReason: message.stop_reason ?? message.message?.stop_reason })))}`)
  }
  const inputAndSend = async (message) => {
    const input = await client.evaluate(`(() => { const n=document.querySelector('textarea:not([disabled]),[contenteditable="true"]'); if(!n)return null; const r=n.getBoundingClientRect(); n.focus(); return {x:r.left+r.width/2,y:r.top+r.height/2,tag:n.tagName}; })()`)
    if (!input) {
      const diagnostic = await client.evaluate('({body:document.body.innerText.slice(-1200),ask:Boolean(document.querySelector(".ask-user-banner")),plan:document.body.innerText.includes("Agent 计划待审批")})')
      throw new Error(`找不到消息输入框: ${JSON.stringify(diagnostic)}`)
    }
    await touchAt(client, input.x, input.y)
    await client.evaluate(`(() => {
      const n=[...document.querySelectorAll('textarea,[contenteditable="true"]')].find((x)=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0});
      if (!n) return false;
      if (n instanceof HTMLTextAreaElement || n instanceof HTMLInputElement) {
        const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(n),'value')?.set;
        setter?.call(n,${quoteJs(message)});
      } else {
        n.textContent=${quoteJs(message)};
      }
      n.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${quoteJs(message)}}));
      n.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    })()`)
    await delay(100)
    const typedValue = await client.evaluate('(() => { const n=[...document.querySelectorAll(\'textarea,[contenteditable="true"]\')].find((x)=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0}); return n ? (\'value\' in n ? n.value : n.innerText || n.textContent || \'\') : null })()')
    if (typeof typedValue !== 'string' || !typedValue.includes(message)) throw new Error(`输入框未接收到完整消息: ${JSON.stringify({ activeSessionId, typedValue, message })}`)
    const send = await client.evaluate(`(() => { const nodes=[...document.querySelectorAll('button,[role="button"]')]; const visible=(x)=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>innerHeight-110&&x.getAttribute('aria-disabled')!=='true'&&!x.disabled}; const named=nodes.find(x=>visible(x)&&/^(发送|Send)$/.test((x.innerText||x.getAttribute('aria-label')||'').trim())); const bottom=nodes.filter(visible).sort((a,b)=>b.getBoundingClientRect().right-a.getBoundingClientRect().right)[0]; const n=named||bottom; if(!n)return null; const r=n.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,aria:n.getAttribute('aria-label'),text:(n.innerText||'').trim()}; })()`)
    if (!send) {
      const controls = await client.evaluate(`([...document.querySelectorAll('button,[role="button"]')].map((x)=>({text:(x.innerText||'').trim(),aria:x.getAttribute('aria-label'),disabled:x.disabled,rect:(()=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()})).filter((x)=>x.rect.w>0&&x.rect.h>0)).slice(-30)`)
      throw new Error(`找不到发送按钮 controls=${JSON.stringify(controls)}`)
    }
    await touchAt(client, send.x, send.y)
    await waitForUserSubmission(message)
    return { submitted: true, userText: message }
  }
  const waitText = (text, timeoutMs = 60_000) => waitUntil(client, `document.body.innerText.includes(${quoteJs(text)})`, timeoutMs)
  const invokeApi = (method, args = []) => client.evaluate(`window.electronAPI[${quoteJs(method)}](...${quoteJs(args)})`)
  const invokeRaw = async (channel, args = []) => {
    const result = await client.evaluate(`window.__PROMA_WEB_REMOTE_INVOKE(${quoteJs(channel)}, ...${quoteJs(args)}).then((value)=>({ok:true,value}),(error)=>({ok:false,error:{denied:error?.denied===true,channel:error?.channel,reason:error?.reason,message:error?.message||String(error)}}))`)
    if (!result?.ok) throw new Error(JSON.stringify(result?.error ?? { message: 'IPC failed' }))
    return result.value
  }
  const clickText = (text, selector = 'body *') => touchText(client, text, selector)
  const resolveVisibleAskUserA = async () => {
    if (!await client.evaluate('Boolean(document.querySelector(".ask-user-banner"))')) return false
    const optionA = await findElement(client, 'A', '.ask-user-banner button')
    await touchAt(client, optionA.x, optionA.y)
    const confirm = await findElement(client, '确认', '.ask-user-banner button')
    await touchAt(client, confirm.x, confirm.y)
    return true
  }
  const resolveVisiblePlanApproval = async () => {
    if (!await client.evaluate('document.body.innerText.includes("Agent 计划待审批")')) return false
    const approve = await findElement(client, '批准并完全自动执行', 'button')
    await touchAt(client, approve.x, approve.y)
    return true
  }
  const getInteractionStreamEvents = () => client.evaluate('window.__PROMA_HARNESS_STREAM_EVENTS ?? []')
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
  return { client, chrome, profile, pair, navigate, installInteractionStreamAudit, loadMetrics, openDrawer, clickSidebarText, clickText, openSession, createHarnessSession, setPermissionMode, inputAndSend, waitText, readHistory, waitForUserSubmission, waitForAssistantReply, waitForRunning, waitForAbortedAssistant, resolveVisibleAskUserA, resolveVisiblePlanApproval, getInteractionStreamEvents, getActiveSessionId: () => activeSessionId, getCreatedSessionIds: () => new Set(createdSessionIds), invokeApi, invokeRaw, freeze, resume, screenshot: (name) => screenshot(client, options.outputDir, name), consoleErrors, exceptions, readSessionManifest, close }
}

async function runRecovery(harness, options, result) {
  await harness.openSession(options.session)
  const before = await harness.client.evaluate('({timeOrigin: performance.timeOrigin, navigationType: performance.getEntriesByType("navigation")[0]?.type ?? "unknown"})')
  const recoveryMessage = `请使用 Bash 执行 sleep 15，然后只回复 recovery-done。不要调用其他工具。`
  await harness.inputAndSend(recoveryMessage)
  const runningSnapshots = await harness.waitForRunning(20_000)
  const frozenAt = Date.now()
  await harness.freeze()
  await delay(20_000)
  await harness.resume()
  const reply = await harness.waitForAssistantReply(recoveryMessage, 'recovery-done', 90_000)
  const after = await harness.client.evaluate('({timeOrigin: performance.timeOrigin, navigationType: performance.getEntriesByType("navigation")[0]?.type ?? "unknown"})')
  result.recovery = { frozenMs: Date.now() - frozenAt, finalAnswerSeen: Boolean(reply?.assistant), runningSnapshots: runningSnapshots.length, pageReloaded: before.timeOrigin !== after.timeOrigin, before, after }
  if (result.recovery.pageReloaded) throw new Error('冻结恢复触发了整页重载')
}

async function runInteractions(harness, options, result) {
  const harnessSessionTitle = `web-remote-harness-ask-plan-${Date.now()}`
  const harnessSession = await harness.createHarnessSession(harnessSessionTitle)
  await harness.setPermissionMode('plan')
  result.harnessSession = { title: harnessSessionTitle, id: harnessSession?.id ?? null, workspaceId: harnessSession?.workspaceId ?? null, permissionMode: 'plan' }
  const askMessage = '请用 AskUserQuestion 工具问我一个二选一问题（A 或 B），我回答后只回复我选了什么'
  const existingAsk = await harness.client.evaluate('Boolean(document.querySelector(".ask-user-banner"))')
  if (!existingAsk) await harness.inputAndSend(askMessage)
  await waitUntil(harness.client, `Boolean(document.querySelector('.ask-user-banner')) && document.body.innerText.includes('Proma Agent 需要你的输入')`, 90_000)
  const askCard = await harness.screenshot('ask-question-card')
  result.screenshots.push(askCard)
  await harness.resolveVisibleAskUserA()
  const askReply = await harness.waitForAssistantReply(askMessage, 'A', 90_000)
  const askAnswerScreenshot = await harness.screenshot('ask-answer-a')
  result.screenshots.push(askAnswerScreenshot)
  const askSessionId = harness.getActiveSessionId()
  const askStreamEvents = await harness.getInteractionStreamEvents()
  result.askUser = { cardVisible: true, selected: 'A', assistantContainsA: Boolean(askReply?.assistant), cardScreenshot: askCard, answerScreenshot: askAnswerScreenshot, interactionEvents: askStreamEvents.filter((event) => event.sessionId === askSessionId && event.type.startsWith('ask_user_')) }
  if (!result.askUser.interactionEvents.some((event) => event.type === 'ask_user_request') || !result.askUser.interactionEvents.some((event) => event.type === 'ask_user_resolved')) throw new Error('AskUser 交互事件未完整通过手机镜像链路')

  const planMessage = '写一个只有一步的计划：回复 done，然后提交审批'
  await harness.inputAndSend(planMessage)
  await waitUntil(harness.client, `document.body.innerText.includes('Agent 计划待审批')`, 90_000)
  const planSessionId = harness.getActiveSessionId()
  const pendingAtApproval = await harness.invokeApi('getPendingRequests')
  const pendingPlan = pendingAtApproval?.exitPlans?.find((request) => request?.sessionId === planSessionId)
  const activeAtApproval = await harness.invokeApi('listActiveAgentSessionSnapshots')
  const streamStillRunningForApproval = Array.isArray(activeAtApproval) && activeAtApproval.some((snapshot) => snapshot?.sessionId === planSessionId)
  const planCard = await harness.screenshot('exit-plan-approval')
  result.screenshots.push(planCard)
  const approve = await findElement(harness.client, '批准并完全自动执行', 'button')
  await touchAt(harness.client, approve.x, approve.y)
  const planReply = await harness.waitForAssistantReply(planMessage, 'done', 90_000)
  const planDoneScreenshot = await harness.screenshot('exit-plan-done')
  result.screenshots.push(planDoneScreenshot)
  const interactionEvents = await harness.getInteractionStreamEvents()
  const pendingAfterApproval = await harness.invokeApi('getPendingRequests')
  const pendingPlanCleared = !pendingAfterApproval?.exitPlans?.some((request) => request?.sessionId === planSessionId)
  const finalSessionMeta = (await harness.readSessionManifest()).find((session) => session.id === planSessionId)
  result.exitPlan = { approvalVisible: true, approved: true, assistantContainsDone: Boolean(planReply?.assistant), approvalScreenshot: planCard, doneScreenshot: planDoneScreenshot, sessionId: planSessionId, pendingRequestCaptured: Boolean(pendingPlan), activeRunWaiting: streamStillRunningForApproval, pendingClearedAfterApproval: pendingPlanCleared, permissionModeAfterApproval: finalSessionMeta?.permissionMode, interactionEvents: interactionEvents.filter((event) => event.sessionId === planSessionId && event.type.startsWith('exit_plan_mode_')), cardText: await harness.client.evaluate('document.body.innerText.includes("Agent 计划待审批") ? "approval card was visible before approval" : "approval card closed after response"') }
  if (!result.exitPlan.pendingRequestCaptured || !result.exitPlan.activeRunWaiting) throw new Error('计划审批等待状态不成立：缺少待处理请求或运行快照')
  if (!result.exitPlan.pendingClearedAfterApproval) throw new Error('审批后 ExitPlan 待处理请求未清除')
  if (!result.exitPlan.interactionEvents.some((event) => event.type === 'exit_plan_mode_request')) throw new Error('手机端未通过主窗口镜像收到 exit_plan_mode_request')
  if (!result.exitPlan.interactionEvents.some((event) => event.type === 'exit_plan_mode_resolved')) throw new Error('手机端审批后未收到 exit_plan_mode_resolved')
}

async function runAbort(harness, options, result) {
  const harnessSessionTitle = `web-remote-harness-abort-${Date.now()}`
  const harnessSession = await harness.createHarnessSession(harnessSessionTitle)
  result.harnessSession = { title: harnessSessionTitle, id: harnessSession?.id ?? null, workspaceId: harnessSession?.workspaceId ?? null }
  const abortMessage = '从 1 慢慢数到 300，每行一个数字；开始前先用 Bash 执行 sleep 15，然后继续，不要调用其他工具'
  if (await harness.resolveVisibleAskUserA()) await delay(2_000)
  if (await harness.resolveVisiblePlanApproval()) await delay(2_000)
  await harness.inputAndSend(abortMessage)
  await waitUntil(harness.client, `Boolean(document.querySelector('button[aria-label="停止 Agent"],button[aria-label="再次停止 Agent"]'))`, 60_000)
  const stop = await harness.client.evaluate(`(() => { const n=document.querySelector('button[aria-label="停止 Agent"],button[aria-label="再次停止 Agent"]'); if(!n)return null; const r=n.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,aria:n.getAttribute('aria-label')}; })()`)
  if (!stop) throw new Error('停止按钮在等待后消失')
  await harness.client.evaluate('document.querySelector(\'button[aria-label="停止 Agent"],button[aria-label="再次停止 Agent"]\')?.click()')
  await delay(500)
  if (await harness.client.evaluate('Boolean(document.querySelector("button[aria-label=\\"停止 Agent\\"],button[aria-label=\\"再次停止 Agent\\"]"))')) {
    await harness.invokeApi('stopAgent', [harness.getActiveSessionId()]).catch(() => {})
  }
  const aborted = await harness.waitForAbortedAssistant(abortMessage, 30_000)
  await delay(500)
  const screenshotPath = await harness.screenshot(`abort-${options.width}x${options.height}`)
  result.screenshots.push(screenshotPath)
  const pageStopped = await harness.client.evaluate(`([...document.querySelectorAll('[data-message-role="assistant"]')].some((node) => (node.innerText || '').includes('已被用户中断')))`)
  result.abort = { stopClicked: true, historyAborted: Boolean(aborted?.assistant), pageStopped, screenshot: screenshotPath, viewport: { width: options.width, height: options.height } }
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
  for (let index = 0; index < 2; index++) {
    await harness.client.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await harness.client.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  }
  await delay(300)
  await harness.navigate('/app/')
  await waitUntil(harness.client, `document.body.innerText.includes('Agent') && !document.body.innerText.includes('正在启动 Proma')`, 60_000)
  const sessions = await harness.invokeApi('listAgentSessions')
  const targetSession = Array.isArray(sessions) ? sessions.find((item) => item?.title === 'test' || item?.title === options.session.split('/').at(-1)) : null
  if (!targetSession?.id || !targetSession.channelId) throw new Error('找不到可用于只读 Skill 验证的目标会话元数据')
  const beforeSkillText = await harness.client.evaluate('document.body.innerText')
  await harness.invokeApi('sendAgentMessage', [{ sessionId: targetSession.id, userMessage: '/status', rawUserMessage: '/status', channelId: targetSession.channelId, modelId: targetSession.modelId, workspaceId: targetSession.workspaceId }])
  await delay(20_000)
  const skillText = await harness.client.evaluate('document.body.innerText')
  const skillChanged = skillText.length > beforeSkillText.length + 20 && skillText.includes('/status')
  const skillScreenshot = await harness.screenshot('extra-readonly-skill')
  result.screenshots.push(skillScreenshot)
  result.readonlySkill = { finalReplySeen: skillChanged, screenshot: skillScreenshot, tail: skillText.slice(-600) }
  if (!skillChanged) throw new Error('只读 Skill 未出现新的最终回复文本')
}

async function runPreloadRecovery(harness, options, result) {
  const preloadPath = join(REPO_ROOT, 'apps/electron/dist/web-remote/preload.js')
  if (!existsSync(preloadPath)) throw new Error(`测试前 web preload 产物不存在：${preloadPath}`)
  rmSync(preloadPath, { force: true })
  result.preloadRecovery = { intentionallyDeleted: true, path: preloadPath }
  await harness.navigate('/app/')
  const page = await harness.client.evaluate('({title:document.title,text:document.body.innerText.slice(0,1200),root:Boolean(document.querySelector("#root")),errorPage:document.body.innerText.includes("手机界面暂不可用")})')
  const screenshotPath = await harness.screenshot('preload-recovery')
  result.screenshots.push(screenshotPath)
  result.preloadRecovery = { ...result.preloadRecovery, restored: existsSync(preloadPath), bytes: existsSync(preloadPath) ? readFileSync(preloadPath).byteLength : 0, page, screenshot: screenshotPath }
  if (!result.preloadRecovery.restored || page.errorPage || !page.text.includes('Agent')) throw new Error(`preload 删除后未自动恢复为可用页面：${JSON.stringify(result.preloadRecovery)}`)
}

async function runAttachments(harness, options, result) {
  const title = `web-remote-harness-attachments-${Date.now()}`
  const session = await harness.createHarnessSession(title)
  const textPath = join(options.outputDir, 'b1-attachment.txt')
  const imagePath = join(options.outputDir, 'b1-attachment.png')
  writeFileSync(textPath, 'B1_ATTACHMENT_FIRST_LINE\n第二行仅用于确认首行提取。\n')
  writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAANklEQVRIie3WuQkAQAwDwem/aV0VhgsWnAuMnjVOTwJ6kVy0gqaqWG2qwVmTKaoQeAkdfU3XDzLD/C7nwdQVAAAAAElFTkSuQmCC', 'base64'))

  const attachmentApiAvailable = await harness.client.evaluate(`Boolean(window.electronAPI && typeof window.electronAPI.openFileOrFolderDialog==='function' && typeof window.electronAPI.getAgentSessionPath==='function')`)
  if (!attachmentApiAvailable) throw new Error('手机 renderer 未暴露文件选择或会话目录 API')

  const sessionDirectory = await harness.invokeApi('getAgentSessionPath', [session.workspaceId, session.id])
  if (typeof sessionDirectory !== 'string' || !sessionDirectory) throw new Error('无法取得本次专用会话的工作目录')
  const selectFiles = async (paths, kind, visibleExpression) => {
    const paperclip = await findElement(harness.client, '附加文件或文件夹', 'button,[role="button"]')
    result.attachmentButton = paperclip
    const clicked = await harness.client.evaluate(`(() => {const button=[...document.querySelectorAll('button,[role="button"]')].find((node)=>node.getAttribute('aria-label')==='附加文件或文件夹');if(!button)return false;button.click();return true})()`)
    if (!clicked) throw new Error('未能通过 aria-label 点击附件按钮')
    const inputFound = await waitUntil(harness.client, `Boolean(document.querySelector('input[type="file"][accept^="image/*"]'))`, 3_000).catch(() => false)
    if (!inputFound) {
      const diagnostic = await harness.client.evaluate(`({webRemote:window.__PROMA_WEB_REMOTE__,inputs:[...document.querySelectorAll('input[type="file"]')].map((n)=>({accept:n.accept,connected:n.isConnected})),buttons:[...document.querySelectorAll('button,[role="button"]')].filter((n)=>n.getAttribute('aria-label')?.includes('附加文件')).map((n)=>({aria:n.getAttribute('aria-label'),pointerEvents:getComputedStyle(n).pointerEvents,opacity:getComputedStyle(n).opacity}))})`)
      throw new Error(`点击附件入口后未生成手机文件选择器：${JSON.stringify(diagnostic)}`)
    }
    const document = await harness.client.command('DOM.getDocument', { depth: -1 })
    const query = await harness.client.command('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type="file"][accept^="image/*"]' })
    if (!query.nodeId) throw new Error('手机文件选择器 input 未创建')
    await harness.client.command('DOM.setFileInputFiles', { nodeId: query.nodeId, files: paths })
    try { await waitUntil(harness.client, visibleExpression, 20_000) }
    catch (error) {
      const diagnostic = await harness.client.evaluate(`({body:document.body.innerText.slice(-1600),rendered:[...document.querySelectorAll('[data-input-mode="agent"] img[alt],[data-input-mode="agent"] span')].map((n)=>n.getAttribute('alt')||n.textContent||'').slice(-10)})`)
      throw new Error(`${error instanceof Error ? error.message : String(error)}; ${kind} 附件显示诊断=${JSON.stringify(diagnostic)}`)
    }
    const screenshotPath = await harness.screenshot(`attachment-${kind}-selected`)
    result.screenshots.push(screenshotPath)
    return screenshotPath
  }
  const textScreenshot = await selectFiles([textPath], 'text', `(() => [...document.querySelectorAll('[data-input-mode="agent"] span')].some((n)=>n.textContent?.includes('b1-at')&&n.parentElement?.classList.contains('group/attachment')))()`)
  const textFilePath = join(sessionDirectory, 'attachments', 'b1-attachment.txt')
  const textFileEvidence = { filename: 'b1-attachment.txt', targetPath: textFilePath, exists: existsSync(textFilePath), size: existsSync(textFilePath) ? readFileSync(textFilePath).byteLength : null, firstLine: existsSync(textFilePath) ? readFileSync(textFilePath, 'utf8').split(/\r?\n/, 1)[0] : null }
  if (!textFileEvidence.exists) throw new Error(`文本附件未写入专用会话目录: ${JSON.stringify(textFileEvidence)}`)

  const textPrompt = '读取我附加的文本文件，只回复其中的第一行。'
  await harness.inputAndSend(textPrompt)
  const textReply = await harness.waitForAssistantReply(textPrompt, 'B1_ATTACHMENT_FIRST_LINE', 90_000)
  const textUser = textReply.history.findLast((message) => sdkMessageRole(message) === 'user' && sdkMessageText(message).includes(textPrompt))
  if (!textUser || !sdkMessageText(textUser).includes('b1-attachment.txt')) throw new Error('文本附件未出现在用户消息引用中')

  const imageScreenshot = await selectFiles([imagePath], 'image', `(() => [...document.querySelectorAll('[data-input-mode="agent"] img[alt]')].some((n)=>n.alt.includes('b1-attachment.png')))()`)
  const imageFilePath = join(sessionDirectory, 'attachments', 'b1-attachment.png')
  const imageFileEvidence = { filename: 'b1-attachment.png', targetPath: imageFilePath, exists: existsSync(imageFilePath), size: existsSync(imageFilePath) ? readFileSync(imageFilePath).byteLength : null }
  if (!imageFileEvidence.exists) throw new Error(`图片附件未写入专用会话目录: ${JSON.stringify(imageFileEvidence)}`)
  const imagePrompt = '请查看我附加的 PNG 图片，说出画面中占主导的颜色，只回复一个英文单词。'
  await harness.inputAndSend(imagePrompt)
  const imageReply = await harness.waitForAssistantReply(imagePrompt, 'Red', 90_000)
  const imageAnswer = sdkMessageText(imageReply.assistant)
  if (!/\bred\b/i.test(imageAnswer)) throw new Error(`Agent 未根据已附加 PNG 正确指出红色：${imageAnswer}`)

  const markdownPath = join(options.outputDir, 'b2-preview.md')
  writeFileSync(markdownPath, '# B2 Markdown preview marker\\n\\nFile preview should render this text.')
  const markdownSelectedScreenshot = await selectFiles([markdownPath], 'markdown', `document.body.innerText.includes('attachments/b2-pr')`)
  const markdownFilePath = join(sessionDirectory, 'attachments', 'b2-preview.md')
  if (!existsSync(markdownFilePath)) throw new Error('Markdown 附件未写入本次 harness 专用会话目录')
  const finalScreenshot = await harness.screenshot('attachments-sent')
  result.screenshots.push(finalScreenshot)
  result.attachments = { session: { id: session.id, title: session.title, workspaceId: session.workspaceId }, files: [textFileEvidence, imageFileEvidence, { filename: 'b2-preview.md', exists: existsSync(markdownFilePath) }], textUserMessageContainsAttachment: true, textAssistantReplyContainsFirstLine: Boolean(textReply.assistant), imageShownInComposer: true, imageAssistantIdentifiedRed: true, textSelectedScreenshot: textScreenshot, imageSelectedScreenshot: imageScreenshot, markdownSelectedScreenshot, finalScreenshot }
}

async function runSmoke(harness, options, result) {
  result.steps.push({ name: 'load', ok: true, url: new URL('/app/', options.url).toString() })
  const title = `web-remote-harness-smoke-${Date.now()}`
  const session = await harness.createHarnessSession(title)
  result.harnessSession = { id: session.id, title: session.title, workspaceId: session.workspaceId }
  result.steps.push({ name: 'open-session', ok: true, session: title })
  const smokeMessage = '只回复 pong'
  await harness.inputAndSend(smokeMessage)
  await harness.waitForAssistantReply(smokeMessage, 'pong', 90_000)
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
  const result = { startedAt: new Date().toISOString(), options: { url: options.url, suite: options.suite, session: options.session, width: options.width, height: options.height, deviceScaleFactor: options.deviceScaleFactor, userAgent: options.userAgent, outputDir: options.outputDir }, steps: [], screenshots: [], consoleErrors: [], exceptions: [], pairedDeviceId: null, revoked: false, chromeExited: false, profileRemoved: false }
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
    const secondAppLoad = await harness.navigate('/app/')
    await harness.installInteractionStreamAudit()
    result.loadMetrics = { first: paired.firstAppLoad, second: secondAppLoad }
    result.sessionManifestBefore = await harness.readSessionManifest()
    if (options.suite === 'smoke') await runSmoke(harness, options, result)
    else if (options.suite === 'recovery') await runRecovery(harness, options, result)
    else if (options.suite === 'interactions') await runInteractions(harness, options, result)
    else if (options.suite === 'abort') await runAbort(harness, options, result)
    else if (options.suite === 'extra') await runExtra(harness, options, result)
    else if (options.suite === 'attachments') await runAttachments(harness, options, result)
    else if (options.suite === 'preload-recovery') await runPreloadRecovery(harness, options, result)
    else if (options.suite === 'keyboard') {
      if (options.userAgent === 'desktop') throw new Error('keyboard 套件要求 android 或 iphone UA')
      await harness.openSession(options.session)
      const beforeHeight = await harness.client.evaluate('window.visualViewport?.height ?? window.innerHeight')
      await harness.client.command('Emulation.setDeviceMetricsOverride', { width: options.width, height: Math.max(400, options.height - 300), deviceScaleFactor: options.deviceScaleFactor, mobile: true, screenWidth: options.width, screenHeight: options.height })
      await harness.client.evaluate('window.visualViewport?.dispatchEvent(new Event("resize")); window.dispatchEvent(new Event("resize"))')
      const input = await harness.client.evaluate(`(() => {const n=document.querySelector('textarea:not([disabled]),[contenteditable="true"]');if(!n)return null;n.focus();n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {tag:n.tagName,top:r.top,bottom:r.bottom,height:r.height}})()`)
      if (!input) throw new Error('未找到可聚焦的会话输入框')
      await delay(500)
      await harness.client.evaluate('window.visualViewport?.dispatchEvent(new Event("resize"))')
      const after = await harness.client.evaluate(`(() => {const n=document.querySelector('textarea:not([disabled]),[contenteditable="true"]');const r=n?.getBoundingClientRect();return {viewportHeight:window.visualViewport?.height??innerHeight,input:r?{top:r.top,bottom:r.bottom,height:r.height}:null,keyboardInset:getComputedStyle(document.body).getPropertyValue('--web-remote-keyboard-inset').trim()}})()`)
      const screenshotPath = await harness.screenshot(`keyboard-${options.userAgent}`)
      result.keyboard = { beforeHeight, simulatedViewportHeight: after.viewportHeight, input: after.input, keyboardInset: after.keyboardInset, visible: !!after.input && after.input.top >= 0 && after.input.bottom <= after.viewportHeight, screenshot: screenshotPath }
      result.screenshots.push(screenshotPath)
      await harness.client.command('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: options.deviceScaleFactor, mobile: true, screenWidth: options.width, screenHeight: options.height })
      await harness.client.evaluate('window.visualViewport?.dispatchEvent(new Event("resize"));document.activeElement?.blur()')
      if (!result.keyboard.visible) throw new Error(`模拟键盘时输入框被遮挡: ${JSON.stringify(result.keyboard)}`)
    }
    else if (options.suite === 'desktop-admin-denied') {
      if (options.width < 768 || options.height < 600) throw new Error('desktop-admin-denied 需要桌面视口，例如 1280×800')
      const channels = ['web-remote:admin-get', 'web-remote:admin-save', 'web-remote:admin-pair', 'web-remote:admin-revoke']
      result.desktopAdminDenied = { mobileViewport: await harness.client.evaluate('window.matchMedia("(max-width: 767px)").matches'), visible: await harness.client.evaluate('document.body.innerText.includes("手机访问")'), denied: [] }
      for (const channel of channels) {
        let denied = false
        try {
          const response = await harness.invokeRaw(channel, channel.endsWith('save') ? [{}] : channel.endsWith('revoke') ? ['harness'] : [])
          denied = response?.denied === true && response?.channel === channel
        } catch (error) { denied = (error && typeof error === 'object' && error.denied === true && error.channel === channel) || /denied|禁止|拒绝/i.test(String(error)) }
        result.desktopAdminDenied.denied.push({ channel, denied })
        if (!denied) throw new Error(`远程桌面视口未拒绝管理 IPC: ${channel}`)
      }
      result.screenshots.push(await harness.screenshot('desktop-admin-denied'))
      if (result.desktopAdminDenied.mobileViewport || result.desktopAdminDenied.visible) throw new Error('手机访问管理分区在远程桌面视口意外可见或被识别为移动视口')
    }
    else if (options.suite === 'all') { await runSmoke(harness, options, result); await runRecovery(harness, options, result); await runInteractions(harness, options, result); await runAbort(harness, options, result); await runExtra(harness, options, result) }
    else throw new Error(`未知套件: ${options.suite}`)
  } catch (error) {
    result.error = error instanceof Error ? error.stack ?? error.message : String(error)
  } finally {
    result.consoleErrors = harness.consoleErrors
    result.exceptions = harness.exceptions
    const harnessSessionCleanup = { beforeIds: [], deletedIds: [], afterIds: [], errors: [] }
    try {
      const beforeDelete = await harness.readSessionManifest()
      harnessSessionCleanup.beforeIds = beforeDelete.map((session) => session.id)
      const createdIds = harness.getCreatedSessionIds()
      const createdBeforeDelete = beforeDelete.filter((session) => createdIds.has(session.id)).map((session) => session.id)
      const acceptDeleteConfirm = (event) => {
        if (event.type === 'confirm') void harness.client.command('Page.handleJavaScriptDialog', { accept: true }).catch((error) => harnessSessionCleanup.errors.push(String(error)))
      }
      harness.client.on('Page.javascriptDialogOpening', acceptDeleteConfirm)
      for (const sessionId of createdBeforeDelete) {
        try {
          await harness.invokeApi('deleteAgentSession', [sessionId])
          const end = Date.now() + 15000
          let remains = true
          while (Date.now() < end) {
            const sessions = await harness.readSessionManifest()
            remains = sessions.some((session) => session.id === sessionId)
            if (!remains) break
            await delay(250)
          }
          if (remains) throw new Error(`会话删除后仍存在: ${sessionId}`)
          harnessSessionCleanup.deletedIds.push(sessionId)
        } catch (error) { harnessSessionCleanup.errors.push(`${sessionId}: ${String(error)}`) }
      }
      harness.client.off('Page.javascriptDialogOpening', acceptDeleteConfirm)
      harnessSessionCleanup.afterIds = (await harness.readSessionManifest()).map((session) => session.id)
      result.harnessSessionCleanup = harnessSessionCleanup
      if (harnessSessionCleanup.errors.length && !result.error) result.error = `Harness 专用会话清理失败: ${harnessSessionCleanup.errors.join('; ')}`
    } catch (error) {
      harnessSessionCleanup.errors.push(String(error))
      result.harnessSessionCleanup = harnessSessionCleanup
      if (!result.error) result.error = `无法执行 harness 专用会话清理: ${String(error)}`
    }
    try {
      result.sessionManifestAfter = await harness.readSessionManifest()
      const beforeById = new Map((result.sessionManifestBefore ?? []).map((item) => [item.id, item]))
      const afterById = new Map(result.sessionManifestAfter.map((item) => [item.id, item]))
      const createdIds = harness.getCreatedSessionIds()
      result.existingSessionManifestComparison = [...beforeById.values()].map((before) => ({
        id: before.id,
        before,
        after: afterById.get(before.id) ?? null,
        unchanged: JSON.stringify(before) === JSON.stringify(afterById.get(before.id) ?? null),
      }))
      result.createdHarnessSessionIds = [...createdIds]
      const changed = result.existingSessionManifestComparison.filter((item) => !item.unchanged)
      if (changed.length > 0 && !result.error) result.error = `已有会话标题/权限模式发生变化: ${JSON.stringify(changed)}`
    } catch (error) {
      result.sessionManifestError = String(error)
      if (!result.error) result.error = `无法导出运行后会话清单: ${String(error)}`
    }
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
