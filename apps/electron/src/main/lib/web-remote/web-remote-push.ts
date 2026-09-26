import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import webPush from 'web-push'
import type { WebRemoteAuth } from './web-remote-auth'

export type PushKind = 'completed' | 'failed' | 'permission' | 'question' | 'plan' | 'automation'
export interface PushNotice { sessionId: string; kind: PushKind; title: string; body: string }
export interface StoredPushSubscription { deviceId: string; label: string; subscription: webPush.PushSubscription; updatedAt: number }
interface PushFile { version: 1; subscriptions: StoredPushSubscription[] }
interface VapidFile { publicKey: string; privateKey: string }
interface Presence { sessionId: string | null; visible: boolean; updatedAt: number }
const dedupe = new Map<string, number>()

export const WEB_REMOTE_PUSH_HTTP_ROUTE_POLICY = Object.freeze({
  'GET /app/sw.js': { access: 'public-static', rationale: '返回固定 Service Worker 代码，不返回用户数据，不缓存 API 或受保护页面。' },
  'GET /api/push/key': { access: 'authenticated-device', rationale: '只返回本地生成的 VAPID 公钥。' },
  'GET /api/push/subscription': { access: 'authenticated-device', rationale: '仅查询当前认证设备自身的订阅状态。' },
  'POST /api/push/subscription': { access: 'authenticated-device-self-write', rationale: '仅以当前认证设备 ID 写入其订阅。' },
  'DELETE /api/push/subscription': { access: 'authenticated-device-self-delete', rationale: '仅删除当前认证设备自身订阅。' },
  'POST /api/push/presence': { access: 'authenticated-device-session-scope', rationale: '仅允许上报当前设备对已授权会话的可见状态。' },
} as const)

export function truncatePushText(value: string, max = 120): string {
  const safe = value.replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|https?:\/\/\S+)/gi, '[已隐藏]').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return [...safe].slice(0, max).join('')
}

export function mapPushNotice(sessionId: string, sessionTitle: string, kind: PushKind, summary = ''): PushNotice {
  const labels: Record<PushKind, string> = { completed: '运行已完成', failed: '运行失败', permission: '等待权限审批', question: 'Agent 有问题需要回答', plan: '计划等待审批', automation: '定时任务运行完成' }
  const brief = truncatePushText(summary) || labels[kind]
  return { sessionId, kind, title: truncatePushText(`Proma · ${sessionTitle}`, 80), body: truncatePushText(`${labels[kind]}：${brief}`, 120) }
}

export function shouldSendPush(deviceId: string, sessionId: string, presence: Map<string, Presence>, now = Date.now()): boolean {
  const item = presence.get(deviceId)
  return !(item && item.visible && item.sessionId === sessionId && now - item.updatedAt < 60_000)
}

