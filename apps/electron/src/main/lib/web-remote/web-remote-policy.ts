import { join, resolve } from 'node:path'

/**
 * 手机主屏 PNG 图标目录：安装包与开发实例路径不同，纯函数便于在不依赖 Electron 的情况下测试。
 * - 安装包：图标随 extraResources 落在 resourcesPath/web-remote。
 * - 开发实例：main 进程始终从打包后的 dist/main.cjs 运行（watch:main 产物），
 *   moduleDir 传入该文件的 __dirname 即可推出仓库内 resources/web-remote。
 */
export function resolveWebRemoteIconDir(input: { packaged: boolean; resourcesPath: string; moduleDir: string }): string {
  return input.packaged ? join(input.resourcesPath, 'web-remote') : resolve(input.moduleDir, '../resources/web-remote')
}

export function isDesktopAdminAllowed(input: { personalPackaged: boolean; configDirName: string; packaged: boolean; url?: string }): boolean {
  const url = input.url
  const desktopUrl = !!url && (url.startsWith('file://') || (!input.packaged && (() => {
    try { return new URL(url).origin === 'http://127.0.0.1:5173' } catch { return false }
  })()))
  return desktopUrl && (input.personalPackaged || input.configDirName === '.proma-dev')
}

export function isWebRemoteActivationAllowed(input: {
  enabled: boolean
  personalBuild: boolean
  packaged: boolean
  configDirName: string
  allowProd: boolean
  envEnabled: boolean
}): boolean {
  if (!input.enabled) return false
  if (input.packaged) return input.personalBuild
  return input.configDirName === '.proma-dev' || input.allowProd
    ? input.envEnabled
    : false
}
