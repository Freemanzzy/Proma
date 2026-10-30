type ClipboardWriter = (text: string) => Promise<void>

interface ClipboardWriters {
  native?: ClipboardWriter
  browser?: ClipboardWriter
  /** 同步的 execCommand 兜底（选中隐藏 textarea 后复制）；成功返回 true。 */
  legacy?: (text: string) => boolean
  /** 运行在 Web Remote（手机浏览器）中时为 true。 */
  webRemote?: boolean
}

function isWebRemoteEnvironment(): boolean {
  if (typeof window === 'undefined') return false
  return (window as Window & { __PROMA_WEB_REMOTE__?: boolean }).__PROMA_WEB_REMOTE__ === true
}

function getNativeClipboardWriter(): ClipboardWriter | undefined {
  if (typeof window === 'undefined') return undefined
  return window.electronAPI?.writeClipboardText
}

function getBrowserClipboardWriter(): ClipboardWriter | undefined {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return undefined
  return (text) => navigator.clipboard.writeText(text)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  const selection = document.getSelection()
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  try {
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
    if (previousRange && selection) {
      selection.removeAllRanges()
      selection.addRange(previousRange)
    }
  }
}

/**
 * 桌面：优先使用 Electron 主进程，确保 Windows 上不受 renderer 剪贴板权限影响。
 *
 * Web Remote（个人版手机端）：主进程写的是 Mac 的剪贴板，对手机无用，而且该 IPC 在手机端被
 * 默认拒绝、shim 会静默返回成功，导致界面显示“已复制”却什么也没写。因此手机端不走主进程，
 * 直接在点击手势内调用浏览器剪贴板；不可用或失败时用 execCommand 兜底，都失败则抛错。
 */
export async function copyTextToClipboard(
  content: string,
  writers: ClipboardWriters = {
    native: getNativeClipboardWriter(),
    browser: getBrowserClipboardWriter(),
    legacy: legacyCopy,
    webRemote: isWebRemoteEnvironment(),
  }
): Promise<void> {
  if (writers.webRemote) {
    if (writers.browser) {
      try {
        // 必须在任何 await 之前调用，保持在用户点击手势内。
        await writers.browser(content)
        return
      } catch (error) {
        console.warn('[Clipboard] 浏览器剪贴板写入失败，尝试 execCommand 兜底:', error)
      }
    }
    if (writers.legacy?.(content)) return
    throw new Error('复制失败：当前浏览器不允许写入剪贴板')
  }

  if (writers.native) {
    try {
      await writers.native(content)
      return
    } catch (error) {
      console.warn('[Clipboard] 主进程复制失败，尝试 renderer 剪贴板:', error)
    }
  }

  if (!writers.browser) {
    throw new Error('当前环境不支持写入剪贴板')
  }
  await writers.browser(content)
}
