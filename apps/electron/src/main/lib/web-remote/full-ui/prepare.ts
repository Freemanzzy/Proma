import { getConfigDirName } from '../../config-paths'
import { isPersonalBuild } from '../../personal-build'
import { readWebRemoteConfig, type WebRemoteConfig } from '../web-remote-auth'
import { getWebRemoteIpcBridge, installWebRemoteIpcCapture, type IpcMainCaptureTarget, type WebRemoteIpcBridge, type WebRemoteScopeResolvers } from './web-remote-ipc'

function isAllowedRuntime(): boolean {
  return getConfigDirName() === '.proma-dev'
}

export function prepareWebRemoteFullUi(
  ipcMain?: IpcMainCaptureTarget,
  configOverride?: WebRemoteConfig,
  resolvers?: WebRemoteScopeResolvers,
  runtime?: { packaged: boolean },
): WebRemoteIpcBridge | null {
  if (!ipcMain) return null
  // 个人版安装包运行时没有 .proma-dev 数据目录、也不会设置 PROMA_WEB_REMOTE，
  // 这两道门只用于拦截开发实例；打包的个人版改为只看 config.enabled + config.fullUi。
  const packagedPersonal = runtime?.packaged === true && isPersonalBuild()
  if (!packagedPersonal && !configOverride && !isAllowedRuntime()) return null
  const config = configOverride ?? readWebRemoteConfig()
  if (!packagedPersonal && process.env.PROMA_WEB_REMOTE !== '1') return null
  if (config.enabled !== true || config.fullUi !== true) return null
  return getWebRemoteIpcBridge() ?? installWebRemoteIpcCapture(ipcMain, config, resolvers)
}
