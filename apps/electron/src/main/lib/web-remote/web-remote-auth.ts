import { execFile } from 'node:child_process'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { isIP } from 'node:net'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
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
  trustedTailscaleNodes?: string[]
  allowedWorkspaceIds?: string[]
  /** 在同一份 renderer 上开启完整 UI 浏览器桥接。 */
  fullUi?: boolean
  /** 工作区范围；省略时沿用安全的 allowlist 默认值。 */
  workspaceScope?: 'allowlist' | 'all'
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

const execFileAsync = promisify(execFile)
const TAILSCALE_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
const WHOIS_CACHE_TTL_MS = 60_000
const whoisCache = new Map<string, { expiresAt: number; value: TailscaleWhois | null }>()

interface TailscaleWhois {
  Node?: { ComputedName?: string }
  UserProfile?: { LoginName?: string }
}

function isTailnetIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const parts = ip.split('.').map(Number)
    return parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127
  }
  if (isIP(ip) !== 6 || ip.includes('%')) return false
  const halves = ip.toLowerCase().split('::')
  if (halves.length > 2) return false
  const left = halves[0] ? halves[0]!.split(':') : []
  const right = halves[1] ? halves[1]!.split(':') : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return false
  const groups = [...left, ...Array(missing).fill('0'), ...right]
  return groups.length === 8 && groups[0]!.toLowerCase() === 'fd7a' && groups[1]!.toLowerCase() === '115c' && groups[2]!.toLowerCase() === 'a1e0'
}

async function lookupTailscaleNode(ip: string): Promise<TailscaleWhois | null> {
  const cached = whoisCache.get(ip)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  try {
    const { stdout } = await execFileAsync(TAILSCALE_CLI, ['whois', '--json', ip], { timeout: 2_000, maxBuffer: 256 * 1024 })
    const value = JSON.parse(stdout) as TailscaleWhois
    whoisCache.set(ip, { expiresAt: Date.now() + WHOIS_CACHE_TTL_MS, value })
    return value
  } catch {
    whoisCache.set(ip, { expiresAt: Date.now() + WHOIS_CACHE_TTL_MS, value: null })
    return null
  }
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
  private config: WebRemoteConfig

  private lastPersistedAt = Number.NEGATIVE_INFINITY

  constructor(
    config: WebRemoteConfig,
    private readonly dataDir: string,
    private readonly whoisLookup: (ip: string) => Promise<TailscaleWhois | null> = lookupTailscaleNode,
  ) {
    this.config = config
    this.pairing = readJson<PairingState | null>(join(dataDir, 'pairing.json'), null)
    this.devices = readJson<DeviceFile>(join(dataDir, 'devices.json'), { version: 1, devices: [] })
  }

  getConfig(): WebRemoteConfig {
    return this.config
  }

  refreshFromDisk(): void {
    this.pairing = readJson<PairingState | null>(join(this.dataDir, 'pairing.json'), this.pairing)
    this.devices = readJson<DeviceFile>(join(this.dataDir, 'devices.json'), this.devices)
    const configPath = join(this.dataDir, 'config.json')
    if (existsSync(configPath)) this.config = readJson<WebRemoteConfig>(configPath, this.config)
  }

  async authenticateTrustedTailscale(login: string | undefined, forwardedFor: string | undefined): Promise<DeviceRecord | null> {
    if (!login || !Array.isArray(this.config.allowedTailscaleLogins) || !this.config.allowedTailscaleLogins.includes(login)) return null
    const ip = forwardedFor?.split(',')[0]?.trim()
    if (!ip || !isTailnetIp(ip)) return null
    const identity = await this.whoisLookup(ip)
    const computedName = identity?.Node?.ComputedName
    if (!identity || identity.UserProfile?.LoginName !== login || !computedName || !this.config.trustedTailscaleNodes?.includes(computedName)) return null
    return { id: `tailnet:${computedName}`, tokenHash: '', label: computedName, createdAt: 0 }
  }

  isTrustedTailscaleNode(nodeName: string): boolean {
    return Array.isArray(this.config.trustedTailscaleNodes) && this.config.trustedTailscaleNodes.includes(nodeName)
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
    const expected = expectedWebRemoteOrigin(this.config)
    return !!normalized && !!expected && normalized === expected
  }

  isAllowedTailscaleLogin(login: string | undefined): boolean {
    if (typeof login !== 'string' || !login) return false
    const allowed = this.config.allowedTailscaleLogins
    return !allowed || allowed.includes(login)
  }

  isWorkspaceAllowed(workspaceId: string | undefined): boolean {
    if (!workspaceId) return false
    if (this.config.workspaceScope === 'all') return true
    const allowed = this.config.allowedWorkspaceIds
    return Array.isArray(allowed) && allowed.length > 0 && allowed.includes(workspaceId)
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

export function makeAuthCookie(token: string, secure = true): string {
  return `${WEB_REMOTE_COOKIE}=${token}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict`
}

export function hashTokenForTest(token: string): string {
  return sha256(token)
}
