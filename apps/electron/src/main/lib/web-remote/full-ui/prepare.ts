import { getConfigDirName } from '../../config-paths'
import { readWebRemoteConfig, type WebRemoteConfig } from '../web-remote-auth'
import { getWebRemoteIpcBridge, installWebRemoteIpcCapture, type IpcMainCaptureTarget, type WebRemoteIpcBridge, type WebRemoteScopeResolvers } from './web-remote-ipc'

function isAllowedRuntime(): boolean {
  return getConfigDirName() === '.proma-dev'
}

export function prepareWebRemoteFullUi(
  ipcMain?: IpcMainCaptureTarget,
  configOverride?: WebRemoteConfig,
  resolvers?: WebRemoteScopeResolvers,
): WebRemoteIpcBridge | null {
  if (!ipcMain) return null
  if (!configOverride && !isAllowedRuntime()) return null
  const config = configOverride ?? readWebRemoteConfig()
  if (process.env.PROMA_WEB_REMOTE !== '1' || config.enabled !== true || config.fullUi !== true) return null
  return getWebRemoteIpcBridge() ?? installWebRemoteIpcCapture(ipcMain, config, resolvers)
}
