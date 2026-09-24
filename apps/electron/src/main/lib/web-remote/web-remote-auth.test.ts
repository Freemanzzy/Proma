import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_PAIRING_FAILURES,
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

  test('Cookie 使用 HttpOnly Secure Strict', () => {
    const cookie = makeAuthCookie('abc')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
    expect(parseCookieHeader(`${cookie}; other=x`)).toBe('abc')
    expect(expectedWebRemoteOrigin({ tailscaleHostname: 'proma.example' })).toBe('https://proma.example')
  })
})
