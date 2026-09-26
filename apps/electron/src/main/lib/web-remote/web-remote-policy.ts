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
