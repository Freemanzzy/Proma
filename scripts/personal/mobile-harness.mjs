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
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir, tmpdir } from 'node:os'
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

function isKnownWebAssemblyCspInitializationException(entry) {
  const text = String(entry?.description ?? entry?.text ?? '')
  return /WebAssembly\.instantiate/.test(text) && /unsafe-eval/.test(text) && /script-src/.test(text)
}

function summarizeHarnessException(entry) {
  const text = String(entry?.description ?? entry?.text ?? 'unknown')
  if (isKnownWebAssemblyCspInitializationException(entry)) return 'WebAssembly.instantiate blocked by current script-src CSP'
  return text.split('\n')[0].slice(0, 180)
}

/** Split only by the action-start count; matching error text never removes an action exception. */
export function measureHarnessExceptionWindow(exceptions, baselineCount) {
  const safeCount = Math.max(0, Math.min(exceptions.length, Math.trunc(baselineCount)))
  const baseline = exceptions.slice(0, safeCount)
  const actionExceptions = exceptions.slice(safeCount)
  return {
    baselineCount: baseline.length,
    baselineCategories: baseline.map(summarizeHarnessException),
    actionCount: actionExceptions.length,
    actionCategories: actionExceptions.map(summarizeHarnessException),
    actionExceptions,
  }
}

/** Shared suite gate: only exceptions after the action-start baseline fail the run. */
export function evaluateHarnessExceptionWindow(exceptions, baselineCount) {
  const window = measureHarnessExceptionWindow(exceptions, baselineCount)
  return { ...window, newActionExceptions: window.actionCount, passed: window.actionCount === 0 }
}

/** Finish delayed page-start exceptions before defining a suite's action baseline. */
export async function waitForHarnessExceptionQuietPeriod(harness, quietMs = 800, maxWaitMs = 4_000) {
  const startedAt = Date.now()
  let count = harness.exceptions.length
  let lastChangedAt = startedAt
  while (Date.now() - startedAt < maxWaitMs) {
    await delay(100)
    if (harness.exceptions.length !== count) {
      count = harness.exceptions.length
      lastChangedAt = Date.now()
    }
    if (Date.now() - lastChangedAt >= quietMs) break
  }
  return { baselineCount: harness.exceptions.length, settledAfterMs: Date.now() - startedAt }
}

/** Wait until in-flight WebSocket frames have drained after a reconnect snapshot. */
export async function waitForHarnessWebSocketQuietPeriod(harness, quietMs = 800, maxWaitMs = 30_000) {
  const startedAt = Date.now()
  let frameCount = harness.websocketFramesReceived.length
  let lastChangedAt = startedAt
  while (Date.now() - startedAt < maxWaitMs) {
    await delay(100)
    if (harness.websocketFramesReceived.length !== frameCount) {
      frameCount = harness.websocketFramesReceived.length
      lastChangedAt = Date.now()
    }
    if (Date.now() - lastChangedAt >= quietMs) {
      return { settledAfterMs: Date.now() - startedAt, receivedFrames: frameCount }
    }
  }
  throw new Error(`WebSocket 接收帧在 ${maxWaitMs} ms 内未静默`)
}

/** Match only structured HTTP status fields or explicit 429 status/error phrases, never bare digits. */
export function isHttp429Signal(value) {
  if (value && typeof value === 'object') {
    const record = value
    const statuses = [record.status, record.statusCode, record.httpStatus, record.response?.status]
    if (statuses.some((status) => Number(status) === 429)) return true
    const phrases = [record.statusText, record.message, record.error, record.text]
    return phrases.some((phrase) => typeof phrase === 'string' && isHttp429Signal(phrase))
  }
  if (typeof value !== 'string') return false
  return /\bHTTP(?:\/\d(?:\.\d)?)?\s+429\b/i.test(value)
    || /\bstatus\s*[:=]?\s*429\b/i.test(value)
    || /\b429\s+Too Many Requests\b/i.test(value)
    || /\bToo Many Requests\b/i.test(value)
}

/** Network profile is parameterized in decimal bits/s; default matches the current 3 Mbps relay. */
export function resolveHarnessNetworkProfile(options = {}) {
  const downloadMbps = Number(options.downloadMbps ?? 3)
  const uploadMbps = Number(options.uploadMbps ?? 1)
  const latencyMs = Number(options.latencyMs ?? 50)
  if (!Number.isFinite(downloadMbps) || downloadMbps <= 0 || !Number.isFinite(uploadMbps) || uploadMbps <= 0 || !Number.isFinite(latencyMs) || latencyMs < 0) {
    throw new Error('网络参数无效；download/upload Mbps 必须大于 0，latencyMs 不得为负数')
  }
  const downloadBitsPerSecond = Math.round(downloadMbps * 1_000_000)
  const uploadBitsPerSecond = Math.round(uploadMbps * 1_000_000)
  return {
    downloadMbps,
    uploadMbps,
    latencyMs,
    downloadBitsPerSecond,
    uploadBitsPerSecond,
    downloadThroughput: downloadBitsPerSecond / 8,
    uploadThroughput: uploadBitsPerSecond / 8,
    connectionType: downloadMbps <= 1 ? 'cellular2g' : downloadMbps <= 10 ? 'cellular3g' : 'cellular4g',
  }
}

