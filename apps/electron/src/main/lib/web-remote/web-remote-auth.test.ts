import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_PAIRING_FAILURES,
  PAIRED_DEVICE_IDLE_TTL_MS,
  PAIRING_LOCK_MS,
  WebRemoteAuth,
  expectedWebRemoteOrigin,
  hashTokenForTest,
  makeAuthCookie,
  parseCookieHeader,
} from './web-remote-auth'

describe('WebRemoteAuth', () => {
  test('配对码六位、十分钟有效且单次使用', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-'))
    const auth = new WebRemoteAuth({ allowedOrigin: 'https://proma.example' }, dir)
    const pairing = auth.createPairingCode(1000)
    expect(pairing.code).toMatch(/^\d{6}$/)
    expect(pairing.expiresAt).toBe(601000)
    const paired = auth.pair(pairing.code, 'phone', 2000)
    expect(paired?.token).toBeString()
    expect(auth.pair(pairing.code, 'again', 2001)).toBeNull()
    expect(readFileSync(join(dir, 'devices.json'), 'utf8')).not.toContain(paired!.token)
    expect(readFileSync(join(dir, 'devices.json'), 'utf8')).toContain(hashTokenForTest(paired!.token))
  })

  test('错误五次后锁定十五分钟，过期码拒绝', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-'))
    const auth = new WebRemoteAuth({}, dir)
    const pairing = auth.createPairingCode(1000)
    for (let i = 0; i < MAX_PAIRING_FAILURES; i++) expect(auth.pair('000000', 'x', 1001 + i)).toBeNull()
    expect(auth.getPairingState()?.lockedUntil).toBe(1000 + MAX_PAIRING_FAILURES + PAIRING_LOCK_MS)
    expect(auth.pair(pairing.code, 'x', 1000 + MAX_PAIRING_FAILURES + 1)).toBeNull()
    const fresh = auth.createPairingCode(1000 + MAX_PAIRING_FAILURES + PAIRING_LOCK_MS + 1)
    expect(auth.pair(fresh.code, 'x', 1000 + MAX_PAIRING_FAILURES + PAIRING_LOCK_MS + 2)?.token).toBeString()

    const expired = new WebRemoteAuth({}, mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-')))
    const code = expired.createPairingCode(10).code
    expect(expired.pair(code, 'x', 10 + 10 * 60_000)).toBeNull()
  })

  test('令牌撤销、Origin、身份头与工作区范围均强制校验', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-'))
    const auth = new WebRemoteAuth({ allowedOrigin: 'proma.example', allowedTailscaleLogins: ['lee@example.com'], allowedWorkspaceIds: ['ws-1'] }, dir)
    const code = auth.createPairingCode().code
    const paired = auth.pair(code, 'phone')!
    expect(auth.authenticateToken(paired.token)?.id).toBe(paired.deviceId)
    expect(auth.isAllowedOrigin('https://proma.example')).toBe(true)
    expect(auth.isAllowedOrigin('https://evil.example')).toBe(false)
    expect(auth.isAllowedTailscaleLogin('lee@example.com')).toBe(true)
    expect(auth.isAllowedTailscaleLogin('other@example.com')).toBe(false)
    expect(auth.isWorkspaceAllowed('ws-1')).toBe(true)
    expect(auth.isWorkspaceAllowed('ws-2')).toBe(false)
    expect(auth.revokeDevice(paired.deviceId)).toBe(true)
    expect(auth.authenticateToken(paired.token)).toBeNull()
  })

  test('只读构造不创建数据目录，写入时才创建', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-')), 'missing')
    const auth = new WebRemoteAuth({}, dir)
    expect(existsSync(dir)).toBe(false)
    auth.createPairingCode()
    expect(existsSync(dir)).toBe(true)
  })

  test('令牌最近一分钟内认证不重复写入 lastUsedAt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-'))
    const auth = new WebRemoteAuth({}, dir)
    const paired = auth.pair(auth.createPairingCode(1000).code, 'phone', 1001)!
    expect(auth.authenticateToken(paired.token, 1_000)?.lastUsedAt).toBe(1_000)
    expect(auth.authenticateToken(paired.token, 2_000)?.lastUsedAt).toBe(1_000)
    expect(auth.authenticateToken(paired.token, 62_000)?.lastUsedAt).toBe(62_000)
  })

  test('超过 30 天未使用的配对设备在鉴权时惰性撤销并原子持久化', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-'))
    const auth = new WebRemoteAuth({}, dir)
    const paired = auth.pair(auth.createPairingCode(1_000).code, 'idle phone', 1_000)!
    const now = 1_000 + PAIRED_DEVICE_IDLE_TTL_MS + 1

    expect(auth.authenticateToken(paired.token, now)).toBeNull()
    const devices = JSON.parse(readFileSync(join(dir, 'devices.json'), 'utf8')) as { devices: Array<{ id: string; revokedAt?: number }> }
    expect(devices.devices).toHaveLength(1)
    expect(devices.devices[0]).toMatchObject({ id: paired.deviceId, revokedAt: now })
    expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  test('超过 30 天未使用时以 lastUsedAt 计算期限', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-'))
    const auth = new WebRemoteAuth({}, dir)
    const createdAt = 1_000
    const paired = auth.pair(auth.createPairingCode(createdAt).code, 'stale use', createdAt)!
    const now = createdAt + PAIRED_DEVICE_IDLE_TTL_MS + 1
    const devicePath = join(dir, 'devices.json')
    const file = JSON.parse(readFileSync(devicePath, 'utf8')) as { version: number; devices: Array<Record<string, unknown>> }
    file.devices[0]!.lastUsedAt = now - PAIRED_DEVICE_IDLE_TTL_MS - 1
    writeFileSync(devicePath, JSON.stringify(file))

    expect(auth.authenticateToken(paired.token, now)).toBeNull()
    expect(auth.listDevices(now)[0]?.revokedAt).toBe(now)
  })

  test('有 lastUsedAt 时以最近使用时间计算期限而非创建时间', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-'))
    const auth = new WebRemoteAuth({}, dir)
    const paired = auth.pair(auth.createPairingCode(1_000).code, 'recent phone', 1_000)!
    const now = 1_000 + PAIRED_DEVICE_IDLE_TTL_MS + 1
    const devicePath = join(dir, 'devices.json')
    const file = JSON.parse(readFileSync(devicePath, 'utf8')) as { version: number; devices: Array<Record<string, unknown>> }
    file.devices[0]!.lastUsedAt = now - PAIRED_DEVICE_IDLE_TTL_MS + 1
    writeFileSync(devicePath, JSON.stringify(file))

    expect(auth.authenticateToken(paired.token, now)?.id).toBe(paired.deviceId)
  })

  test('清除撤销超过 30 天的记录但保留近期撤销与 tailnet 身份', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-'))
    const now = 40 * 24 * 60 * 60_000
    writeFileSync(join(dir, 'devices.json'), JSON.stringify({ version: 1, devices: [
      { id: 'old-revoked', tokenHash: 'old', label: 'old', createdAt: 1, revokedAt: now - PAIRED_DEVICE_IDLE_TTL_MS - 1 },
      { id: 'recent-revoked', tokenHash: 'recent', label: 'recent', createdAt: 1, revokedAt: now - PAIRED_DEVICE_IDLE_TTL_MS + 1 },
      { id: 'tailnet:trusted-node', tokenHash: '', label: 'trusted', createdAt: 0 },
    ] }))
    const auth = new WebRemoteAuth({}, dir)

    auth.refreshFromDisk(now)

    const devices = auth.listDevices(now)
    expect(devices.map((device) => device.id)).toEqual(['recent-revoked', 'tailnet:trusted-node'])
    expect(JSON.parse(readFileSync(join(dir, 'devices.json'), 'utf8')).devices.map((device: { id: string }) => device.id)).toEqual(['recent-revoked', 'tailnet:trusted-node'])
  })

  test('Tailnet 受信设备满足身份、地址、whois 与节点 allowlist 时通过', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-'))
    const auth = new WebRemoteAuth({ allowedTailscaleLogins: ['jo@example.com'], trustedTailscaleNodes: ['iphone-15'] }, dir, async () => ({ Node: { ComputedName: 'iphone-15' }, UserProfile: { LoginName: 'jo@example.com' } }))
    expect((await auth.authenticateTrustedTailscale('jo@example.com', '100.90.1.2, 100.90.1.1'))?.id).toBe('tailnet:iphone-15')
    expect((await auth.authenticateTrustedTailscale('jo@example.com', 'fd7a:115c:a1e0::1234'))?.id).toBe('tailnet:iphone-15')
  })

  test('Tailnet 登录名不在 allowlist 时拒绝', async () => {
    const auth = new WebRemoteAuth({ allowedTailscaleLogins: ['jo@example.com'], trustedTailscaleNodes: ['iphone-15'] }, mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-')), async () => ({ Node: { ComputedName: 'iphone-15' }, UserProfile: { LoginName: 'jo@example.com' } }))
    expect(await auth.authenticateTrustedTailscale('other@example.com', '100.90.1.2')).toBeNull()
  })

  test('非 Tailnet 地址段拒绝且不调用 whois', async () => {
    let called = false
    const auth = new WebRemoteAuth({ allowedTailscaleLogins: ['jo@example.com'], trustedTailscaleNodes: ['iphone-15'] }, mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-')), async () => { called = true; return null })
    expect(await auth.authenticateTrustedTailscale('jo@example.com', '192.168.1.2')).toBeNull()
    expect(called).toBe(false)
  })

  test('whois 用户不匹配时拒绝', async () => {
    const auth = new WebRemoteAuth({ allowedTailscaleLogins: ['jo@example.com'], trustedTailscaleNodes: ['iphone-15'] }, mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-')), async () => ({ Node: { ComputedName: 'iphone-15' }, UserProfile: { LoginName: 'other@example.com' } }))
    expect(await auth.authenticateTrustedTailscale('jo@example.com', '100.90.1.2')).toBeNull()
  })

  test('节点名不在受信列表时拒绝', async () => {
    const auth = new WebRemoteAuth({ allowedTailscaleLogins: ['jo@example.com'], trustedTailscaleNodes: ['another-phone'] }, mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-')), async () => ({ Node: { ComputedName: 'iphone-15' }, UserProfile: { LoginName: 'jo@example.com' } }))
    expect(await auth.authenticateTrustedTailscale('jo@example.com', '100.90.1.2')).toBeNull()
  })

  test('whois 失败时拒绝', async () => {
    const auth = new WebRemoteAuth({ allowedTailscaleLogins: ['jo@example.com'], trustedTailscaleNodes: ['iphone-15'] }, mkdtempSync(join(tmpdir(), 'proma-web-remote-auth-')), async () => null)
    expect(await auth.authenticateTrustedTailscale('jo@example.com', '100.90.1.2')).toBeNull()
  })

  test('Cookie 使用 HttpOnly Secure Strict', () => {
    const cookie = makeAuthCookie('abc')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
    expect(parseCookieHeader(`${cookie}; other=x`)).toBe('abc')
    expect(expectedWebRemoteOrigin({ tailscaleHostname: 'proma.example' })).toBe('https://proma.example')
  })
})