export class WebRemotePushStore {
  private readonly file: string
  private readonly vapidFile: string
  private keys: VapidFile
  private subscriptions: PushFile
  private readonly presence = new Map<string, Presence>()
  constructor(dataDir: string, private readonly auth: WebRemoteAuth, private readonly getSessionWorkspace: (sessionId: string) => string | undefined, private readonly proxyUrl = process.env.PROMA_WEB_PUSH_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:7897', private readonly sendImpl: typeof webPush.sendNotification = webPush.sendNotification.bind(webPush)) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 }); chmodSync(dataDir, 0o700)
    this.file = join(dataDir, 'push-subscriptions.json'); this.vapidFile = join(dataDir, 'vapid.json')
    this.keys = this.readKeys(); this.subscriptions = this.readSubscriptions()
  }
  getPublicKey(): string { return this.keys.publicKey }
  list(): Array<{ deviceId: string; label: string; updatedAt: number }> { this.reload(); return this.subscriptions.subscriptions.map(({ deviceId, label, updatedAt }) => ({ deviceId, label, updatedAt })) }
  has(deviceId: string): boolean { this.reload(); return this.subscriptions.subscriptions.some((item) => item.deviceId === deviceId) }
  setPresence(deviceId: string, sessionId: string | null, visible: boolean): void { this.presence.set(deviceId, { sessionId, visible, updatedAt: Date.now() }) }
  remove(deviceId: string): boolean { this.reload(); const before = this.subscriptions.subscriptions.length; this.subscriptions.subscriptions = this.subscriptions.subscriptions.filter((item) => item.deviceId !== deviceId); const changed = before !== this.subscriptions.subscriptions.length; if (changed) this.persist(); return changed }
  register(deviceId: string, label: string, subscription: unknown): void {
    if (!subscription || typeof subscription !== 'object') throw new Error('订阅无效')
    const value = subscription as webPush.PushSubscription
    if (typeof value.endpoint !== 'string' || value.endpoint.length > 4096 || !value.endpoint.startsWith('https://') || typeof value.keys?.auth !== 'string' || typeof value.keys?.p256dh !== 'string') throw new Error('订阅格式无效')
    this.reload(); this.subscriptions.subscriptions = this.subscriptions.subscriptions.filter((item) => item.deviceId !== deviceId)
    this.subscriptions.subscriptions.push({ deviceId, label: truncatePushText(label || '手机设备', 80), subscription: value, updatedAt: Date.now() }); this.persist()
  }
  async sendToAll(notice: PushNotice): Promise<Array<{ deviceId: string; status: number | null; error?: string }>> {
    this.reload(); const results = []
    for (const item of [...this.subscriptions.subscriptions]) {
      if (!this.auth.isWorkspaceAllowed(this.getSessionWorkspace(notice.sessionId)) || !shouldSendPush(item.deviceId, notice.sessionId, this.presence)) continue
      let status: number | null = null
      try {
        const response = await this.sendWithRetry(item.subscription, JSON.stringify({ ...notice, url: `/app/?session=${encodeURIComponent(notice.sessionId)}` }))
        status = response.statusCode
        results.push({ deviceId: item.deviceId, status })
      } catch (error) {
        const cause = error as { statusCode?: number; message?: string }
        status = cause.statusCode ?? null
        if (status === 404 || status === 410) this.remove(item.deviceId)
        results.push({ deviceId: item.deviceId, status, error: status ? `push endpoint returned ${status}` : String(cause.message ?? 'push failed').slice(0, 160) })
      }
    }
    return results
  }
  async sendTest(deviceId: string): Promise<{ status: number | null; error?: string }> {
    this.reload(); const item = this.subscriptions.subscriptions.find((entry) => entry.deviceId === deviceId); if (!item) throw new Error('订阅不存在')
    try { const result = await this.sendWithRetry(item.subscription, JSON.stringify({ title: 'Proma · 测试通知', body: '手机通知已连接。', sessionId: '', url: '/app/' })); return { status: result.statusCode } }
    catch (error) { const status = (error as { statusCode?: number }).statusCode ?? null; if (status === 404 || status === 410) this.remove(deviceId); return { status, error: status ? `push endpoint returned ${status}` : String((error as Error).message).slice(0, 160) } }
  }
  private async sendWithRetry(subscription: webPush.PushSubscription, payload: string): Promise<{ statusCode: number }> {
    const options: webPush.RequestOptions = { vapidDetails: { subject: 'https://proma.cool', publicKey: this.keys.publicKey, privateKey: this.keys.privateKey }, TTL: 60, ...(this.proxyUrl ? { proxy: this.proxyUrl } : {}) }
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await this.sendImpl(subscription, payload, options) }
      catch (error) { const status = (error as { statusCode?: number }).statusCode; if (attempt === 1 || status === 404 || status === 410) throw error; await new Promise((resolve) => setTimeout(resolve, 200)) }
    }
    throw new Error('push failed')
  }
  private readKeys(): VapidFile {
    try { const value = JSON.parse(readFileSync(this.vapidFile, 'utf8')) as VapidFile; if (value.publicKey && value.privateKey) { chmodSync(this.vapidFile, 0o600); return value } } catch {}
    const generated = webPush.generateVAPIDKeys(); const value = { publicKey: generated.publicKey, privateKey: generated.privateKey }
    writeFileSync(this.vapidFile, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); chmodSync(this.vapidFile, 0o600); return value
  }
  private readSubscriptions(): PushFile { try { const value = JSON.parse(readFileSync(this.file, 'utf8')) as PushFile; if (value.version === 1 && Array.isArray(value.subscriptions)) return value } catch {} return { version: 1, subscriptions: [] } }
  private reload(): void { if (existsSync(this.file)) this.subscriptions = this.readSubscriptions() }
  private persist(): void { const temp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`; writeFileSync(temp, JSON.stringify(this.subscriptions, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); chmodSync(temp, 0o600); renameSync(temp, this.file); chmodSync(this.file, 0o600) }
}

export function shouldDedupePush(sessionId: string, kind: PushKind, now = Date.now()): boolean {
  const key = `${sessionId}:${kind}`; const previous = dedupe.get(key)
  if (previous && now - previous < 30_000) return false
  dedupe.set(key, now); for (const [entry, time] of dedupe) if (now - time > 60_000) dedupe.delete(entry)
  return true
}
export function createPushTestSubscription(endpoint: string): webPush.PushSubscription { return { endpoint, keys: { p256dh: randomBytes(32).toString('base64url'), auth: randomBytes(16).toString('base64url') } } }
