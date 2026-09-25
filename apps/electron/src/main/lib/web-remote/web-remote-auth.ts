import { createHash, randomBytes, randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getConfigDir } from '../config-paths'

export const WEB_REMOTE_COOKIE = 'proma_web_remote'
export const PAIRING_CODE_TTL_MS = 10 * 60_000
export const PAIRING_LOCK_MS = 15 * 60_000
export const MAX_PAIRING_FAILURES = 5

export interface WebRemoteConfig {
  enabled?: boolean
  port?: number
  allowedOrigin?: string
  tailscaleHostname?: string
  allowedTailscaleLogins?: string[]
  allowedWorkspaceIds?: string[]
  /** 仅开发目录启用的额外 Origin（例如本机回环验证）。 */
  extraAllowedOrigins?: string[]
  /** 在同一份 renderer 上开启完整 UI 浏览器桥接。 */
  fullUi?: boolean
}

interface PairingState {
  code: string
  expiresAt: number
  failures: number
  lockedUntil?: number
}

interface DeviceRecord {
  id: string
  tokenHash: string
  label: string
  createdAt: number
  lastUsedAt?: number
  revokedAt?: number
}

interface DeviceFile {
  version: 1
  devices: DeviceRecord[]
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(path: string, value: unknown): void {
  const parent = join(path, '..')
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

export function getWebRemoteDataDir(): string {
  return join(getConfigDir(), 'web-remote')
}

export function getWebRemoteConfigPath(): string {
  return join(getWebRemoteDataDir(), 'config.json')
}

export function getWebRemoteDevicesPath(): string {
  return join(getWebRemoteDataDir(), 'devices.json')
}

export function getWebRemotePairingPath(): string {
  return join(getWebRemoteDataDir(), 'pairing.json')
}

export function readWebRemoteConfig(): WebRemoteConfig {
  return readJson<WebRemoteConfig>(getWebRemoteConfigPath(), {})
}

export function normalizeOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined
  try {
    return new URL(origin).origin
  } catch {
    try {
      return new URL(`https://${origin}`).origin
    } catch {
      return undefined
    }
  }
}

export function expectedWebRemoteOrigin(config: WebRemoteConfig): string | undefined {
  return normalizeOrigin(config.allowedOrigin ?? config.tailscaleHostname)
}

export class WebRemoteAuth {
  private pairing: PairingState | null
  private devices: DeviceFile

  private lastPersistedAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly config: WebRemoteConfig,
    private readonly dataDir: string,
  ) {
    this.pairing = readJson<PairingState | null>(join(dataDir, 'pairing.json'), null)
    this.devices = readJson<DeviceFile>(join(dataDir, 'devices.json'), { version: 1, devices: [] })
  }

  getConfig(): WebRemoteConfig {
    return this.config
  }

  refreshFromDisk(): void {
    this.pairing = readJson<PairingState | null>(join(this.dataDir, 'pairing.json'), this.pairing)
    this.devices = readJson<DeviceFile>(join(this.dataDir, 'devices.json'), this.devices)
  }

  getRevokedDeviceIds(): string[] {
    return this.devices.devices.filter((device) => device.revokedAt).map((device) => device.id)
  }

  createPairingCode(now = Date.now()): { code: string; expiresAt: number } {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    this.pairing = { code, expiresAt: now + PAIRING_CODE_TTL_MS, failures: 0 }
    writeJson(join(this.dataDir, 'pairing.json'), this.pairing)
    return { code, expiresAt: this.pairing.expiresAt }
  }

  getPairingState(): PairingState | null {
    return this.pairing ? { ...this.pairing } : null
  }

  pair(code: string, label = 'Web Remote', now = Date.now()): { token: string; deviceId: string } | null {
    this.refreshFromDisk()
    const state = this.pairing
    if (!state) return null
    if (state.lockedUntil && state.lockedUntil > now) return null
    if (state.expiresAt <= now) {
      this.pairing = null
      writeJson(join(this.dataDir, 'pairing.json'), null)
      return null
    }
    if (!/^\d{6}$/.test(code) || code !== state.code) {
      state.failures += 1
      if (state.failures >= MAX_PAIRING_FAILURES) state.lockedUntil = now + PAIRING_LOCK_MS
      writeJson(join(this.dataDir, 'pairing.json'), state)
      return null
    }

    const token = randomBytes(32).toString('base64url')
    const deviceId = randomBytes(12).toString('hex')
    this.devices.devices.push({ id: deviceId, tokenHash: sha256(token), label: label.slice(0, 80), createdAt: now })
    this.pairing = null
    writeJson(join(this.dataDir, 'pairing.json'), null)
    writeJson(join(this.dataDir, 'devices.json'), this.devices)
    return { token, deviceId }
  }

  authenticateToken(token: string | undefined, now = Date.now()): DeviceRecord | null {
    if (!token) return null
    this.refreshFromDisk()
    const tokenHash = sha256(token)
    const device = this.devices.devices.find((candidate) => candidate.tokenHash === tokenHash && !candidate.revokedAt)
    if (!device) return null
    if (now - this.lastPersistedAt >= 60_000) {
      device.lastUsedAt = now
      writeJson(join(this.dataDir, 'devices.json'), this.devices)
      this.lastPersistedAt = now
    }
    return { ...device }
  }

  revokeDevice(deviceId: string): boolean {
    this.refreshFromDisk()
    const device = this.devices.devices.find((candidate) => candidate.id === deviceId && !candidate.revokedAt)
    if (!device) return false
    device.revokedAt = Date.now()
    writeJson(join(this.dataDir, 'devices.json'), this.devices)
    return true
  }

  listDevices(): Array<Omit<DeviceRecord, 'tokenHash'>> {
    return this.devices.devices.map(({ tokenHash: _tokenHash, ...device }) => ({ ...device }))
  }

  isAllowedOrigin(origin: string | undefined): boolean {
    const normalized = normalizeOrigin(origin)
    if (!normalized) return false
    const expected = expectedWebRemoteOrigin(this.config)
    if (expected && normalized === expected) return true
    return this.isExtraAllowedOrigin(normalized)
  }

  isExtraAllowedOrigin(origin: string | undefined): boolean {
    const normalized = normalizeOrigin(origin)
    return !!normalized && (this.config.extraAllowedOrigins ?? []).some((allowed) => normalizeOrigin(allowed) === normalized)
  }

  isAllowedTailscaleLogin(login: string | undefined): boolean {
    const allowed = this.config.allowedTailscaleLogins
    return !allowed || (typeof login === 'string' && allowed.includes(login))
  }

  isWorkspaceAllowed(workspaceId: string | undefined): boolean {
    const allowed = this.config.allowedWorkspaceIds
    return !!workspaceId && Array.isArray(allowed) && allowed.length > 0 && allowed.includes(workspaceId)
  }
}

export function parseCookieHeader(header: string | undefined, name = WEB_REMOTE_COOKIE): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=') || undefined
  }
  return undefined
}

export function makeAuthCookie(token: string): string {
  return `${WEB_REMOTE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`
}

export function hashTokenForTest(token: string): string {
  return sha256(token)
}
