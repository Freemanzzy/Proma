import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { getConfigDirName } from '../config-paths'
import { isPersonalBuild } from '../personal-build'
import { isDesktopAdminAllowed } from './web-remote-policy'
import { getWebRemoteConfigPath, getWebRemoteDataDir, readWebRemoteConfig, WebRemoteAuth, type WebRemoteConfig } from './web-remote-auth'
import { getWebRemoteServer } from './web-remote-service'
import { listAgentWorkspaces } from '../agent-workspace-manager'

const CHANNELS = ['web-remote:admin-get', 'web-remote:admin-save', 'web-remote:admin-pair', 'web-remote:admin-revoke', 'web-remote:admin-push-test', 'web-remote:admin-push-delete'] as const
/**
 * Only the real desktop renderer may manage phone access. The web-remote bridge
 * invokes handlers with a fake event whose senderFrame is null, so it can never
 * pass; the channels are also `denied` in the remote channel policy.
 * Packaged builds load the renderer from file://; the unpackaged dev instance
 * loads it from the local Vite dev server.
 */
function assertDesktop(event: IpcMainInvokeEvent): void {
  const personalPackaged = app.isPackaged && isPersonalBuild()
  if (!isDesktopAdminAllowed({ personalPackaged, configDirName: getConfigDirName(), packaged: app.isPackaged, url: event.senderFrame?.url })) throw new Error('仅个人版或开发实例桌面设置可管理手机访问')
}
function atomicWriteConfig(config: WebRemoteConfig): void {
  const dir = getWebRemoteDataDir(); mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = getWebRemoteConfigPath(); const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); chmodSync(temp, 0o600); renameSync(temp, path)
}
function validateConfig(input: unknown, current: WebRemoteConfig): WebRemoteConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置必须为对象')
  const patch = input as Record<string, unknown>
  const allowed = new Set(['enabled', 'fullUi', 'workspaceScope', 'allowedWorkspaceIds', 'trustedTailscaleNodes'])
  if (Object.keys(patch).some((key) => !allowed.has(key))) throw new Error('包含不支持的配置字段')
  const next = { ...current }
  for (const key of ['enabled', 'fullUi'] as const) if (key in patch) {
    if (typeof patch[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`)
    next[key] = patch[key] as boolean
  }
  if ('workspaceScope' in patch) {
    if (patch.workspaceScope !== 'all' && patch.workspaceScope !== 'allowlist') throw new Error('工作区范围无效')
    next.workspaceScope = patch.workspaceScope
  }
  for (const key of ['allowedWorkspaceIds', 'trustedTailscaleNodes'] as const) if (key in patch) {
    const value = patch[key]
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 255) || new Set(value).size !== value.length) throw new Error(`${key} 必须是无重复的字符串数组`)
    if (key === 'allowedWorkspaceIds' && value.some((id) => !listAgentWorkspaces().some((workspace) => workspace.id === id))) throw new Error('工作区列表包含未知 ID')
    next[key] = [...value] as string[]
  }
  return next
}
function readTailnetCandidates(): Array<{ name: string; os: string; online: boolean; login: string }> {
  try {
    const output = execFileSync('/Applications/Tailscale.app/Contents/MacOS/Tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024 })
    const status = JSON.parse(output) as { Self?: { UserID?: number }; User?: Record<string, { LoginName?: string }>; Peer?: Record<string, { HostName?: string; DNSName?: string; OS?: string; Online?: boolean; UserID?: number }> }
    const users = status.User ?? {}
    const ownLogin = status.Self?.UserID === undefined ? undefined : users[String(status.Self.UserID)]?.LoginName
    if (!ownLogin) return []
    return Object.values(status.Peer ?? []).map((peer) => ({ name: (peer.DNSName ?? peer.HostName ?? '').replace(/\.$/, ''), os: peer.OS ?? '未知', online: peer.Online === true, login: peer.UserID === undefined ? '' : users[String(peer.UserID)]?.LoginName ?? '' }))
      .filter((item) => !!item.name && item.login === ownLogin)
  } catch { return [] }
}
export function registerWebRemoteAdminIpc(): void {
  ipcMain.handle(CHANNELS[0], (event) => {
    assertDesktop(event)
    const config = readWebRemoteConfig(); const server = getWebRemoteServer(); const auth = server?.getAuth() ?? new WebRemoteAuth(config, getWebRemoteDataDir())
    const pairing = auth.getPairingState()
    return { config, running: !!server, connectedDevices: server?.getConnectedDeviceCount() ?? 0, devices: auth.listDevices().filter((item) => !item.revokedAt), pushSubscriptions: server?.getPushStore().list() ?? [], pairing: pairing && pairing.expiresAt > Date.now() ? { code: pairing.code, expiresAt: pairing.expiresAt } : null, candidates: readTailnetCandidates(), workspaces: listAgentWorkspaces().map(({ id, name, slug }) => ({ id, name, slug })) }
  })
  ipcMain.handle(CHANNELS[1], (event, patch: unknown) => { assertDesktop(event); const next = validateConfig(patch, readWebRemoteConfig()); atomicWriteConfig(next); getWebRemoteServer()?.getAuth().refreshFromDisk(); return next })
  ipcMain.handle(CHANNELS[2], (event) => { assertDesktop(event); const server = getWebRemoteServer(); if (!server) throw new Error('远程服务未运行，请先启用并重启开发实例'); return server.getAuth().createPairingCode() })
  ipcMain.handle(CHANNELS[3], (event, deviceId: unknown) => { assertDesktop(event); if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 160) throw new Error('设备 ID 无效'); const server = getWebRemoteServer(); const auth = server?.getAuth() ?? new WebRemoteAuth(readWebRemoteConfig(), getWebRemoteDataDir()); if (!auth.revokeDevice(deviceId)) throw new Error('设备不存在或已撤销'); server?.getPushStore().remove(deviceId); return true })
  ipcMain.handle(CHANNELS[4], async (event, deviceId: unknown) => { assertDesktop(event); if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 160) throw new Error('设备 ID 无效'); const server = getWebRemoteServer(); if (!server) throw new Error('远程服务未运行'); return server.getPushStore().sendTest(deviceId) })
  ipcMain.handle(CHANNELS[5], (event, deviceId: unknown) => { assertDesktop(event); if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 160) throw new Error('设备 ID 无效'); return getWebRemoteServer()?.getPushStore().remove(deviceId) ?? false })
}
