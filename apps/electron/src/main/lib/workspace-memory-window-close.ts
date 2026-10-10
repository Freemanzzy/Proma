export function shouldInterceptWorkspaceMemoryClose(options: {
  isQuitting: boolean
  approved: boolean
  rendererReady: boolean
  webContentsDestroyed: boolean
}): boolean {
  return !options.isQuitting && !options.approved && options.rendererReady && !options.webContentsDestroyed
}
