import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebRemoteAuth } from './web-remote-auth'
import { WEB_REMOTE_PUSH_HTTP_ROUTE_POLICY, WebRemotePushStore, mapPushNotice, shouldDedupePush, shouldSendPush } from './web-remote-push'

describe('Web Remote Web Push', () => {
  test('所有新增 HTTP 路由均登记分级并限制为公开静态或当前设备自身范围', () => {
    expect(Object.keys(WEB_REMOTE_PUSH_HTTP_ROUTE_POLICY).sort()).toEqual(['DELETE /api/push/subscription', 'GET /api/push/key', 'GET /api/push/subscription', 'GET /app/sw.js', 'GET /apple-touch-icon.png', 'GET /icon-192.png', 'GET /icon-512-maskable.png', 'GET /icon-512.png', 'POST /api/push/presence', 'POST /api/push/subscription'].sort())
    expect(WEB_REMOTE_PUSH_HTTP_ROUTE_POLICY['GET /app/sw.js'].access).toBe('public-static')
    expect(WEB_REMOTE_PUSH_HTTP_ROUTE_POLICY['GET /apple-touch-icon.png'].access).toBe('public-static')
    expect(Object.values(WEB_REMOTE_PUSH_HTTP_ROUTE_POLICY).filter((entry) => entry.access.includes('authenticated-device'))).toHaveLength(5)
  })
  test('事件映射使用中文并将摘要截断至 120 字且隐藏明显敏感串', () => {
    const notice = mapPushNotice('s-1', '测试会话', 'completed', `完成 ${'字'.repeat(200)} sk-12345678901234567890`)
    expect(notice.title).toContain('测试会话')
    expect([...notice.body].length).toBeLessThanOrEqual(120)
    expect(notice.body).not.toContain('sk-12345678901234567890')
  })

  test('同会话同事件 30 秒内去重；手机当前可见会话静默，隐藏/桌面设备不静默', () => {
    const base = Date.now()
    expect(shouldDedupePush('push-test-session', 'completed', base)).toBe(true)
    expect(shouldDedupePush('push-test-session', 'completed', base + 29_999)).toBe(false)
    expect(shouldDedupePush('push-test-session', 'completed', base + 30_000)).toBe(true)
    const presence = new Map([['phone', { sessionId: 's-1', visible: true, updatedAt: base }], ['hidden', { sessionId: 's-1', visible: false, updatedAt: base }]])
    expect(shouldSendPush('phone', 's-1', presence, base + 1)).toBe(false)
    expect(shouldSendPush('hidden', 's-1', presence, base + 1)).toBe(true)
    expect(shouldSendPush('desktop', 's-1', presence, base + 1)).toBe(true)
  })

  test('无授权工作区不推送；暂时性错误会重试一次', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-push-scope-'))
    const auth = new WebRemoteAuth({ workspaceScope: 'allowlist', allowedWorkspaceIds: ['allowed'] }, dir)
    let calls = 0
    const push = new WebRemotePushStore(dir, auth, () => 'blocked', '', async () => { calls++; return { statusCode: 201 } as never })
    const subscription = { endpoint: 'https://push.example/sub/2', keys: { p256dh: Buffer.alloc(32, 3).toString('base64url'), auth: Buffer.alloc(16, 4).toString('base64url') } }
    push.register('phone', 'Phone', subscription)
    expect(await push.sendToAll(mapPushNotice('s-no-access', 'Restricted', 'completed'))).toHaveLength(0)
    expect(calls).toBe(0)

    const retry = new WebRemotePushStore(dir, auth, () => 'allowed', '', async () => { calls++; if (calls === 1) throw new Error('temporary'); return { statusCode: 201 } as never })
    expect(await retry.sendToAll(mapPushNotice('s-allowed', 'Allowed', 'completed'))).toHaveLength(1)
    expect(calls).toBe(2)
  })

  test('桌面发送测试通知返回推送端点状态码', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-push-test-'))
    const auth = new WebRemoteAuth({ workspaceScope: 'all' }, dir)
    const push = new WebRemotePushStore(dir, auth, () => 'workspace', '', async () => ({ statusCode: 201 } as never))
    push.register('phone', 'Android 手机', { endpoint: 'https://push.example/test', keys: { p256dh: Buffer.alloc(32, 5).toString('base64url'), auth: Buffer.alloc(16, 6).toString('base64url') } })
    expect(await push.sendTest('phone')).toEqual({ status: 201 })
  })

  test('订阅和 VAPID key 为 0600；发送返回 410 时自动移除订阅', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-push-'))
    const auth = new WebRemoteAuth({ workspaceScope: 'all' }, dir)
    const push = new WebRemotePushStore(dir, auth, () => 'workspace')
    const keyPath = join(dir, 'vapid.json')
    expect(statSync(keyPath).mode & 0o777).toBe(0o600)
    const subscription = { endpoint: 'https://push.example/sub/1', keys: { p256dh: Buffer.alloc(32, 1).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') } }
    push.register('phone', 'Android 手机', subscription)
    expect(statSync(join(dir, 'push-subscriptions.json')).mode & 0o777).toBe(0o600)
    const expired = new WebRemotePushStore(dir, auth, () => 'workspace', '', async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }) })
    const result = await expired.sendToAll(mapPushNotice('s-1', '测试会话', 'completed'))
    expect(result[0]?.status).toBe(410)
    expect(expired.list()).toHaveLength(0)
    expect(JSON.parse(readFileSync(keyPath, 'utf8')).privateKey).toBeString()
  })
})
