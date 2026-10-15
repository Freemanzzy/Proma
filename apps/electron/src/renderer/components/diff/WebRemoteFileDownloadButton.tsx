import * as React from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { FileAccessOptions } from '@proma/shared'
import { decodeBase64ToBytes, getWebRemoteFileMimeType, WEB_REMOTE_FILE_MAX_BYTES } from './web-remote-file-utils'

function emitDownloadEvidence(detail: { mode: 'share' | 'blob-anchor' | 'blob-open'; fileName: string; blobUrlCreated: boolean; downloadAttribute: boolean }): void {
  window.dispatchEvent(new CustomEvent('proma-web-remote-file-download', { detail }))
}

export function WebRemoteFileDownloadButton({ filePath, fileAccess, disabled = false }: {
  filePath: string
  fileAccess: FileAccessOptions
  disabled?: boolean
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false)
  const fileName = filePath.split(/[\\/]/).pop() || 'download'

  const handleDownload = React.useCallback(async () => {
    if (busy || disabled) return
    setBusy(true)
    try {
      const base64 = await window.electronAPI.readBinaryBase64(filePath, fileAccess, WEB_REMOTE_FILE_MAX_BYTES)
      if (typeof base64 !== 'string' || base64.length === 0) {
        toast.warning('文件无法读取：可能超过 50 MiB，或不在当前会话的授权范围内')
        return
      }
      const bytes = decodeBase64ToBytes(base64)
      const arrayBuffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(arrayBuffer).set(bytes)
      const blob = new Blob([arrayBuffer], { type: getWebRemoteFileMimeType(fileName) })
      const file = new File([blob], fileName, { type: blob.type })
      const anchor = window.document.createElement('a')
      const supportsDownload = 'download' in anchor
      const shareNavigator = navigator as unknown as {
        share?: (data: ShareData) => Promise<void>
        canShare?: (data: ShareData) => boolean
      }
      const canShareFile = Boolean(
        !supportsDownload
        && typeof shareNavigator.share === 'function'
        && shareNavigator.canShare?.({ files: [file] }),
      )

      if (canShareFile && shareNavigator.share) {
        emitDownloadEvidence({ mode: 'share', fileName, blobUrlCreated: false, downloadAttribute: false })
        await shareNavigator.share({ files: [file], title: fileName })
        return
      }

      const objectUrl = URL.createObjectURL(blob)
      anchor.href = objectUrl
      anchor.download = fileName
      anchor.rel = 'noopener'
      anchor.style.position = 'fixed'
      anchor.style.left = '-9999px'
      window.document.body.appendChild(anchor)
      try {
        anchor.click()
        emitDownloadEvidence({
          mode: supportsDownload ? 'blob-anchor' : 'blob-open',
          fileName,
          blobUrlCreated: objectUrl.startsWith('blob:'),
          downloadAttribute: anchor.download === fileName,
        })
      } finally {
        anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
      }
      if (!supportsDownload) toast.message('已打开文件；如未自动保存，请使用浏览器分享菜单保存到文件')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('[WebRemoteFileDownloadButton] 文件下载/分享失败:', error)
      toast.error('下载或分享失败，请检查文件授权后重试')
    } finally {
      setBusy(false)
    }
  }, [busy, disabled, fileAccess, fileName, filePath])

  return (
    <button
      type="button"
      data-testid="web-remote-file-download"
      aria-label={`下载 ${fileName}`}
      title={`下载 ${fileName}（最大 50 MiB）`}
      disabled={busy || disabled}
      onClick={() => void handleDownload()}
      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      <span>{busy ? '准备中…' : '下载'}</span>
    </button>
  )
}
