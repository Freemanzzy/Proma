import { readWebRemoteConfig, getWebRemoteConfigPath, type WebRemoteConfig } from './web-remote-auth'
import { WebRemoteServer } from './web-remote-server'
import { setWebRemoteEventHub, notifyWebRemoteInteractionResolved } from './web-remote-events'

let server: WebRemoteServer | null = null

export function isWebRemoteEnabled(config: WebRemoteConfig = readWebRemoteConfig()): boolean {
  return process.env.PROMA_WEB_REMOTE === '1' && config.enabled === true
}

export async function startWebRemoteIfEnabled(): Promise<void> {
  if (!isWebRemoteEnabled()) return
  if (server) return
  const config = readWebRemoteConfig()
  const candidate = new WebRemoteServer({ config })
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