function parseArgs(argv) {
  const result = { url: process.env.PROMA_WEB_REMOTE_URL ?? '', suite: 'smoke', session: process.env.PROMA_WEB_REMOTE_SESSION ?? '独立站/test', width: 412, height: 915, deviceScaleFactor: 3, userAgent: 'android', outputDir: DEFAULT_OUTPUT_DIR, chromePath: process.env.CHROME_PATH ?? '', pairScript: join(REPO_ROOT, 'scripts/personal/web-remote.sh'), downloadMbps: Number(process.env.PROMA_WEB_REMOTE_DOWNLOAD_MBPS ?? 3), uploadMbps: Number(process.env.PROMA_WEB_REMOTE_UPLOAD_MBPS ?? 1), latencyMs: Number(process.env.PROMA_WEB_REMOTE_LATENCY_MS ?? 50) }
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
    else if (arg === '--timeout-ms') result.timeoutMs = Number(value())
    else if (arg === '--download-mbps') result.downloadMbps = Number(value())
    else if (arg === '--upload-mbps') result.uploadMbps = Number(value())
    else if (arg === '--latency-ms') result.latencyMs = Number(value())
    else if (arg === '--chrome-path') result.chromePath = value()
    else if (arg === '--pair-script') result.pairScript = resolve(value())
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: mobile-harness.mjs --url <https://host> [--suite smoke] [--session <session>] [--download-mbps 3] [--upload-mbps 1] [--latency-ms 50] [--output-dir /tmp/out]')
      process.exit(0)
    } else throw new Error(`未知参数: ${arg}`)
  }
  if (!result.url) throw new Error('必须通过 --url 或 PROMA_WEB_REMOTE_URL 提供 Web Remote 地址')
  if (!/^https?:\/\//.test(result.url)) throw new Error('--url 必须是 http(s) 地址')
  if (!Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 240 || result.height < 400) throw new Error('视口尺寸无效')
  if (!(result.deviceScaleFactor >= 1 && result.deviceScaleFactor <= 3.5)) throw new Error('deviceScaleFactor 必须在 1 到 3.5 之间')
  if (!['android', 'iphone', 'desktop'].includes(result.userAgent)) throw new Error('--user-agent 仅支持 android|iphone|desktop')
  if (result.timeoutMs === undefined) result.timeoutMs = 300_000
  if (!Number.isInteger(result.timeoutMs) || result.timeoutMs < 1000 || result.timeoutMs > 1_800_000) throw new Error('--timeout-ms 必须是 1000 到 1800000 之间的整数')
  result.networkProfile = resolveHarnessNetworkProfile(result)
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
    this.ws.on('close', () => { for (const [id, request] of this.pending) { this.pending.delete(id); request.reject(new Error('CDP connection closed')) } })
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

  command(method, params = {}, timeoutMs = 15_000) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout ${method} after ${timeoutMs}ms`)) }, timeoutMs)
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value) }, reject: (error) => { clearTimeout(timer); reject(error) }, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression, returnByValue = true) {
    lastHarnessStep = `Runtime.evaluate ${String(expression).slice(0, 120)}`
    let result
    try {
      await this.command('Runtime.evaluate', { expression: '1', returnByValue: true, timeout: 3000 }, 3500)
    } catch (error) {
      throw new Error(`page_unresponsive: ${String(error)}`)
    }
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
  lastHarnessStep = `waitUntil ${String(expression).slice(0, 120)}`
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

function websocketExtensions(headers) {
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === 'sec-websocket-extensions')
  return typeof entry?.[1] === 'string' ? entry[1] : ''
}

async function assertIpcCompressionHandshake(harness, options, result) {
  const end = Date.now() + 15_000
  let response
  while (Date.now() < end) {
    response = harness.websocketHandshakes.find((item) => {
      try {
        return new URL(item.url ?? '', 'http://127.0.0.1').pathname === '/api/ipc' && /permessage-deflate/i.test(websocketExtensions(item.headers))
      } catch { return false }
    })
    if (response) break
    await delay(100)
  }
  const extension = response ? websocketExtensions(response.headers) : ''
  result.websocketCompression = { userAgent: options.userAgent, ipcHandshakeStatus: response?.status ?? null, extension: extension || null }
  if (!response || !/permessage-deflate/i.test(extension)) throw new Error(`/api/ipc 未协商 permessage-deflate：${JSON.stringify(result.websocketCompression)}`)
  result.websocketCompression.cdpFramePayload = 'Network.webSocketFrameReceived.payloadData 按解压后的 WebSocket 消息内容报告，无法从该字段测量线上的压缩字节。'
}

let lastHarnessStep = 'harness initialization'

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
  lastHarnessStep = `touchAt ${Math.round(x)},${Math.round(y)}`
  await client.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] })
  await client.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function touchText(client, text, selector = 'body *') {
  const point = await findElement(client, text, selector)
  await touchAt(client, point.x, point.y)
  return point
}

async function screenshot(client, outputDir, name) {
  lastHarnessStep = `screenshot ${name}`
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
  let lastAskUserTouchDiagnostic = null
  client.on('Runtime.consoleAPICalled', (event) => { if (['error', 'assert'].includes(event.type)) consoleErrors.push({ type: event.type, args: event.args?.map((arg) => arg.value ?? arg.description) }) })
  client.on('Runtime.exceptionThrown', (event) => exceptions.push({ text: event.exceptionDetails?.text, description: event.exceptionDetails?.exception?.description }))
  await client.command('Runtime.enable')
  await client.command('Page.enable')
  await client.command('Network.enable')
  const websocketUrls = new Map()
  const websocketHandshakes = []
  const websocketFramesReceived = []
  const websocketFramesSent = []
  const historyReadRequests = []
  const websocketDataReceived = []
  const http429Responses = []
  client.on('Network.webSocketCreated', (event) => { websocketUrls.set(event.requestId, event.url) })
  client.on('Network.webSocketHandshakeResponseReceived', (event) => websocketHandshakes.push({ requestId: event.requestId, url: websocketUrls.get(event.requestId), status: event.response?.status, headers: event.response?.headers ?? {} }))
  client.on('Network.webSocketFrameReceived', (event) => {
    const url = websocketUrls.get(event.requestId)
    websocketFramesReceived.push({ requestId: event.requestId, url, payloadBytes: Buffer.byteLength(event.response?.payloadData ?? '', 'utf8'), opcode: event.response?.opcode })
  })
  client.on('Network.webSocketFrameSent', (event) => {
    const url = websocketUrls.get(event.requestId)
    const payloadData = event.response?.payloadData ?? ''
    websocketFramesSent.push({ requestId: event.requestId, url, payloadBytes: Buffer.byteLength(payloadData, 'utf8'), opcode: event.response?.opcode })
    if (url && new URL(url).pathname === '/api/ipc') {
      try {
        const request = JSON.parse(payloadData)
        if (request.type === 'invoke' && request.channel === 'agent:get-sdk-messages') {
          const options = request.args?.[1] && typeof request.args[1] === 'object' ? request.args[1] : {}
          historyReadRequests.push({
            budgetBytes: Number.isFinite(options.budgetBytes) ? options.budgetBytes : 2 * 1024 * 1024,
            endIndex: Number.isInteger(options.endIndex) ? options.endIndex : null,
            inlineImageBudgetBytes: Number.isFinite(options.inlineImageBudgetBytes) ? options.inlineImageBudgetBytes : 1024 * 1024,
          })
        }
      } catch {}
    }
  })
  client.on('Network.dataReceived', (event) => {
    const url = websocketUrls.get(event.requestId)
    if (url) websocketDataReceived.push({ requestId: event.requestId, url, dataLength: Number(event.dataLength ?? 0), encodedDataLength: Number(event.encodedDataLength ?? 0) })
  })
  let activeNavigation = null
  const loadMetrics = []
  client.on('Network.requestWillBeSent', (event) => {
    if (activeNavigation) activeNavigation.requestIds.add(event.requestId)
  })
  client.on('Network.responseReceived', (event) => {
    if (isHttp429Signal(event.response)) http429Responses.push({ status: 429, resourceType: event.type ?? null })
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
    if (path === '/app/' || path.startsWith('/app/')) {
      // readyState is reached before the heavy renderer has mounted React. Wait for actual
      // sidebar/mode controls and the authorized session index, not an arbitrary 2-second sleep.
      await waitUntil(client, `Boolean(document.querySelector('[data-web-remote-sidebar="left"]') && document.querySelector('.mode-btn') && window.electronAPI?.listAgentSessions)`, 45_000)
      await waitUntil(client, `window.electronAPI.listAgentSessions().then(items=>Array.isArray(items)&&items.length>0)`, 30_000)
      await delay(300)
    } else {
      await delay(300)
    }
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
    const menu = await findElement(client, '打开侧栏', '[data-web-remote-mobile-menu]')
    await touchAt(client, menu.x, menu.y)
    await waitUntil(client, `document.body.dataset.webRemoteSidebarOpen === 'true'`)
    await delay(300)
  }
  const clickSidebarText = async (text) => {
    if (options.width < 768 || options.userAgent !== 'desktop') await openDrawer()
    const aria = { 'MCP/Skills': 'MCP/Skills', Todo: 'Todo', '定时任务': '定时任务' }[text]
    const clicked = await client.evaluate(`(() => {const root=document.querySelector('[data-web-remote-sidebar="left"]');if(!root)return false;const nodes=[...root.querySelectorAll('button,[role="button"]')];const wanted=${quoteJs(aria ?? text)};const item=nodes.find(n=>(n.getAttribute('aria-label')||'').trim()===wanted)||(nodes.find(n=>(n.innerText||'').trim()===wanted));if(!item)return false;item.click();return true})()`)
    if (!clicked) throw new Error(`侧栏入口不存在或不可用: ${text}`)
    await delay(300)
    await client.evaluate(`delete document.body.dataset.webRemoteSidebarOpen`)
    return clicked
  }
  const createHarnessSession = async (title) => {
    const workspaces = await client.evaluate('window.electronAPI.listAgentWorkspaces()')
    // Web Remote returns only allowlisted workspace metadata; never guess a hidden workspace.
    const workspace = Array.isArray(workspaces) ? workspaces[0] : null
    if (!workspace?.id) throw new Error('当前授权范围没有可用于 harness 的工作区，拒绝创建会话')
    const existingIds = new Set((await readSessionManifest()).map((item) => item.id))
    if (options.width < 768 || options.userAgent !== 'desktop') await openDrawer()
    const newTaskAvailable = await client.evaluate('Boolean(document.querySelector(\'button[aria-label="新建任务"]\'))')
    if (!newTaskAvailable) {
      const switched = await client.evaluate(`(() => {const button=[...document.querySelectorAll('.mode-btn')].find(item=>(item.innerText||'').trim()==='Agent');if(!button)return false;button.click();return true})()`)
      if (switched) await waitUntil(client, 'Boolean(document.querySelector(\'button[aria-label="新建任务"]\'))', 10_000)
    }
    const currentWorkspaceId = await client.evaluate('window.electronAPI.getSettings().then((settings)=>settings?.agentWorkspaceId)')
    if (currentWorkspaceId !== workspace.id) {
      const workspaceHeading = await findElement(client, workspace.name, '[data-web-remote-sidebar="left"] *')
      await touchAt(client, workspaceHeading.x, workspaceHeading.y)
      await waitUntil(client, `window.electronAPI.getSettings().then((settings)=>settings?.agentWorkspaceId===${quoteJs(workspace.id)})`, 10_000)
    }
    const plus = await client.evaluate('(() => { const n=document.querySelector(\'button[aria-label="新建任务"]\'); if(!n)return null; const r=n.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()')
    if (!plus) {
      const state = await client.evaluate(`(async() => ({modeButtons:[...document.querySelectorAll('.mode-btn')].map(item=>(item.innerText||'').trim()),sidebarCount:document.querySelectorAll('[data-web-remote-sidebar="left"]').length,newTaskCount:document.querySelectorAll('button[aria-label="新建任务"]').length,agentCount:await window.electronAPI.listAgentSessions().then(items=>items.length)}))()`)
      throw new Error(`手机端找不到新建任务按钮；safe-ui=${JSON.stringify(state)}`)
    }
    await touchAt(client, plus.x, plus.y)
    const inputReady = await waitUntil(client, 'Boolean(document.querySelector(\'textarea:not([disabled]),[contenteditable="true"]\'))', 10_000).then(() => true, () => false)
    const afterCreateAttempt = await client.evaluate('window.electronAPI.listAgentSessions()').catch(() => [])
    for (const candidate of Array.isArray(afterCreateAttempt) ? afterCreateAttempt : []) {
      if (candidate?.id && !existingIds.has(candidate.id) && candidate.workspaceId === workspace.id && candidate.title === '新 Agent 会话' && Date.now() - Number(candidate.createdAt || 0) < 30_000) {
        createdSessionIds.add(candidate.id)
      }
    }
    if (!inputReady) throw new Error('新建按钮已点击，但当前视图未挂载可用会话输入框')
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
      const expectedLower = expectedText.toLocaleLowerCase()
      const assistantReply = userIndex >= 0
        ? last.slice(userIndex + 1).find((message) => sdkMessageRole(message) === 'assistant' && sdkMessageText(message).toLocaleLowerCase().includes(expectedLower))
        : null
      const pageAssistantHasText = await client.evaluate(`([...document.querySelectorAll('[data-message-role="assistant"]')].some((node) => (node.innerText || '').toLocaleLowerCase().includes(${quoteJs(expectedLower)})))`)
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
  const createHarnessSessionRaw = async (title, workspaceId, isDraft = false) => {
    const workspaces = await client.evaluate('window.electronAPI.listAgentWorkspaces()')
    const targetWorkspaceId = workspaceId ?? (Array.isArray(workspaces) ? workspaces[0]?.id : undefined)
    if (!targetWorkspaceId || !workspaces.some((workspace) => workspace?.id === targetWorkspaceId)) {
      throw new Error('拒绝在当前 Web Remote 允许工作区之外创建测试会话')
    }
    const created = await invokeRaw('agent:create-session', [title, undefined, targetWorkspaceId, undefined, isDraft])
    if (!created?.id || created.workspaceId !== targetWorkspaceId) throw new Error('主进程未在授权工作区创建 harness 会话')
    createdSessionIds.add(created.id)
    return created
  }
  const clickText = (text, selector = 'body *') => touchText(client, text, selector)
  const resolveVisibleAskUserA = async () => {
    if (!await client.evaluate('Boolean(document.querySelector(".ask-user-banner"))')) return false
    const before = await client.evaluate(`(() => {
      const banner=document.querySelector('.ask-user-banner')
      window.__askTouchAudit={events:[],ipc:[]}
      for(const type of ['touchstart','touchend','pointerdown','pointerup','click','keydown']) document.addEventListener(type,(event)=>{if(window.__askTouchAudit.events.length<100){const target=event.target;const r=target?.getBoundingClientRect?.();window.__askTouchAudit.events.push({at:performance.now(),type,target:{tag:target?.tagName,text:(target?.innerText||target?.textContent||'').trim().slice(0,120),aria:target?.getAttribute?.('aria-label'),outerHTML:target?.outerHTML?.slice(0,300)},rect:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null})}},true)
      const original=window.__PROMA_WEB_REMOTE_INVOKE
      if(typeof original==='function'&&!window.__askTouchInvokeWrapped){window.__askTouchInvokeWrapped=true;window.__PROMA_WEB_REMOTE_INVOKE=function(channel,...args){if(String(channel).includes('ask-user'))window.__askTouchAudit.ipc.push({at:performance.now(),channel,args});return original.call(this,channel,...args)}}
      return {buttons:[...(banner?.querySelectorAll('button')??[])].map((node)=>{const r=node.getBoundingClientRect();return {text:(node.innerText||node.textContent||'').trim(),aria:node.getAttribute('aria-label'),title:node.title,disabled:node.disabled,outerHTML:node.outerHTML.slice(0,300),rect:{x:r.x,y:r.y,w:r.width,h:r.height}}})}
    })()`)
    const optionA = await client.evaluate(`(() => {
      const visible=(node)=>{const r=node.getBoundingClientRect();const s=getComputedStyle(node);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'}
      const button=[...(document.querySelector('.ask-user-banner')?.querySelectorAll('button')??[])].find((node)=>visible(node)&&[...node.querySelectorAll('span')].some((span)=>(span.innerText||span.textContent||'').trim()==='A'))
      if(!button)return null
      const r=button.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,tag:button.tagName,text:(button.innerText||button.textContent||'').trim(),outerHTML:button.outerHTML.slice(0,300),rect:{x:r.x,y:r.y,w:r.width,h:r.height}}
    })()`)
    if(!optionA)throw new Error('找不到 AskUser 的 A 选项按钮（要求选项标签精确匹配）')
    const target = await client.evaluate(`(() => {const x=${optionA.x},y=${optionA.y};const n=document.elementFromPoint(x,y);return {tag:n?.tagName,text:(n?.innerText||n?.textContent||'').trim().slice(0,120),outerHTML:n?.outerHTML?.slice(0,300),rect:(()=>{const r=n?.getBoundingClientRect();return r?{x:r.x,y:r.y,w:r.width,h:r.height}:null})()}})()`)
    await touchAt(client, optionA.x, optionA.y)
    await delay(2_000)
    const after = await client.evaluate('({banner:Boolean(document.querySelector(".ask-user-banner")),audit:window.__askTouchAudit})')
    lastAskUserTouchDiagnostic = { before, optionA, target, after }
    const confirm = await client.evaluate(`(() => {
      const banner=document.querySelector('.ask-user-banner')
      const visible=(node)=>{const r=node.getBoundingClientRect();const style=getComputedStyle(node);return r.width>0&&r.height>0&&style.visibility!=='hidden'&&style.display!=='none'}
      const marked=banner?.querySelector('button[data-web-remote-ask-confirm="true"]')
      const node=marked??[...(banner?.querySelectorAll('button')??[])].filter(visible).at(-1)
      if(!node||node.disabled)return null
      const rect=node.getBoundingClientRect()
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,locator:marked?'stable-attribute':'last-visible-button'}
    })()`)
    if (!confirm) return false
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
  return { client, chrome, profile, pair, navigate, installInteractionStreamAudit, loadMetrics, openDrawer, clickSidebarText, clickText, openSession, createHarnessSession, createHarnessSessionRaw, setPermissionMode, inputAndSend, waitText, readHistory, waitForUserSubmission, waitForAssistantReply, waitForRunning, waitForAbortedAssistant, resolveVisibleAskUserA, resolveVisiblePlanApproval, getInteractionStreamEvents, getLastAskUserTouchDiagnostic: () => lastAskUserTouchDiagnostic, getActiveSessionId: () => activeSessionId, getCreatedSessionIds: () => new Set(createdSessionIds), invokeApi, invokeRaw, websocketUrls, websocketHandshakes, websocketFramesReceived, websocketFramesSent, historyReadRequests, websocketDataReceived, http429Responses, freeze, resume, screenshot: (name) => screenshot(client, options.outputDir, name), consoleErrors, exceptions, readSessionManifest, close }
}

async function runDeadSocket(harness, options, result) {
  // 模拟 iOS 切后台后“看似 OPEN 实已断开”的 IPC 连接：当前 /api/ipc 连接双向静默（发出的帧丢弃、收到的帧不再派发）。
  await harness.navigate('/app/')
  await harness.client.evaluate(`(() => {const orig=WebSocket.prototype.send;const seen=new Set();window.__deadSocketStats={sockets:0,dropped:0};WebSocket.prototype.send=function(data){if(String(this.url).includes('/api/ipc')){if(!seen.has(this)){seen.add(this);window.__deadSocketStats.sockets++}window.__ipcSocket=this}if(this.__dead){window.__deadSocketStats.dropped++;return}return orig.call(this,data)};return true})()`)
  await harness.client.evaluate(`window.__PROMA_WEB_REMOTE_INVOKE('agent:count-archived-sessions').then(()=>true)`)
  const killed = await harness.client.evaluate(`(() => {const ws=window.__ipcSocket;if(!ws)return false;ws.__dead=true;ws.onmessage=null;return true})()`)
  if (!killed) throw new Error('未捕获到 /api/ipc 连接')
  await delay(11_000)
  const outcome = await harness.client.evaluate(`(async () => {const started=Date.now();try{await window.__PROMA_WEB_REMOTE_INVOKE('agent:count-archived-sessions');return {ok:true,ms:Date.now()-started,stats:window.__deadSocketStats}}catch(error){return {ok:false,ms:Date.now()-started,error:String(error&&error.message||error),stats:window.__deadSocketStats}}})()`)
  result.deadSocket = outcome
  if (!outcome.ok || outcome.ms > 8_000 || outcome.stats.dropped < 1 || outcome.stats.sockets < 2) throw new Error(`失效连接未自动恢复：${JSON.stringify(outcome)}`)
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
  result.preserveHarnessSessionIds = harnessSession?.id ? [harnessSession.id] : []
  const askMessage = '请用 AskUserQuestion 工具问我一个二选一问题（A 或 B），我回答后只回复我选了什么'
  const existingAsk = await harness.client.evaluate('Boolean(document.querySelector(".ask-user-banner"))')
  if (!existingAsk) await harness.inputAndSend(askMessage)
  await waitUntil(harness.client, `Boolean(document.querySelector('.ask-user-banner')) && document.body.innerText.includes('Proma Agent 需要你的输入')`, 90_000)
  const askCard = await harness.screenshot('ask-question-card')
  result.screenshots.push(askCard)
  const askResolved = await harness.resolveVisibleAskUserA()
  result.askTouchDiagnostic = harness.getLastAskUserTouchDiagnostic()
  if (!askResolved) {
    const afterTouch = await harness.screenshot('ask-after-option-a')
    result.screenshots.push(afterTouch)
    throw new Error('找不到 AskUser 确认按钮（稳定标记与横幅末尾按钮均未命中）')
  }
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

async function runPush(harness, options, result) {
  if (options.userAgent !== 'android') throw new Error('Web Push 端到端 harness 当前限定 Android Chrome；iPhone Web Push 留待真机验收')
  const title = `web-remote-harness-push-${Date.now()}`
  const session = await harness.createHarnessSession(title)
  result.harnessSession = { id: session.id, title: session.title, workspaceId: session.workspaceId }
  const channels = await harness.invokeApi('listChannels').catch(() => [])
  const alternate = Array.isArray(channels) ? channels.find((channel) => channel?.enabled && !/chatgpt/i.test(channel.provider || '') && (channel.models || []).some((model) => model?.enabled)) : null
  if (alternate) {
    const model = alternate.models.find((item) => item?.enabled)
    await harness.invokeApi('updateAgentSessionModel', [session.id, alternate.id, model.id])
    result.pushTestModel = { provider: alternate.provider, model: model.id }
  } else result.pushTestModel = { usedSessionDefault: true }
  const origin = new URL(options.url).origin
  await harness.client.command('Browser.grantPermissions', { origin, permissions: ['notifications'] })
  const entry = await findElement(harness.client, '开启通知', 'button')
  await harness.client.evaluate("document.querySelector('[data-web-remote-notification-entry]')?.click()")
  await waitUntil(harness.client, `document.querySelector('[data-web-remote-notification-entry]')?.dataset.notifyState === 'on'`, 30_000)
  result.notifyEntryAfterSubscribe = await harness.client.evaluate(`(() => { const b=document.querySelector('[data-web-remote-notification-entry]'); const t=document.querySelector('[data-web-remote-toast]'); return { state:b?.dataset.notifyState, aria:b?.getAttribute('aria-label'), disabled:b?.disabled, hasSvg:!!b?.querySelector('svg'), text:(b?.innerText||'').trim(), toast:t?.textContent||null } })()`)
  if (result.notifyEntryAfterSubscribe.disabled || !result.notifyEntryAfterSubscribe.hasSvg || result.notifyEntryAfterSubscribe.text) throw new Error(`notification entry rendering regressed: ${JSON.stringify(result.notifyEntryAfterSubscribe)}`)
  result.screenshots.push(await harness.screenshot('notify-on'))
  const subscribed = await harness.client.evaluate(`fetch('/api/push/subscription',{credentials:'include'}).then(r=>r.json())`)
  const browserSubscription = await harness.client.evaluate(`navigator.serviceWorker.ready.then(r=>r.pushManager.getSubscription().then(s=>({registered:!!s,endpointHost:s?new URL(s.endpoint).host:null})))`)
  result.pushSubscription = { serverRegistered: subscribed.subscribed === true, browser: browserSubscription, permission: await harness.client.evaluate('Notification.permission'), entry }
  if (!result.pushSubscription.serverRegistered || !browserSubscription.registered) throw new Error(`Push subscription registration failed: ${JSON.stringify(result.pushSubscription)}`)

  const prompt = '只回复 pong'
  await harness.inputAndSend(prompt)
  await harness.client.evaluate(`fetch('/api/push/presence',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:null,visible:false})})`)
  await harness.navigate('/app/')
  const sessionUrl = `/api/sessions/${encodeURIComponent(session.id)}/messages?limit=200`
  const deadline = Date.now() + 90_000
  let reply = false; let notifications = []
  while (Date.now() < deadline) {
    const state = await harness.client.evaluate(`Promise.all([fetch(${quoteJs(sessionUrl)},{credentials:'include'}).then(r=>r.json()),navigator.serviceWorker.ready.then(r=>r.getNotifications().then(ns=>ns.map(n=>({title:n.title,body:n.body,sessionId:n.data?.sessionId}))))])`)
    const messages = state?.[0] ?? []
    reply = messages.some((message) => message?.role === 'assistant' && JSON.stringify(message).toLowerCase().includes('pong'))
    notifications = state?.[1] ?? []
    if (reply && notifications.some((item) => item.sessionId === session.id)) break
    await delay(500)
  }
  result.pushDelivery = { assistantReplied: reply, notifications, received: notifications.some((item) => item.sessionId === session.id) }
  result.screenshots.push(await harness.screenshot('web-push-result'))
  if (!result.pushDelivery.received) throw new Error(`No Web Push notification received within 90s: ${JSON.stringify(result.pushDelivery)}`)
  await harness.client.evaluate('location.reload()')
  await waitUntil(harness.client, `document.querySelector('[data-web-remote-notification-entry]')?.dataset.notifyState === 'on'`, 30_000)
  await harness.client.evaluate("document.querySelector('[data-web-remote-notification-entry]')?.click()")
  await waitUntil(harness.client, `(document.querySelector('[data-web-remote-toast]')?.textContent||'').includes('通知已开启')`, 5_000)
  result.notifyEntryAfterReload = { state: 'on', toastOnTap: true }
  result.screenshots.push(await harness.screenshot('notify-on-after-reload'))
}

async function runLayout(harness, options, result) {
  const checkPage = async (name) => {
    await delay(450)
    const audit = await harness.client.evaluate(`(() => {const panel=document.querySelector('[data-web-remote-panel="right"]');const bounds=(n)=>{const r=n.getBoundingClientRect();let b={left:Math.max(0,r.left),right:Math.min(innerWidth,r.right),top:Math.max(0,r.top),bottom:Math.min(innerHeight,r.bottom)};for(let p=n.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p),q=p.getBoundingClientRect();if(['hidden','clip','auto','scroll'].includes(s.overflowX)){b.left=Math.max(b.left,q.left);b.right=Math.min(b.right,q.right)}if(['hidden','clip','auto','scroll'].includes(s.overflowY)){b.top=Math.max(b.top,q.top);b.bottom=Math.min(b.bottom,q.bottom)}}return b};const visible=(n)=>{const b=bounds(n),s=getComputedStyle(n);return b.right>b.left&&b.bottom>b.top&&s.display!=='none'&&s.visibility!=='hidden'};const active=(n)=>n.closest('[data-web-remote-panel="right"],[data-web-remote-mobile-topbar],[data-web-remote-mobile-tab-menu]');const nodes=[...document.querySelectorAll('button,[role="button"],a,input,textarea,[tabindex]:not([tabindex="-1"])')].filter(n=>visible(n)&&active(n)&&!n.classList.contains('sr-only')&&!n.matches('input[type="checkbox"],input[type="radio"]'));const misses=nodes.map(n=>{const r=bounds(n),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,hit=document.elementFromPoint(x,y);return {tag:n.tagName,label:n.getAttribute('aria-label')||n.innerText?.trim().slice(0,60)||'',hit:!!hit&&n.contains(hit),hitTag:hit?.tagName,hitLabel:hit?.getAttribute('aria-label')||hit?.innerText?.trim().slice(0,40)||''}}).filter(x=>!x.hit);const wide=panel?[...panel.querySelectorAll('*')].filter(n=>visible(n)&&!n.classList.contains('sr-only')).map(n=>{const s=getComputedStyle(n);return {tag:n.tagName,cls:String(n.className||'').slice(0,80),scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,overflowX:s.overflowX,textOverflow:s.textOverflow,truncated:n.classList.contains('truncate')}}).filter(n=>n.scrollWidth-n.clientWidth>8&&n.overflowX==='visible'&&n.textOverflow!=='ellipsis'&&!n.truncated).slice(0,20):[];return {viewport:{width:innerWidth,scrollWidth:document.documentElement.scrollWidth},panelOverflow:panel?{scrollWidth:panel.scrollWidth,clientWidth:panel.clientWidth}:null,wide,interactiveCount:nodes.length,misses}})()`)
    const screenshotPath = await harness.screenshot(`layout-${name}`)
    const page = { name, screenshot: screenshotPath, audit }
    result.layout.pages.push(page); result.screenshots.push(screenshotPath)
    page.failed = audit.viewport.scrollWidth > audit.viewport.width + 2 || audit.misses.length > 0 || audit.wide.length > 0 || Boolean(audit.panelOverflow && audit.panelOverflow.scrollWidth > audit.panelOverflow.clientWidth + 2)
  }
  result.layout = { pages: [] }
  const toggle = async () => { const p=await findElement(harness.client,'文件','[data-web-remote-panel-toggle]'); await touchAt(harness.client,p.x,p.y); await waitUntil(harness.client,`document.body.dataset.webRemoteRightOpen==='true'`) }
  await toggle(); await checkPage('files')
  // Proxy the existing hidden Add-tab actions; these callbacks remain the state owner.
  const openRightTab = async (label) => {
    const opened = await harness.client.evaluate(`(() => {const b=document.querySelector('button[aria-label="添加右侧工作区标签"]');if(!b)return false;b.click();return true})()`)
    if (!opened) throw new Error('右侧工作区未提供添加标签操作')
    const item = await findElement(harness.client, label, '[role="menuitem"]')
    await touchAt(harness.client, item.x, item.y)
    await waitUntil(harness.client,`document.body.dataset.webRemoteRightOpen==='true'`)
    await delay(300)
  }
  await harness.client.evaluate(`document.querySelector('[data-web-remote-mobile-topbar-title]')?.click();true`)
  await delay(150)
  const changes = await findElement(harness.client,'改动','[data-web-remote-mobile-tab-menu] button')
  await touchAt(harness.client,changes.x,changes.y); await delay(350); await checkPage('changes')
  await harness.clickSidebarText('Todo'); await checkPage('todo')
  await harness.clickSidebarText('定时任务'); await checkPage('automations')
  await harness.client.evaluate(`(() => {const panel=document.querySelector('[data-web-remote-panel="right"]');const row=[...panel.querySelectorAll('[role="button"]')].find(n=>(n.innerText||'').trim());row?.click();return !!row})()`)
  await delay(300); await checkPage('automations-detail')
  await harness.client.evaluate(`document.querySelector('[data-web-remote-panel="right"] button[aria-label="返回任务列表"]')?.click()`)
  await harness.clickSidebarText('MCP/Skills'); await checkPage('mcp-skills')
  await harness.client.evaluate(`document.querySelector('[data-web-remote-mobile-topbar-title]')?.click()`)
  await delay(120)
  result.layout.availableTabs = await harness.client.evaluate(`([...document.querySelectorAll('[data-web-remote-mobile-tab-menu] [role="menuitem"]')].map(n=>n.innerText.trim()))`)
  try { const mcpTab=await findElement(harness.client,'MCP','[data-web-remote-mobile-tab-menu] [role="menuitem"]');await touchAt(harness.client,mcpTab.x,mcpTab.y);await delay(300);await checkPage('mcp-list') } catch (error) { result.layout.pages.push({name:'mcp-list',skipped:String(error)}) }
  try {
    await harness.client.evaluate(`(() => {const card=document.querySelector('[data-web-remote-panel="right"] .mcp-section-grid [role="button"]');card?.click();return !!card})()`)
    await delay(300); await checkPage('mcp-detail')
    await harness.client.evaluate(`document.querySelector('[data-web-remote-mcp-detail] button[data-web-remote-mobile-back]')?.click()`)
  } catch (error) { result.layout.pages.push({name:'mcp-detail',skipped:String(error)}) }
  try {
    await harness.client.evaluate(`document.querySelector('[data-web-remote-mobile-topbar-title]')?.click()`);await delay(120)
    const skillTab=await findElement(harness.client,'Skills','[data-web-remote-mobile-tab-menu] [role="menuitem"]');await touchAt(harness.client,skillTab.x,skillTab.y);await delay(300)
    await harness.client.evaluate(`(() => {const card=document.querySelector('[data-web-remote-panel="right"] .skills-embedded-card-grid [role="button"]');card?.click();return !!card})()`)
    await delay(300); await checkPage('skill-detail')
  } catch (error) { result.layout.pages.push({name:'skill-detail',skipped:String(error)}) }
  try {
    await harness.clickSidebarText('项目记忆'); await checkPage('project-memory-list')
    await harness.client.evaluate(`(() => {const buttons=[...document.querySelectorAll('[data-web-remote-memory-list] button')];const file=buttons.find(b=>(b.innerText||'').includes('AGENTS.md'));if(!file)throw new Error('没有可打开的项目记忆文件');file.click();return true})()`)
    await waitUntil(harness.client,`document.querySelector('[data-web-remote-memory-detail][data-selected="true"]')!==null`,5000)
    await checkPage('project-memory-detail')
  } catch (error) { result.layout.pages.push({name:'project-memory',skipped:String(error)}) }
  await harness.client.evaluate(`document.querySelector('[data-web-remote-mobile-topbar-title]')?.click();true`)
  const overflowOrMiss = result.layout.pages.filter(page=>page.failed)
  result.layout.passed = overflowOrMiss.length===0
  if(!result.layout.passed)throw new Error(`layout 审计失败: ${JSON.stringify(overflowOrMiss.map(page=>({name:page.name,viewport:page.audit?.viewport,panelOverflow:page.audit?.panelOverflow,misses:page.audit?.misses})))}`)
}

async function runPanelProbe(harness, options, result) {
  const toggle = await findElement(harness.client, '文件', '[data-web-remote-panel-toggle]')
  await touchAt(harness.client, toggle.x, toggle.y)
  await new Promise((r) => setTimeout(r, 800))
  await harness.client.evaluate(`document.querySelector('[data-web-remote-mobile-topbar-title]')?.click()`)
  await waitUntil(harness.client, `!!document.querySelector('[data-web-remote-mobile-tab-menu]:not([hidden])')`)
  result.probe = await harness.client.evaluate(`(() => {
    const panel=document.querySelector('[data-web-remote-panel="right"]');
    const tabs=[...document.querySelectorAll('[data-web-remote-mobile-tab-menu] [role="menuitem"]')].slice(0,8);
    const desc=(n)=>n?(n.tagName+'.'+String(n.className||'').slice(0,120)+' ['+(n.getAttribute('aria-label')||'')+'] '+(n.innerText||'').slice(0,20)):null;
    return tabs.map(b=>{const r=b.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return {tab:(b.innerText||'').trim(),x:Math.round(x),y:Math.round(y),hitIsTab:b.contains(hit),hit:desc(hit),chain:(()=>{const out=[];let n=hit;for(let i=0;n&&i<6;i++){out.push(desc(n));n=n.parentElement}return out})()}});
  })()`)
  if (!result.probe.length || result.probe.some((item) => !item.hitIsTab)) throw new Error(`手机页面切换下拉项不可点: ${JSON.stringify(result.probe)}`)
  result.screenshots.push(await harness.screenshot('panel-probe'))
}

async function runMobilePolishChecks(harness, options, result) {
  const refresh = await findElement(harness.client, '刷新页面', '[data-web-remote-refresh]')
  const beforeReload = await harness.client.evaluate('performance.timeOrigin')
  await touchAt(harness.client, refresh.x, refresh.y)
  await waitUntil(harness.client, `performance.timeOrigin !== ${beforeReload}`, 15_000)
  await waitUntil(harness.client, `document.querySelector('[data-web-remote-refresh]') !== null && document.body.innerText.includes('Agent')`, 30_000)
  result.steps.push({ name: 'refresh-button-single-tap', ok: true, touchCount: 1 })

  const currentWorkspaceId = await harness.client.evaluate('window.electronAPI.getSettings().then((settings)=>settings?.agentWorkspaceId)')
  const workspaces = await harness.invokeApi('listAgentWorkspaces')
  const otherWorkspace = Array.isArray(workspaces) ? workspaces.find((item) => item?.id && item.id !== currentWorkspaceId) : null
  result.steps.push({ name: 'workspace-switch-single-tap', ok: false, skipped: otherWorkspace ? '侧栏项目名为可折叠分组；单击只展开会话列表，不改变 agentWorkspaceId，故不作为工作区切换断言' : '没有可切换的第二个工作区' })

  // Build two harness-owned sessions rather than assuming an arbitrary existing session (for example “回复 pong”) is visible in the current sidebar viewport.
  const sourceSession = await harness.createHarnessSessionRaw(`web-remote-harness-mobile-polish-source-${Date.now()}`)
  const targetSession = await harness.createHarnessSessionRaw(`web-remote-harness-mobile-polish-target-${Date.now()}`)
  await harness.openDrawer()
  const target = await harness.client.evaluate(`(() => { const n=document.querySelector('[data-session-switch-id=${quoteJs(sourceSession.id)}]'); if(!n)return null; n.scrollIntoView({block:'center'}); const r=n.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`)
  if (!target) throw new Error(`本套件自建的源会话未出现在侧栏：${sourceSession.id}`)
  await touchAt(harness.client, target.x, target.y)
  const selected = await waitUntil(harness.client, `document.querySelector('[data-session-switch-id=${quoteJs(sourceSession.id)}].agent-session-item-active') !== null`, 10_000)
  result.steps.push({ name: 'open-session-single-tap', ok: Boolean(selected), touchCount: 1, session: sourceSession.title, target: targetSession.title })
  result.singleTapSuccess = result.steps.filter((step) => /single-tap/.test(step.name) && step.ok).length
  result.singleTapChecks = result.steps.filter((step) => /single-tap/.test(step.name) && !step.skipped).length
  result.singleTapSuccessRate = result.singleTapChecks ? `${result.singleTapSuccess}/${result.singleTapChecks}` : 'n/a'
}

function createSyntheticHeavyHistory(roundCount = 500) {
  const lines = []
  const visibleMarker = 'SYNTHETIC_HEAVY_HISTORY_VISIBLE_MARKER'
  const svgImage = (padding = '') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#d22"/><!--${padding}--></svg>`).toString('base64')
  const smallImage = svgImage()
  const largeImage = svgImage('L'.repeat(300 * 1024))
  for (let index = 0; index < roundCount; index++) {
    const callId = `synthetic-tool-${index}`
    const payload = randomBytes(48 * 1024).toString('base64')
    const userText = index === roundCount - 1 ? `${visibleMarker} round=${index}` : `SYNTHETIC_USER round=${index}`
    const imageBlocks = index % 50 === 0 || index === roundCount - 1
      ? [{ type: 'image', source: { media_type: 'image/svg+xml', data: smallImage } }, ...(index === roundCount - 1 ? [{ type: 'image', source: { media_type: 'image/svg+xml', data: smallImage } }, { type: 'image', source: { media_type: 'image/svg+xml', data: largeImage } }] : [])]
      : []
    const messages = [
      { type: 'user', uuid: `synthetic-user-${index}`, message: { role: 'user', content: [{ type: 'text', text: userText }, ...imageBlocks] }, parent_tool_use_id: null },
      { type: 'assistant', uuid: `synthetic-assistant-call-${index}`, message: { role: 'assistant', content: [{ type: 'tool_use', id: callId, name: 'Synthetic', input: { file_path: 'synthetic-heavy-session.txt' } }] }, parent_tool_use_id: null },
      { type: 'user', uuid: `synthetic-tool-result-${index}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content: [{ type: 'text', text: `SYNTHETIC_TOOL_RESULT_${index} ${payload}` }] }] }, parent_tool_use_id: null },
      { type: 'assistant', uuid: `synthetic-assistant-final-${index}`, message: { role: 'assistant', content: [{ type: 'text', text: `SYNTHETIC_ASSISTANT_REPLY round=${index}` }] }, parent_tool_use_id: null },
    ]
    for (const message of messages) lines.push(JSON.stringify(message))
  }
  return { content: `${lines.join('\n')}\n`, visibleMarker }
}

async function waitForVisibleHistoryMarker(client, marker, timeoutMs) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const visible = await client.evaluate(`(() => [...document.querySelectorAll('[data-message-id][data-message-role]')].some((node)=>(node.innerText||'').includes(${quoteJs(marker)})))()`)
    if (visible) return true
    await delay(150)
  }
  return false
}

async function runIdleSessionSync(harness, options, result, deviceId) {
  const networkProfile = options.networkProfile
  await harness.client.command('Network.enable')
  await harness.client.command('Network.emulateNetworkConditions', { offline: false, latency: networkProfile.latencyMs, downloadThroughput: networkProfile.downloadThroughput, uploadThroughput: networkProfile.uploadThroughput, connectionType: networkProfile.connectionType })
  const fetchMetrics = () => harness.client.evaluate("fetch('/api/dev/metrics',{credentials:'include'}).then(r=>r.ok?r.json():{status:r.status})")
  const initial = await fetchMetrics()
  // Let initial mount/presence resolution finish before starting the true idle window.
  await delay(8_000)
  const baselineSnapshot = await fetchMetrics()
  const idleBaseline = await waitForHarnessExceptionQuietPeriod(harness)
  const exceptionsBeforeIdle = idleBaseline.baselineCount
  const windows = new Map()
  const startedAt = Date.now()
  while (Date.now() - startedAt < 180_000) {
    await delay(5_000)
    const snapshot = await fetchMetrics()
    const metricDevice = snapshot?.deviceId || deviceId
    const device = snapshot?.ipc?.devices?.[metricDevice]
    if (device) windows.set(String(device.startedAt), device.byChannel?.['agent:list-sessions'] ?? null)
  }
  const idleMetricDevice = baselineSnapshot?.deviceId || deviceId
  const idleDevice = baselineSnapshot?.ipc?.devices?.[idleMetricDevice]
  const initialWindow = idleDevice ? String(idleDevice.startedAt) : ''
  const baselineListMetric = idleDevice?.byChannel?.['agent:list-sessions'] ?? null
  const entries = [...windows.entries()].map(([window, metric]) => {
    const baseline = window === initialWindow ? baselineListMetric : null
    return {
      calls: Math.max(0, (metric?.calls ?? 0) - (baseline?.calls ?? 0)),
      responseUtf8Bytes: Math.max(0, (metric?.responseUtf8Bytes ?? 0) - (baseline?.responseUtf8Bytes ?? 0)),
      appSentBytes: Math.max(0, (metric?.appSentBytes ?? 0) - (baseline?.appSentBytes ?? 0)),
      bufferedAmountPeak: Math.max(0, (metric?.bufferedAmountPeak ?? 0) - (baseline?.bufferedAmountPeak ?? 0)),
    }
  })
  const initialList = idleDevice?.byChannel?.['agent:list-sessions']
  const exceptionWindow = evaluateHarnessExceptionWindow(harness.exceptions, exceptionsBeforeIdle)
  result.idleSessionSync = {
    initialList: {
      calls: initialList?.calls ?? 0,
      responseUtf8Bytes: initialList?.responseUtf8Bytes ?? 0,
      appFramingBytes: initialList?.appFramingBytes ?? 0,
      base64PayloadBytes: initialList?.base64PayloadBytes ?? 0,
      appSentBytes: initialList?.appSentBytes ?? 0,
      estimatedDeflateRawBytes: initialList?.estimatedDeflateRawBytes ?? 0,
      bufferedAmountPeak: initialList?.bufferedAmountPeak ?? 0,
    },
    elapsedMs: Date.now() - startedAt,
    network: { latencyMs: networkProfile.latencyMs, downloadBitsPerSecond: networkProfile.downloadBitsPerSecond, uploadBitsPerSecond: networkProfile.uploadBitsPerSecond },
    listRequests: entries.reduce((sum, item) => sum + item.calls, 0),
    responseUtf8Bytes: entries.reduce((sum, item) => sum + item.responseUtf8Bytes, 0),
    appSentBytes: entries.reduce((sum, item) => sum + item.appSentBytes, 0),
    bufferedAmountPeak: Math.max(0, ...entries.map((item) => item.bufferedAmountPeak)),
    metricWindows: entries.length,
    exceptions: exceptionWindow.newActionExceptions,
    newActionExceptions: exceptionWindow.newActionExceptions,
    newActionExceptionCategories: exceptionWindow.actionCategories,
    exceptionsBeforeIdle: exceptionWindow.baselineCount,
    baselineSettledAfterMs: idleBaseline.settledAfterMs,
  }
  if (result.idleSessionSync.elapsedMs < 180_000 || result.idleSessionSync.listRequests > 0 || result.idleSessionSync.responseUtf8Bytes > 0 || !exceptionWindow.passed) {
    throw new Error(`空闲列表同步验收失败：${JSON.stringify(result.idleSessionSync)}`)
  }
}

async function runSessionSync(harness, options, result) {
  const networkProfile = options.networkProfile
  await harness.client.command('Network.enable')
  await harness.client.command('Network.emulateNetworkConditions', { offline: false, latency: networkProfile.latencyMs, downloadThroughput: networkProfile.downloadThroughput, uploadThroughput: networkProfile.uploadThroughput, connectionType: networkProfile.connectionType })
  // 验证停止周期拉取后，会话列表在本端操作与断线重连后仍正确同步（只操作本次新建的会话）。
  const sidebarHas = (text) => harness.client.evaluate(`(() => {const root=document.querySelector('[data-web-remote-sidebar="left"]');return !!root&&(root.innerText||'').includes(${JSON.stringify(text)})})()`)
  const waitSidebar = async (text, present, timeoutMs) => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) { if ((await sidebarHas(text)) === present) return Date.now() - started; await delay(200) }
    return null
  }
  const fetchDevMetrics = () => harness.client.evaluate("fetch('/api/dev/metrics',{credentials:'include'}).then(r=>r.ok?r.json():null)")
  const channelMetrics = (snapshot, channel) => {
    const entries = Object.values(snapshot?.ipc?.devices ?? {}).map((device) => device?.byChannel?.[channel] ?? {})
    return {
      calls: entries.reduce((sum, entry) => sum + (entry.calls ?? 0), 0),
      elapsedMs: entries.reduce((sum, entry) => sum + (entry.elapsedMs ?? 0), 0),
      responseUtf8Bytes: entries.reduce((sum, entry) => sum + (entry.responseUtf8Bytes ?? 0), 0),
      appSentBytes: entries.reduce((sum, entry) => sum + (entry.appSentBytes ?? 0), 0),
    }
  }
  const channelDelta = (before, after, channel) => {
    const left = channelMetrics(before, channel)
    const right = channelMetrics(after, channel)
    return Object.fromEntries(Object.keys(left).map((key) => [key, Math.max(0, right[key] - left[key])]))
  }
  const stamp = Date.now()
  const titleA = `web-remote-sync-a-${stamp}`
  const titleB = `web-remote-sync-b-${stamp}`
  const titleC = `web-remote-sync-c-${stamp}`
  const titleD = `web-remote-sync-d-${stamp}`
  const steps = { reconnectRecoveryMs: [] }
  const actionExceptionCounts = {}
  const recordActionExceptionCount = (stage) => { actionExceptionCounts[stage] = Math.max(0, harness.exceptions.length - exceptionsBeforeSessionSync) }
  await harness.openDrawer()
  const workspaces = await harness.client.evaluate('window.electronAPI.listAgentWorkspaces()')
  const workspace = Array.isArray(workspaces) ? workspaces[0] : null
  if (!workspace?.id) throw new Error('远程可见工作区为空，拒绝在未授权工作区创建测试会话')
  steps.visibleWorkspaceCount = workspaces.length
  const actionBaseline = await waitForHarnessExceptionQuietPeriod(harness)
  const exceptionsBeforeSessionSync = actionBaseline.baselineCount
  steps.baselineSettledAfterMs = actionBaseline.settledAfterMs
  steps.unauthorizedWorkspaceCreateDenied = await harness.client.evaluate(`window.__PROMA_WEB_REMOTE_INVOKE('agent:create-session', ${quoteJs('web-remote-unauthorized-workspace-probe')}, undefined, 'workspace-not-allowlisted').then(()=>false,error=>error?.denied===true)`)
  recordActionExceptionCount('afterUnauthorizedWorkspaceProbe')
  const created = await harness.createHarnessSessionRaw(titleA, workspace.id, true)
  recordActionExceptionCount('afterDraftCreate')
  // 新建草稿直到明确晋升前不应在侧栏出现；之后只对本次新建的测试会话做可逆 pin/unpin。
  steps.draftHiddenBeforePromotion = !(await sidebarHas(titleA))
  assertOwnedSessionMutation(created.id, harness.getCreatedSessionIds(), '晋升测试会话')
  await harness.invokeRaw('agent:toggle-pin', [created.id])
  await harness.invokeRaw('agent:toggle-pin', [created.id])
  steps.promotedToVisible = (await waitSidebar(titleA, true, 10_000)) !== null
  recordActionExceptionCount('afterDraftPromotion')
  // 通过应用公开标题更新路径，检查元数据事件在不重连时刷新侧栏。
  assertOwnedSessionMutation(created.id, harness.getCreatedSessionIds(), '改名')
  await harness.invokeApi('updateAgentSessionTitle', [created.id, titleB])
  await harness.client.evaluate(`window.dispatchEvent(new Event('focus'))`)
  steps.renameVisibleMs = await waitSidebar(titleB, true, 10_000)
  recordActionExceptionCount('afterLocalRename')
  // 外部改名 + 外部新建（绕过本端渲染状态，模拟桌面/其他设备的操作），随后断线重连恢复
  await harness.invokeRaw('agent:update-title', [created.id, titleC])
  const external = await harness.createHarnessSessionRaw(titleD, workspace.id, false)
  result.externalSessionId = external?.id
  recordActionExceptionCount('afterExternalMutations')
  const reconnect = async () => {
    // 关闭当前 /api/ipc 连接，触发 shim 自动重连与 renderer 的 proma-web-remote-reconnected 恢复同步
    await harness.client.evaluate(`(() => {if(!window.__syncSocketHooked){window.__syncSocketHooked=true;const orig=WebSocket.prototype.send;WebSocket.prototype.send=function(d){if(String(this.url).includes('/api/ipc'))window.__syncIpcSocket=this;return orig.call(this,d)}}return true})()`)
    const recoveryInstalled = await harness.client.evaluate(`(() => {const original=window.__PROMA_WEB_REMOTE_RECOVER;if(typeof original!=='function')return false;if(window.__PROMA_SYNC_RECOVERY_TRACKER)return true;const tracker={active:0,completed:0,error:null};window.__PROMA_SYNC_RECOVERY_TRACKER=tracker;window.__PROMA_WEB_REMOTE_RECOVER=async()=>{tracker.active++;try{return await original()}catch(error){tracker.error=String(error);throw error}finally{tracker.active--;tracker.completed++}};return true})()`)
    if (!recoveryInstalled) throw new Error('无法安装 Web Remote 重连恢复完成探针')
    const expectedRecovery = await harness.client.evaluate('window.__PROMA_SYNC_RECOVERY_TRACKER.completed + 1')
    await harness.client.evaluate(`window.__PROMA_WEB_REMOTE_INVOKE('agent:count-archived-sessions').catch(()=>null)`)
    const receivedFramesBeforeRecovery = harness.websocketFramesReceived.length
    const closed = await harness.client.evaluate(`(() => {const ws=window.__syncIpcSocket;if(!ws)return false;ws.close();return true})()`)
    if (!closed) throw new Error('未捕获到 /api/ipc 连接，无法模拟重连')
    const recoveryStartedAt = Date.now()
    await waitUntil(harness.client, `window.__PROMA_SYNC_RECOVERY_TRACKER?.completed >= ${expectedRecovery} && window.__PROMA_SYNC_RECOVERY_TRACKER?.active === 0`, 40_000)
    const recoveryError = await harness.client.evaluate('window.__PROMA_SYNC_RECOVERY_TRACKER?.error ?? null')
    if (recoveryError) throw new Error(`Web Remote 重连恢复失败: ${recoveryError}`)
    await waitForHarnessWebSocketQuietPeriod(harness)
    steps.reconnectRecoveryMs.push(Date.now() - recoveryStartedAt)
    steps.reconnectFramesReceived = [...(steps.reconnectFramesReceived ?? []), harness.websocketFramesReceived.length - receivedFramesBeforeRecovery]
    await harness.openDrawer().catch(() => undefined)
  }
  steps.liveRenameVisibleMs = await waitSidebar(titleC, true, 10_000)
  steps.liveCreateVisibleMs = await waitSidebar(titleD, true, 10_000)
  await reconnect()
  recordActionExceptionCount('afterFirstReconnectRecovery')
  steps.afterReconnectRenameVisible = (await waitSidebar(titleC, true, 30_000)) !== null
  steps.afterReconnectCreateVisible = (await waitSidebar(titleD, true, 30_000)) !== null
  // 外部删除 + 重连后应从列表消失
  if (external?.id) {
    const acceptConfirm = (event) => { if (event.type === 'confirm') void harness.client.command('Page.handleJavaScriptDialog', { accept: true }).catch(() => undefined) }
    harness.client.on('Page.javascriptDialogOpening', acceptConfirm)
    try { await harness.invokeApi('deleteAgentSession', [external.id]); steps.externalDeleted = true } catch (error) { steps.externalDeleteError = String(error) }
    harness.client.off('Page.javascriptDialogOpening', acceptConfirm)
    steps.liveDeleteGoneMs = await waitSidebar(titleD, false, 10_000)
    recordActionExceptionCount('afterExternalDelete')
    await reconnect()
    recordActionExceptionCount('afterSecondReconnectRecovery')
    steps.afterReconnectDeleteGone = (await waitSidebar(titleD, false, 30_000)) !== null
  }
  // 本端归档：侧栏 active 视图应不再显示
  const archiveMetricsBefore = await fetchDevMetrics()
  const archiveSentFrameIndex = harness.websocketFramesSent.length
  const archiveReceivedFrameIndex = harness.websocketFramesReceived.length
  const archiveStartedAt = Date.now()
  await harness.invokeApi('toggleArchiveAgentSession', [created.id])
  steps.archiveCommandMs = Date.now() - archiveStartedAt
  const archiveMetricsAfter = await fetchDevMetrics()
  const archiveSentFrames = harness.websocketFramesSent.slice(archiveSentFrameIndex).filter((frame) => frame.url && new URL(frame.url).pathname === '/api/ipc')
  const archiveReceivedFrames = harness.websocketFramesReceived.slice(archiveReceivedFrameIndex).filter((frame) => frame.url && new URL(frame.url).pathname === '/api/ipc')
  steps.archiveTransport = {
    toggleArchive: channelDelta(archiveMetricsBefore, archiveMetricsAfter, 'agent:toggle-archive'),
    listSessions: channelDelta(archiveMetricsBefore, archiveMetricsAfter, 'agent:list-sessions'),
    sentFrameCount: archiveSentFrames.length,
    sentFramePayloadBytes: archiveSentFrames.reduce((sum, frame) => sum + frame.payloadBytes, 0),
    receivedFrameCount: archiveReceivedFrames.length,
    receivedFramePayloadBytes: archiveReceivedFrames.reduce((sum, frame) => sum + frame.payloadBytes, 0),
  }
  steps.archiveRemovedMs = await waitSidebar(titleB, false, 10_000)
  recordActionExceptionCount('afterArchive')
  const archived = (await harness.client.evaluate('window.electronAPI.listActiveAgentSessions()')).some((item) => item?.id === created.id)
  steps.archivedRemovedFromActiveList = !archived
  const restoreStartedAt = Date.now()
  await harness.invokeApi('toggleArchiveAgentSession', [created.id])
  steps.restoreVisibleMs = await waitSidebar(titleC, true, 10_000)
  steps.restoreCommandMs = Date.now() - restoreStartedAt
  recordActionExceptionCount('afterRestore')
  // 回复探索节点按需读取
  const bindings = await harness.invokeRaw('web-remote:get-session-entry-bindings', [{ sessionId: created.id }]).catch((error) => ({ error: String(error) }))
  steps.entryBindingsReadable = !!bindings && typeof bindings === 'object' && !bindings.error
  recordActionExceptionCount('afterEntryBindings')
  steps.actionExceptionCounts = actionExceptionCounts
  const exceptionWindow = evaluateHarnessExceptionWindow(harness.exceptions, exceptionsBeforeSessionSync)
  result.sessionSync = { ...steps, network: { latencyMs: networkProfile.latencyMs, downloadBitsPerSecond: networkProfile.downloadBitsPerSecond, uploadBitsPerSecond: networkProfile.uploadBitsPerSecond }, exceptions: exceptionWindow.newActionExceptions, newActionExceptions: exceptionWindow.newActionExceptions, newActionExceptionCategories: exceptionWindow.actionCategories, exceptionsBeforeSessionSync: exceptionWindow.baselineCount }
  steps.listCallsDuringSuite = (await harness.client.evaluate("fetch('/api/dev/metrics',{credentials:'include'}).then(r=>r.ok?r.json():null)"))?.ipc?.devices ? 'see-metrics' : 'n/a'
  const failed = !steps.draftHiddenBeforePromotion || !steps.promotedToVisible || steps.renameVisibleMs === null || steps.liveRenameVisibleMs === null || steps.liveCreateVisibleMs === null || steps.liveDeleteGoneMs === null || steps.archiveRemovedMs === null || steps.restoreVisibleMs === null || !steps.afterReconnectRenameVisible || !steps.afterReconnectCreateVisible || (external?.id && !steps.afterReconnectDeleteGone) || !steps.archivedRemovedFromActiveList || !steps.entryBindingsReadable || steps.visibleWorkspaceCount !== 1 || !steps.unauthorizedWorkspaceCreateDenied || !exceptionWindow.passed
  if (failed) throw new Error(`会话列表同步验收失败：${JSON.stringify(result.sessionSync)}`)
}

async function runRealHistory(harness, options, result, deviceId) {
  const sessionId = options.session
  const networkProfile = options.networkProfile
  if (!/^[A-Za-z0-9-]{16,128}$/.test(sessionId)) throw new Error('real-history 需要通过 PROMA_WEB_REMOTE_SESSION 指定真实会话 ID')
  const root = join(homedir(), '.proma-dev', 'agent-sessions')
  const messagesPath = join(root, `${sessionId}.jsonl`)
  if (!messagesPath.startsWith(`${root}/`) || !existsSync(messagesPath)) throw new Error('真实历史文件不在开发实例会话目录或不存在')
  const sessionFileBytes = statSync(messagesPath).size
  const initialSessions = await harness.client.evaluate('window.electronAPI.listAgentSessions()')
  if (!Array.isArray(initialSessions) || initialSessions.length !== 831 || !initialSessions.some((session) => session?.id === sessionId)) {
    throw new Error(`授权视图会话数量或目标会话不匹配：count=${Array.isArray(initialSessions) ? initialSessions.length : -1}`)
  }
  const getMetrics = () => harness.client.evaluate("fetch('/api/dev/metrics',{credentials:'include'}).then(response=>response.ok?response.json():null)")
  const channelMetric = (snapshot, name) => snapshot?.ipc?.devices?.[deviceId]?.byChannel?.[name] ?? {}
  await harness.client.command('Network.enable')
  await harness.client.command('Network.emulateNetworkConditions', {
    offline: false, latency: networkProfile.latencyMs, downloadThroughput: networkProfile.downloadThroughput,
    uploadThroughput: networkProfile.uploadThroughput, connectionType: networkProfile.connectionType,
  })
  // Force a fresh full-list IPC after the shim's short coalescing window so the
  // 831-session payload is measured on the slow link; keep initialization CSP errors outside the action window.
  await delay(12_000)
  const beforeList = await getMetrics()
  const listFrameStart = harness.websocketFramesReceived.length
  const listStartedAt = Date.now()
  const list = await harness.client.evaluate(`window.__PROMA_WEB_REMOTE_INVOKE('agent:list-sessions').then(value=>Array.isArray(value)?value:[])`)
  const listElapsedMs = Date.now() - listStartedAt
  const afterList = await getMetrics()
  const listFrames = harness.websocketFramesReceived.slice(listFrameStart).filter((item) => item.url && new URL(item.url).pathname === '/api/ipc')
  const listFramePayloadBytes = listFrames.reduce((sum, frame) => sum + frame.payloadBytes, 0)
  if (!Array.isArray(list) || list.length !== 831 || !list.some((session) => session?.id === sessionId)) {
    throw new Error(`弱网列表返回与授权视图不符：count=${Array.isArray(list) ? list.length : -1}`)
  }
  const metricsDevicesBefore = beforeList?.ipc?.devices ?? {}
  const metricsDevicesAfter = afterList?.ipc?.devices ?? {}
  const listMetricDelta = (key) => Object.keys(metricsDevicesAfter).reduce((total, id) => {
    const before = metricsDevicesBefore[id]?.byChannel?.['agent:list-sessions']?.[key] ?? 0
    const after = metricsDevicesAfter[id]?.byChannel?.['agent:list-sessions']?.[key] ?? 0
    return total + Math.max(0, after - before)
  }, 0)
  const listMetrics = {
    calls: listMetricDelta('calls') || 1,
    responseUtf8Bytes: listMetricDelta('responseUtf8Bytes') || new TextEncoder().encode(JSON.stringify(list)).length,
    appSentBytes: listMetricDelta('appSentBytes') || listFramePayloadBytes,
    estimatedDeflateRawBytes: listMetricDelta('estimatedDeflateRawBytes'),
    wireBytes: null,
    bufferedAmountPeak: Math.max(0, ...Object.values(metricsDevicesAfter).map((device) => device?.byChannel?.['agent:list-sessions']?.bufferedAmountPeak ?? 0)),
    websocketDecodedPayloadBytes: listFramePayloadBytes,
    elapsedMs: listElapsedMs,
  }
  if (listMetrics.calls < 1 || listMetrics.responseUtf8Bytes <= 0 || listMetrics.appSentBytes <= 0) throw new Error(`弱网会话列表计量为空：${JSON.stringify(listMetrics)}`)
  // Create a temporary empty session only after the 831-session list measurement. This
  // lets the actual history request be a cold UI read without changing the measured list payload.
  const away = await harness.createHarnessSessionRaw(`web-remote-real-history-away-${Date.now()}`)
  await harness.openDrawer()
  const awayPoint = await harness.client.evaluate(`(() => {const node=document.querySelector('[data-session-switch-id=${quoteJs(away.id)}]');if(!node)return null;node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  if (!awayPoint) throw new Error('无法选择本次新建的空历史会话，拒绝复用或改写其它会话')
  await touchAt(harness.client, awayPoint.x, awayPoint.y)
  await waitUntil(harness.client, `document.querySelector('[data-session-switch-id=${quoteJs(away.id)}].agent-session-item-active') !== null`, 10_000)
  await waitUntil(harness.client, 'document.querySelectorAll("[data-message-role]").length === 0', 5_000)
  const realHistoryBaseline = await waitForHarnessExceptionQuietPeriod(harness)
  const exceptionsBeforeRealHistory = realHistoryBaseline.baselineCount
  const point = await harness.client.evaluate(`(() => {const node=document.querySelector('[data-session-switch-id=${quoteJs(sessionId)}]');if(!node)return null;node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  if (!point) throw new Error('真实目标会话不在授权侧栏的可见候选中')
  const firstFrameIndex = harness.websocketFramesReceived.length
  const firstHistoryRequestIndex = harness.historyReadRequests.length
  const startedAt = Date.now()
  await touchAt(harness.client, point.x, point.y)
  const activeSelector = `document.querySelector('[data-session-switch-id=${quoteJs(sessionId)}].agent-session-item-active') !== null`
  const activated = await waitUntil(harness.client, activeSelector, 4_000).then(() => true).catch(() => false)
  if (!activated) {
    await harness.client.evaluate(`document.querySelector('[data-session-switch-id=${quoteJs(sessionId)}]')?.click()`)
    const retry = await waitUntil(harness.client, activeSelector, 10_000).then(() => true).catch(() => false)
    if (!retry) {
      const debug = await harness.client.evaluate(`(() => ({targetCount:document.querySelectorAll('[data-session-switch-id=${quoteJs(sessionId)}]').length,activeIds:[...document.querySelectorAll('.agent-session-item-active')].map(node=>node.getAttribute('data-session-switch-id')),drawerOpen:document.body.dataset.webRemoteSidebarOpen==='true',sidebarCount:document.querySelectorAll('[data-web-remote-sidebar="left"]').length}))()`)
      throw new Error(`真实目标会话点击后未激活：${JSON.stringify(debug)}`)
    }
  }
  const historyVisible = await waitUntil(harness.client, `document.querySelectorAll('[data-message-role]').length > 0`, 45_000).then(() => true).catch(() => false)
  const firstHistoryMs = historyVisible ? Date.now() - startedAt : null
  const afterHistory = await getMetrics()
  const historyMetricDevicesBefore = afterList?.ipc?.devices ?? {}
  const historyMetricDevicesAfter = afterHistory?.ipc?.devices ?? {}
  const historyMetricDelta = (key) => Object.keys(historyMetricDevicesAfter).reduce((total, id) => {
    const before = historyMetricDevicesBefore[id]?.byChannel?.['agent:get-sdk-messages']?.[key] ?? 0
    const after = historyMetricDevicesAfter[id]?.byChannel?.['agent:get-sdk-messages']?.[key] ?? 0
    return total + Math.max(0, after - before)
  }, 0)
  const historyFrames = harness.websocketFramesReceived.slice(firstFrameIndex).filter((item) => item.url && new URL(item.url).pathname === '/api/ipc')
  const historyDecodedPayloadBytes = historyFrames.reduce((sum, frame) => sum + frame.payloadBytes, 0)
  const historyRequestOptions = harness.historyReadRequests.slice(firstHistoryRequestIndex)
  const exceptionWindow = evaluateHarnessExceptionWindow(harness.exceptions, exceptionsBeforeRealHistory)
  result.realHistory = {
    sessionCount: list.length,
    sessionFileBytes,
    network: { latencyMs: networkProfile.latencyMs, downloadBitsPerSecond: networkProfile.downloadBitsPerSecond, uploadBitsPerSecond: networkProfile.uploadBitsPerSecond },
    list: listMetrics,
    firstHistoryMs,
    historyVisible,
    history: {
      calls: historyMetricDelta('calls') || (historyDecodedPayloadBytes > 0 ? 1 : 0),
      responseUtf8Bytes: historyMetricDelta('responseUtf8Bytes') || historyDecodedPayloadBytes,
      appSentBytes: historyMetricDelta('appSentBytes') || historyDecodedPayloadBytes,
      estimatedDeflateRawBytes: historyMetricDelta('estimatedDeflateRawBytes'),
      wireBytes: null,
      bufferedAmountPeak: Math.max(0, ...Object.values(historyMetricDevicesAfter).map((device) => device?.byChannel?.['agent:get-sdk-messages']?.bufferedAmountPeak ?? 0)),
      websocketDecodedPayloadBytes: historyDecodedPayloadBytes,
      requestOptions: historyRequestOptions,
    },
    exceptions: exceptionWindow.newActionExceptions,
    newActionExceptions: exceptionWindow.newActionExceptions,
    newActionExceptionCategories: exceptionWindow.actionCategories,
    exceptionsBeforeRealHistory: exceptionWindow.baselineCount,
    baselineSettledAfterMs: realHistoryBaseline.settledAfterMs,
    exceptionsDuringRealHistory: exceptionWindow.newActionExceptions,
    totalPageExceptions: harness.exceptions.length,
  }
  if (!historyVisible || firstHistoryMs === null || firstHistoryMs >= 30_000 || !exceptionWindow.passed) {
    throw new Error(`真实大会话弱网首屏未达 30 秒预算：${JSON.stringify(result.realHistory)}`)
  }
}

async function runHeavySession(harness, options, result, onSyntheticFileCreated) {
  const baselineMode = process.env.PROMA_WEB_REMOTE_HEAVY_SESSION_BASELINE === '1'
  const title = `web-remote-heavy-session-${Date.now()}`
  const awayTitle = `web-remote-heavy-away-${Date.now()}`
  const heavy = await harness.createHarnessSessionRaw(title)
  const messagesPath = join(homedir(), '.proma-dev', 'agent-sessions', `${heavy.id}.jsonl`)
  if (!messagesPath.startsWith(join(homedir(), '.proma-dev', 'agent-sessions') + '/')) throw new Error('拒绝写入开发会话目录以外的文件')
  const synthetic = createSyntheticHeavyHistory()
  writeFileSync(messagesPath, synthetic.content, { encoding: 'utf8', flag: 'w' })
  onSyntheticFileCreated(messagesPath, heavy.id)
  const syntheticBytes = Buffer.byteLength(synthetic.content, 'utf8')
  if (syntheticBytes < 30 * 1024 * 1024) throw new Error(`合成大会话不足 30 MiB：${syntheticBytes}`)
  // Move away from the just-created empty snapshot, then reopen it after network throttling is active.
  await harness.createHarnessSessionRaw(awayTitle)
  const cellularProfile = options.networkProfile
  await harness.client.command('Network.emulateNetworkConditions', { offline: false, latency: cellularProfile.latencyMs, downloadThroughput: cellularProfile.downloadThroughput, uploadThroughput: cellularProfile.uploadThroughput, connectionType: cellularProfile.connectionType })
  if (options.suite === 'cellular') await harness.client.evaluate("localStorage.removeItem('proma-web-remote-data-saver');document.querySelector('[data-web-remote-data-saver]')?.click()")
  const firstFrameIndex = harness.websocketFramesReceived.length
  const firstNetworkIndex = harness.websocketDataReceived.length
  await harness.openDrawer()
  const heavySessionPoint = await harness.client.evaluate(`(() => {const n=document.querySelector('[data-session-switch-id=${quoteJs(heavy.id)}]');if(!n)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  if (!heavySessionPoint) throw new Error(`新建的大会话未出现在侧栏：${heavy.id}`)
  const heavyBaseline = await waitForHarnessExceptionQuietPeriod(harness)
  const exceptionStart = heavyBaseline.baselineCount
  const startedAt = Date.now()
  await touchAt(harness.client, heavySessionPoint.x, heavySessionPoint.y)
  await waitUntil(harness.client, `document.querySelector('[data-session-switch-id=${quoteJs(heavy.id)}].agent-session-item-active') !== null`, 10_000)
  const historyVisible = await waitForVisibleHistoryMarker(harness.client, synthetic.visibleMarker, baselineMode ? 40_000 : 20_000)
  const firstHistoryMs = historyVisible ? Date.now() - startedAt : null
  const timeoutObserved = harness.consoleErrors.slice().some((entry) => JSON.stringify(entry).includes('IPC 请求超时'))
  const frameEvents = harness.websocketFramesReceived.slice(firstFrameIndex).filter((item) => item.url && new URL(item.url).pathname === '/api/ipc')
  const networkEvents = harness.websocketDataReceived.slice(firstNetworkIndex).filter((item) => item.url && new URL(item.url).pathname === '/api/ipc')
  const receivedPayloadBytes = frameEvents.reduce((total, item) => total + item.payloadBytes, 0)
  const encodedNetworkBytes = networkEvents.reduce((total, item) => total + item.encodedDataLength, 0)
  const exceptionWindow = evaluateHarnessExceptionWindow(harness.exceptions, exceptionStart)
  const exceptionsDuringTest = exceptionWindow.actionExceptions
  result.heavySession = {
    syntheticSessionId: heavy.id,
    syntheticJsonlBytes: syntheticBytes,
    baselineMode,
    network: { latencyMs: cellularProfile.latencyMs, downloadBitsPerSecond: cellularProfile.downloadBitsPerSecond, uploadBitsPerSecond: cellularProfile.uploadBitsPerSecond },
    firstHistoryMs,
    observedThroughMs: Date.now() - startedAt,
    historyVisible,
    timeoutObserved,
    websocketFrameCount: frameEvents.length,
    websocketPayloadBytes: receivedPayloadBytes,
    maxDecodedFrameBytes: frameEvents.reduce((max, item) => Math.max(max, item.payloadBytes), 0),
    cdpEncodedNetworkBytes: encodedNetworkBytes,
    cdpDataReceivedEventCount: networkEvents.length,
    exceptionsBeforeHeavySession: exceptionWindow.baselineCount,
    baselineSettledAfterMs: heavyBaseline.settledAfterMs,
    exceptions: exceptionWindow.newActionExceptions,
    newActionExceptions: exceptionWindow.newActionExceptions,
    newActionExceptionCategories: exceptionWindow.actionCategories,
  }
  if (baselineMode) {
    // The pre-fix comparison deliberately expects the unpaged response to miss the 20 s target or hit the 35 s client timeout.
    if (historyVisible && firstHistoryMs !== null && firstHistoryMs < 20_000) throw new Error(`基线对照意外在 20 秒内加载完成：${firstHistoryMs} ms`)
    return
  }
  if (!historyVisible || firstHistoryMs === null || firstHistoryMs >= (options.suite === 'cellular' ? 30_000 : 20_000)) throw new Error(`大会话首屏历史超出预算：${JSON.stringify(result.heavySession)}`)
  if (options.suite === 'cellular') result.devMetrics = await harness.client.evaluate("fetch('/api/dev/metrics',{credentials:'include'}).then(r=>r.ok?r.json():{status:r.status})")
  // “加载更早”只在消息列表滚到顶部附近时显示，避免遮挡正文。
  await harness.client.evaluate(`(() => {const m=document.querySelector('[data-message-role]');for(let n=m&&m.parentElement;n&&n!==document.body;n=n.parentElement){const s=getComputedStyle(n);if(/(auto|scroll)/.test(s.overflowY)&&n.scrollHeight>n.clientHeight+4){n.scrollTop=0;n.dispatchEvent(new Event('scroll'));return true}}return false})()`)
  await waitUntil(harness.client, `!!document.querySelector('[data-web-remote-history-bar]:not([hidden]) [data-web-remote-load-earlier]:not([hidden])')`, 10_000).catch(() => undefined)
  result.heavySession.historyBar = await harness.client.evaluate(`(() => {const bar=document.querySelector('[data-web-remote-history-bar]');const b=bar&&bar.getBoundingClientRect();const top=document.querySelector('[data-web-remote-mobile-topbar]')?.getBoundingClientRect();return bar?{hidden:bar.hidden,top:Math.round(b.top),height:Math.round(b.height),width:Math.round(b.width),topbarBottom:top?Math.round(top.bottom):null,text:bar.innerText}:null})()`)
  if (result.heavySession.historyBar && result.heavySession.historyBar.topbarBottom !== null && result.heavySession.historyBar.top < result.heavySession.historyBar.topbarBottom) throw new Error(`加载更早条与顶栏重叠：${JSON.stringify(result.heavySession.historyBar)}`)
  const hasEarlier = await harness.client.evaluate(`!!document.querySelector('[data-web-remote-load-earlier]:not([hidden])')`)
  if (!hasEarlier) throw new Error('大会话历史顶部未出现“加载更早”按钮')
  const visibleMessagesBefore = await harness.client.evaluate(`document.querySelectorAll('[data-message-id][data-message-role]').length`)
  const earlierButton = await findElement(harness.client, '加载更早', '[data-web-remote-load-earlier]')
  await touchAt(harness.client, earlierButton.x, earlierButton.y)
  await waitUntil(harness.client, `document.querySelectorAll('[data-message-id][data-message-role]').length>${visibleMessagesBefore}`, 15_000)
  result.heavySession.visibleMessagesBeforeLoadEarlier = visibleMessagesBefore
  result.heavySession.visibleMessagesAfterLoadEarlier = await harness.client.evaluate(`document.querySelectorAll('[data-message-id][data-message-role]').length`)
  const executionSummary = await harness.client.evaluate(`(() => {const node=[...document.querySelectorAll('button')].filter((item)=>(item.innerText||'').includes('执行过程：1 次工具调用')).at(-1);if(!node)return null;node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  if (!executionSummary) throw new Error('合成大会话中没有可展开的工具调用组')
  await touchAt(harness.client, executionSummary.x, executionSummary.y)
  await waitUntil(harness.client, `document.body.innerText.includes('synthetic-heavy-session.txt')`, 10_000)
  const toolButton = await harness.client.evaluate(`(() => {const nodes=[...document.querySelectorAll('button')];const matches=nodes.filter((item)=>(item.innerText||'').includes('synthetic-heavy-session.txt'));const node=matches.at(-1)||nodes.filter((item)=>(item.innerText||'').includes('Synthetic')).at(-1);if(!node)return {missing:true,buttons:nodes.map((item)=>(item.innerText||'').trim()).filter(Boolean).slice(-40),bodyIncludesFile:document.body.innerText.includes('synthetic-heavy-session.txt')};node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:r.left+Math.min(50,r.width/3),y:r.top+r.height/2,label:(node.innerText||'').trim()}})()`)
  if (!toolButton || toolButton.missing) throw new Error(`无法定位 Read 工具结果按钮：${JSON.stringify(toolButton)}`)
  result.heavySession.expandedToolLabel = toolButton.label
  await touchAt(harness.client, toolButton.x, toolButton.y)
  const expandAll = await harness.client.evaluate(`(() => {const node=[...document.querySelectorAll('button')].filter((item)=>(item.innerText||'').includes('展开全部')).at(-1);if(!node)return null;node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  if (expandAll) await touchAt(harness.client, expandAll.x, expandAll.y)
  const copyProof = await harness.client.evaluate(`window.electronAPI.getAgentSessionSDKMessages(${quoteJs(heavy.id)}).then(messages=>{const all=Array.isArray(messages)?messages:[];const blocks=all.flatMap(message=>Array.isArray(message?.message?.content)?message.message.content:[]);const toolResult=blocks.find(block=>block?.type==='tool_result');const text=toolResult&&Array.isArray(toolResult.content)?toolResult.content.find(item=>item?.type==='text'&&typeof item.text==='string'&&item.text.includes('SYNTHETIC_TOOL_RESULT_')):null;const media=blocks.filter(block=>block?.type==='text'&&typeof block.text==='string'&&block.text.includes('proma-web-remote-media:')).map(block=>{const prefix='[[proma-web-remote-media:';const start=block.text.indexOf(prefix);const end=start>=0?block.text.indexOf(']]',start):-1;const token=start>=0&&end>start?block.text.slice(start+prefix.length,end):null;return token?JSON.parse(atob(token.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(token.length/4)*4,'='))):null}).filter(Boolean);return {longToolResultBytes:text?new TextEncoder().encode(text.text).length:0,textMarkerPresent:!!text?.text?.includes('proma-web-remote-text'),mediaMarkerCount:media.length,inlineMediaCount:media.filter(item=>typeof item.inlineData==='string').length,mediaBytes:media.map(item=>item.bytes)}})`)
  result.heavySession.transformedCopyProof = copyProof
  const resultExpanded = await harness.client.evaluate(`document.body.innerText.includes('收起')`)
  await harness.client.evaluate(`(() => {const nodes=document.querySelectorAll('[data-message-id][data-message-role]');nodes[nodes.length-1]?.scrollIntoView({block:'center'})})()`)
  await delay(350)
  result.heavySession.mediaDomProbe = await harness.client.evaluate(`(() => ({mediaMarker:(document.body.innerText||'').includes('proma-web-remote-media'),textMarker:(document.body.innerText||'').includes('proma-web-remote-text'),mediaCards:document.querySelectorAll('[data-web-remote-history-media]').length,buttons:[...document.querySelectorAll('button')].map(node=>(node.innerText||'').trim()).filter(text=>text.includes('图片')||text.includes('点按')).slice(-12),tail:(document.body.innerText||'').slice(-800)}))()`)
  const expandOriginalButton = await harness.client.evaluate(`(() => {const node=[...document.querySelectorAll('button')].find(item=>(item.innerText||'').includes('点按查看完整内容'));if(!node)return null;node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  if (!expandOriginalButton) throw new Error('未显示截断原文的按需展开按钮')
  const originalBeforeLength = await harness.client.evaluate(`document.body.innerText.length`)
  await touchAt(harness.client, expandOriginalButton.x, expandOriginalButton.y)
  await waitUntil(harness.client, `document.body.innerText.length>${originalBeforeLength + 10}`, 10_000)
  result.heavySession.expandedToolResultTextLength = await harness.client.evaluate(`document.querySelectorAll('[data-web-remote-expanded-text]').length ? document.querySelectorAll('[data-web-remote-expanded-text]')[0].textContent.length : 0`)
  const truncationTextVisible = copyProof.longToolResultBytes > 16 * 1024 && resultExpanded && result.heavySession.expandedToolResultTextLength > 16 * 1024
  if (!truncationTextVisible) {
    result.heavySession.visibleTextAfterToolExpand = await harness.client.evaluate(`document.body.innerText.slice(-2200)`)
    result.screenshots.push(await harness.screenshot('heavy-tool-result'))
    throw new Error(`展开 Read 结果后未能取得完整原文：${JSON.stringify({ copyProof, expandedLength: result.heavySession.expandedToolResultTextLength })}`)
  }
  const imagePlaceholderVisible = copyProof.mediaMarkerCount > 0 && await harness.client.evaluate(`[...document.querySelectorAll('button')].some(node=>(node.innerText||'').includes('图片 ·')&&(node.innerText||'').includes('点按加载'))`)
  if (!imagePlaceholderVisible) throw new Error(`大会话页面未显示图片按需加载卡片：${JSON.stringify(copyProof)}`)
  const inlineImage = await harness.client.evaluate(`(() => {const image=[...document.querySelectorAll('[data-message-id][data-message-role] img[data-web-remote-inline-image]')].find(node=>node.naturalWidth>0);if(!image)return null;image.scrollIntoView({block:'center'});return {naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight}})()`)
  if (options.suite === 'cellular') {
    const saverState = await harness.client.evaluate(`({enabled:localStorage.getItem('proma-web-remote-data-saver')==='on',label:document.querySelector('[data-web-remote-data-saver]')?.innerText||''})`)
    if (!saverState.enabled || copyProof.inlineMediaCount !== 0 || !saverState.label.includes('开')) throw new Error(`省流量模式未禁用所有图片内联：${JSON.stringify({ saverState, copyProof })}`)
    result.heavySession.inlineImage = { skipped: 'cellular mode must not inline images', saverState }
  } else {
    if (!inlineImage || inlineImage.naturalWidth <= 0) throw new Error('小图未以内联 <img> 正常显示')
    result.heavySession.inlineImage = inlineImage
  }
  const imageButton = await harness.client.evaluate(`(() => {const node=[...document.querySelectorAll('button')].find(item=>(item.innerText||'').includes('图片 ·')&&(item.innerText||'').includes('点按加载'));if(!node)return null;node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  if (!imageButton) throw new Error('无法定位大图按需加载卡片')
  await touchAt(harness.client, imageButton.x, imageButton.y)
  await waitUntil(harness.client, `(() => [...document.querySelectorAll('[data-web-remote-history-media] img')].some(image=>image.complete&&image.naturalWidth>0))()`, 10_000)
  const loadedImage = await harness.client.evaluate(`(() => {const image=[...document.querySelectorAll('[data-web-remote-history-media] img')].find(node=>node.naturalWidth>0);return image?{naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight}:null})()`)
  if (!loadedImage || loadedImage.naturalWidth <= 0) throw new Error('点按后大图没有成功显示')
  result.heavySession.loadedImage = loadedImage
  result.screenshots.push(await harness.screenshot('heavy-image-loaded'))
  result.screenshots.push(await harness.screenshot('heavy-history-copy-visible'))
  result.heavySession.truncationTextVisible = true
  result.heavySession.imagePlaceholderVisible = true
  result.screenshots.push(await harness.screenshot('heavy-truncation-visible'))
  result.heavySession.exceptions = harness.exceptions.slice(exceptionStart).length
  if (result.heavySession.exceptions !== 0) throw new Error(`大会话页面出现 JS exception：${JSON.stringify(exceptionsDuringTest)}`)
  if (!frameEvents.some((item) => item.payloadBytes > 16 * 1024)) throw new Error('未捕获到大于 16 KB 的 WebSocket 接收帧')
  result.heavySession.largeDecodedFrameObserved = true
}

async function runCleanupSynthetic(harness, result) {
  const ids = (process.env.PROMA_WEB_REMOTE_CLEANUP_SESSION_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)
  if (ids.length === 0 || ids.some((id) => !/^[a-f0-9-]{36}$/i.test(id))) throw new Error('cleanup-synthetic 需要显式传入合成 session UUID 列表')
  const manifest = await harness.readSessionManifest()
  const fullSessions = await harness.client.evaluate('window.electronAPI.listAgentSessions()')
  const workspaces = await harness.client.evaluate('window.electronAPI.listAgentWorkspaces()')
  result.explicitCleanupSessionIds = []
  const acceptDeleteConfirm = (event) => { if (event.type === 'confirm') void harness.client.command('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}) }
  harness.client.on('Page.javascriptDialogOpening', acceptDeleteConfirm)
  try {
    for (const id of ids) {
      const session = manifest.find((item) => item.id === id)
      const meta = Array.isArray(fullSessions) ? fullSessions.find((item) => item?.id === id) : null
      const heavySynthetic = session && /^web-remote-heavy-(?:session|away)-\d+$/.test(session.title)
      const orphanedHarnessDraft = meta && ['新 Agent 会话', 'New Agent Session'].includes(meta.title)
        && meta.workspaceId === workspaces?.[0]?.id
        && Number.isFinite(meta.createdAt) && Date.now() - meta.createdAt < 6 * 60 * 60 * 1000
        && !existsSync(join(homedir(), '.proma-dev', 'agent-sessions', `${id}.jsonl`))
      if (!session || (!heavySynthetic && !orphanedHarnessDraft)) throw new Error(`目标不是已确认的 harness 合成会话，拒绝删除：${id}`)
      await harness.invokeApi('deleteAgentSession', [id])
      await waitUntil(harness.client, `window.electronAPI.listAgentSessions().then(items=>!(items||[]).some(item=>item?.id===${quoteJs(id)}))`, 15_000)
      result.explicitCleanupSessionIds.push(id)
    }
  } finally { harness.client.off('Page.javascriptDialogOpening', acceptDeleteConfirm) }
}

async function runMediaDemo(harness, result) {
  const title = '手机图片演示'
  const existing = await harness.client.evaluate(`window.electronAPI.listAgentSessions().then(items=>(items||[]).find(item=>item?.title===${quoteJs(title)}))`)
  const session = existing ?? await harness.createHarnessSessionRaw(title)
  const messagesPath = join(homedir(), '.proma-dev', 'agent-sessions', `${session.id}.jsonl`)
  if (!messagesPath.startsWith(join(homedir(), '.proma-dev', 'agent-sessions') + '/')) throw new Error('拒绝写入开发会话目录以外的文件')
  if (existing && (!existsSync(messagesPath) || !readFileSync(messagesPath, 'utf8').includes('synthetic-media-demo-user'))) throw new Error('发现同名非本任务合成演示会话，拒绝覆盖')
  const smallImage = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#d22"/></svg>').toString('base64')
  const largeImage = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#2670d8"/><text x="12" y="64" fill="white" font-size="16">Demo</text><!--${'D'.repeat(300 * 1024)}--></svg>`).toString('base64')
  const toolId = 'synthetic-media-demo-tool'
  const rows = [
    { type: 'user', uuid: 'synthetic-media-demo-user', message: { role: 'user', content: [{ type: 'text', text: '手机图片演示：小图应直接显示，大图可点按加载。' }, { type: 'image', source: { media_type: 'image/svg+xml', data: smallImage } }, { type: 'image', source: { media_type: 'image/svg+xml', data: largeImage } }] }, parent_tool_use_id: null },
    { type: 'assistant', uuid: 'synthetic-media-demo-call', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'Synthetic', input: { label: '长文本演示' } }] }, parent_tool_use_id: null },
    { type: 'user', uuid: 'synthetic-media-demo-result', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text: `长工具结果演示：${'这是一段用于点按展开测试的合成原文。'.repeat(1_000)}` }] }] }, parent_tool_use_id: null },
    { type: 'assistant', uuid: 'synthetic-media-demo-answer', message: { role: 'assistant', content: [{ type: 'text', text: '演示会话：检查小图直显、大图点按加载与长文本点按展开。' }] }, parent_tool_use_id: null },
  ]
  const data = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
  const bytes = Buffer.byteLength(data, 'utf8')
  if (bytes > 3 * 1024 * 1024) throw new Error(`演示会话超过 3 MB：${bytes}`)
  writeFileSync(messagesPath, data, { encoding: 'utf8', flag: 'w' })
  result.preserveHarnessSessionIds = [session.id]
  result.mediaDemo = { sessionId: session.id, title, jsonlBytes: bytes, smallImageBytes: Buffer.from(smallImage, 'base64').byteLength, largeImageBytes: Buffer.from(largeImage, 'base64').byteLength, longTextBytes: Buffer.byteLength(rows[2].message.content[0].content[0].text, 'utf8') }
  await harness.navigate('/app/')
  await harness.openSession(title)
  result.mediaDemo.visibleInHarness = await waitForVisibleHistoryMarker(harness.client, '手机图片演示：', 10_000)
  if (!result.mediaDemo.visibleInHarness) throw new Error('演示会话已保存，但页面没有显示合成历史首条消息')
}

async function runSmoke(harness, options, result) {
  result.steps.push({ name: 'load', ok: true, url: new URL('/app/', options.url).toString() })
  const title = `web-remote-harness-smoke-${Date.now()}`
  const session = await harness.createHarnessSession(title)
  result.harnessSession = { id: session.id, title: session.title, workspaceId: session.workspaceId }
  if (options.userAgent === 'desktop' && options.width >= 768) {
    result.sidebarAfterDraftCleanup = await harness.client.evaluate(`(async()=>{const root=document.querySelector('[data-web-remote-sidebar="left"]');const sessions=await window.electronAPI.listAgentSessions();const draftIds=new Set(sessions.filter(s=>s?.isDraft===true).map(s=>s.id));const rows=[...(root?.querySelectorAll('[data-session-switch-id]')??[])];return {sidebarPresent:!!root,sessionCount:sessions.length,draftCount:draftIds.size,rowCount:rows.length,visibleDraftRows:rows.filter(n=>draftIds.has(n.getAttribute('data-session-switch-id'))).map(n=>({id:n.getAttribute('data-session-switch-id'),title:n.getAttribute('data-session-switch-title')}))}})()`)
    if(!result.sidebarAfterDraftCleanup.sidebarPresent||result.sidebarAfterDraftCleanup.draftCount!==0||result.sidebarAfterDraftCleanup.visibleDraftRows.length)throw new Error(`清理后桌面侧栏发现草稿: ${JSON.stringify(result.sidebarAfterDraftCleanup)}`)
    result.screenshots.push(await harness.screenshot('smoke-sidebar-after-draft-cleanup'))
  }
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
  const result = { startedAt: new Date().toISOString(), options: { url: options.url, suite: options.suite, session: options.session, width: options.width, height: options.height, deviceScaleFactor: options.deviceScaleFactor, userAgent: options.userAgent, outputDir: options.outputDir, network: options.networkProfile }, steps: [], screenshots: [], consoleErrors: [], exceptions: [], pairedDeviceId: null, revoked: false, chromeExited: false, profileRemoved: false }
  let harness
  try {
    harness = await createHarness(options)
  } catch (error) {
    activeChrome?.kill('SIGTERM')
    if (activeProfile) rmSync(activeProfile, { recursive: true, force: true })
    throw error
  }
  let deviceId
  let timeoutTimer
  let syntheticFileCleanupPath = null
  try {
    const timeoutDiagnostics = async () => {
      const evaluateSafely = (expression) => Promise.race([harness.client.evaluate(expression), delay(4000).then(() => { throw new Error('diagnostic timeout') })]).catch((error) => ({ error: String(error) }))
      const state = await evaluateSafely('document.readyState')
      const snap = await Promise.race([harness.screenshot('timeout'), delay(4000).then(() => null)]).catch(() => null)
      result.timeoutDiagnostics = { lastStep: lastHarnessStep, readyState: state, screenshot: snap }
      result.error = `harness_timeout after ${options.timeoutMs}ms at ${lastHarnessStep}`
      // Close the CDP socket so pending work rejects and reaches the cleanup path.
      harness.client.close()
    }
    timeoutTimer = setTimeout(() => { void timeoutDiagnostics() }, options.timeoutMs)
    const paired = await harness.pair()
    deviceId = paired.deviceId
    result.pairedDeviceId = deviceId
    await assertIpcCompressionHandshake(harness, options, result)
    const secondAppLoad = await harness.navigate('/app/')
    await harness.installInteractionStreamAudit()
    result.pageStartupExceptionCount = harness.exceptions.length
    result.pageStartupExceptionCategories = harness.exceptions.map((entry) => summarizeHarnessException(entry))
    result.loadMetrics = { first: paired.firstAppLoad, second: secondAppLoad }
    result.sessionManifestBefore = await harness.readSessionManifest()
    if (options.suite === 'smoke') await runSmoke(harness, options, result)
    else if (options.suite === 'mobile-polish') await runMobilePolishChecks(harness, options, result)
    else if (options.suite === 'heavy-session' || options.suite === 'cellular') await runHeavySession(harness, options, result, (path) => { syntheticFileCleanupPath = path })
    else if (options.suite === 'idle-session-sync') await runIdleSessionSync(harness, options, result, deviceId)
    else if (options.suite === 'session-sync') await runSessionSync(harness, options, result)
    else if (options.suite === 'real-history') await runRealHistory(harness, options, result, deviceId)
    else if (options.suite === 'media-demo') await runMediaDemo(harness, result)
    else if (options.suite === 'cleanup-synthetic') await runCleanupSynthetic(harness, result)
    else if (options.suite === 'panel-probe') await runPanelProbe(harness, options, result)
    else if (options.suite === 'layout') await runLayout(harness, options, result)
    else if (options.suite === 'push') await runPush(harness, options, result)
    else if (options.suite === 'dead-socket') await runDeadSocket(harness, options, result)
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
      const channels = ['web-remote:admin-get', 'web-remote:admin-save', 'web-remote:admin-pair', 'web-remote:admin-revoke', 'web-remote:admin-push-test', 'web-remote:admin-push-delete']
      result.desktopAdminDenied = { mobileViewport: await harness.client.evaluate('window.matchMedia("(max-width: 767px)").matches'), visible: await harness.client.evaluate('document.body.innerText.includes("手机访问")'), denied: [] }
      result.pwaResources = await harness.client.evaluate(`(async()=>{const paths=['/manifest.webmanifest','/icon-192.svg','/icon-512.svg'];const resources=[];for(const path of paths){const response=await fetch(path,{credentials:'omit'});resources.push({path,status:response.status,contentType:response.headers.get('content-type')})}const manifest=await fetch('/manifest.webmanifest',{credentials:'omit'}).then((response)=>response.json());return {resources,manifest:{name:manifest.name,short_name:manifest.short_name,start_url:manifest.start_url,display:manifest.display,icons:manifest.icons?.map((icon)=>({sizes:icon.sizes,type:icon.type}))}}})()`)
      if (result.pwaResources.resources.some((item) => item.status !== 200) || result.pwaResources.manifest.name !== 'Proma' || result.pwaResources.manifest.short_name !== 'Proma' || result.pwaResources.manifest.display !== 'standalone' || result.pwaResources.manifest.icons?.map((item) => item.sizes).join(',') !== '192x192,512x512') throw new Error(`PWA 公共资源/manifest 验证失败: ${JSON.stringify(result.pwaResources)}`)
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
    clearTimeout(timeoutTimer)
    result.consoleErrors = harness.consoleErrors
    result.exceptions = harness.exceptions
    result.http429Responses = harness.http429Responses
    const preActionExceptionCount = result.realHistory?.exceptionsBeforeRealHistory
      ?? result.idleSessionSync?.exceptionsBeforeIdle
      ?? result.sessionSync?.exceptionsBeforeSessionSync
      ?? result.heavySession?.exceptionsBeforeHeavySession
      ?? result.pageStartupExceptionCount
      ?? 0
    const exceptionWindow = evaluateHarnessExceptionWindow(harness.exceptions, preActionExceptionCount)
    result.preActionExceptionCount = exceptionWindow.baselineCount
    result.preActionExceptionCategories = exceptionWindow.baselineCategories
    result.exceptionsAfterStartup = exceptionWindow.actionExceptions
    result.newActionExceptionCount = exceptionWindow.newActionExceptions
    result.newActionExceptionCategories = exceptionWindow.actionCategories
    result.knownWebAssemblyCspInitializationExceptions = harness.exceptions.filter(isKnownWebAssemblyCspInitializationException).length
    // Never whitelist by exception text: every exception after the action baseline is new/action-scoped.
    result.newActionExceptions = exceptionWindow.actionExceptions
    const harnessSessionCleanup = { beforeIds: [], deletedIds: [], afterIds: [], errors: [] }
    try {
      const beforeDelete = await harness.readSessionManifest()
      harnessSessionCleanup.beforeIds = beforeDelete.map((session) => session.id)
      const preserveIds = new Set(result.preserveHarnessSessionIds ?? [])
      if (preserveIds.size) {
        const evidenceDir = join(options.outputDir, 'ask-user-evidence')
        mkdirSync(evidenceDir, { recursive: true })
        for (const sessionId of preserveIds) {
          const jsonl = join(homedir(), '.proma-dev', 'agent-sessions', `${sessionId}.jsonl`)
          if (existsSync(jsonl)) {
            const evidencePath = join(evidenceDir, `${sessionId}.jsonl`)
            writeFileSync(evidencePath, readFileSync(jsonl))
            result.askUserJsonlEvidence = evidencePath
          }
        }
      }
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
    if (syntheticFileCleanupPath && existsSync(syntheticFileCleanupPath)) {
      try { unlinkSync(syntheticFileCleanupPath); result.syntheticJsonlCleanup = 'removed' }
      catch (error) { result.syntheticJsonlCleanup = `failed: ${String(error)}`; if (!result.error) result.error = result.syntheticJsonlCleanup }
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
      const intentionallyDeleted = new Set(result.explicitCleanupSessionIds ?? [])
      const changed = result.existingSessionManifestComparison.filter((item) => !item.unchanged && !intentionallyDeleted.has(item.id))
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
