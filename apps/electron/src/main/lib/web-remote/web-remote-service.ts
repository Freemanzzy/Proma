import { getConfigDirName } from '../config-paths'
import { getEffectiveProxyUrl } from '../proxy-settings-service'
import { readWebRemoteConfig, getWebRemoteConfigPath, getWebRemoteDataDir, WebRemoteAuth, type WebRemoteConfig } from './web-remote-auth'
import { WebRemoteServer } from './web-remote-server'
import { setWebRemoteEventHub, notifyWebRemoteInteractionResolved } from './web-remote-events'
import { getWebRemoteIpcBridge } from './full-ui/web-remote-ipc'
export { prepareWebRemoteFullUi } from './full-ui/prepare'

let server: WebRemoteServer | null = null

export function isWebRemoteEnabled(config: WebRemoteConfig): boolean {
  return process.env.PROMA_WEB_REMOTE === '1' && config.enabled === true
}

// prepareWebRemoteFullUi lives in full-ui/prepare.ts to keep service tests Electron-free.
export function isWebRemoteConfigDirAllowed(configDirName: string, allowProd = process.env.PROMA_WEB_REMOTE_ALLOW_PROD === '1'): boolean {
  return configDirName === '.proma-dev' || allowProd
}

export function isWebRemoteRuntimeAllowed(): boolean {
  if (isWebRemoteConfigDirAllowed(getConfigDirName())) return true
  console.error('[Web Remote] 已拒绝：仅允许在 PROMA_DEV=1 的个人开发实例运行。若明确确认风险，可设置 PROMA_WEB_REMOTE_ALLOW_PROD=1。')
  return false
}

export async function startWebRemoteIfEnabled(): Promise<void> {
  if (!isWebRemoteRuntimeAllowed()) return
  const config = readWebRemoteConfig()
  if (!isWebRemoteEnabled(config)) return
  if (server) return
  const ipcBridge = config.fullUi === true ? getWebRemoteIpcBridge() ?? undefined : undefined
  const configuredPushProxy = getConfigDirName() === '.proma-dev' ? await getEffectiveProxyUrl().catch(() => undefined) : undefined
  const candidate = new WebRemoteServer({
    config,
    auth: new WebRemoteAuth(config, getWebRemoteDataDir()),
    ipcBridge,
    ...(configuredPushProxy ? { pushProxyUrl: configuredPushProxy } : {}),
  })
  try {
    await candidate.start(Number.isInteger(config.port) ? config.port! : 17888, '127.0.0.1')
    server = candidate
    setWebRemoteEventHub(candidate.getEventHub())
    console.log(`[Web Remote] 已启动: 127.0.0.1:${Number.isInteger(config.port) ? config.port : 17888}`)
  } catch (error) {
    console.error('[Web Remote] 启动失败（已忽略，不影响主程序）:', error instanceof Error ? error.message : String(error))
    candidate.getEventHub().dispose()
    await candidate.stop().catch(() => {})
  }
}

export async function stopWebRemote(): Promise<void> {
  const current = server
  server = null
  setWebRemoteEventHub(null)
  if (!current) return
  current.getEventHub().dispose()
  await current.stop().catch((error) => console.error('[Web Remote] 停止失败:', error))
  console.log('[Web Remote] 已停止')
}

export function getWebRemoteServer(): WebRemoteServer | null {
  return server
}

export function getWebRemoteConfigFilePath(): string {
  return getWebRemoteConfigPath()
}

export { notifyWebRemoteInteractionResolved }
