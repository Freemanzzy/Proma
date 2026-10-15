import * as React from 'react'
import * as pdfjsImport from 'pdfjs-dist/legacy/build/pdf.mjs'
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'
import type { FileAccessOptions } from '@proma/shared'
import { decodeBase64ToBytes, WEB_REMOTE_FILE_MAX_BYTES } from './web-remote-file-utils'

type PdfViewport = { width: number; height: number }
type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void> }
}
type PdfDocument = {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPage>
}
type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string; workerPort: Worker | null }
  getDocument: (options: { data: Uint8Array }) => { promise: Promise<PdfDocument>; destroy?: () => Promise<void> }
}

const pdfjs = pdfjsImport as unknown as PdfJsModule
const pdfWorkerPort = new PdfWorker()
export function WebRemotePdfPreview({ filePath, fileAccess }: {
  filePath: string
  fileAccess: FileAccessOptions
}): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const pdfRef = React.useRef<PdfDocument | null>(null)
  const [zoom, setZoom] = React.useState(1)
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    let loadingTask: ReturnType<PdfJsModule['getDocument']> | null = null
    pdfRef.current = null
    setStatus('loading')
    setError('')
    // Vite serves raw .mjs assets as application/octet-stream in Web Remote. Bundle
    // the worker through Vite so browsers receive a proper JavaScript worker URL/MIME.
    pdfjs.GlobalWorkerOptions.workerPort = pdfWorkerPort

    void (async () => {
      try {
        const base64 = await window.electronAPI.readBinaryBase64(filePath, fileAccess, WEB_REMOTE_FILE_MAX_BYTES)
        if (cancelled) return
        if (typeof base64 !== 'string' || base64.length === 0) throw new Error('PDF 无法读取（文件超过 50 MiB 或不在授权范围内）')
        const bytes = decodeBase64ToBytes(base64)
        loadingTask = pdfjs.getDocument({ data: bytes })
        const document = await loadingTask.promise
        if (cancelled) {
          await loadingTask.destroy?.()
          return
        }
        pdfRef.current = document
        setStatus('ready')
      } catch (cause) {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : 'PDF 加载失败')
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      pdfRef.current = null
      void loadingTask?.destroy?.().catch(() => undefined)
    }
  }, [fileAccess, filePath])

  React.useEffect(() => {
    if (status !== 'ready') return
    let cancelled = false
    const container = containerRef.current
    const document = pdfRef.current
    if (!container || !document) return
    container.replaceChildren()

    void (async () => {
      try {
        const deviceScale = Math.min(window.devicePixelRatio || 1, 2)
        const fitWidth = Math.max(240, container.clientWidth - 32)
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
          const page = await document.getPage(pageNumber)
          if (cancelled) return
          const baseViewport = page.getViewport({ scale: 1 })
          const scale = Math.min(1, fitWidth / baseViewport.width) * zoom
          const viewport = page.getViewport({ scale: scale * deviceScale })
          const canvas = window.document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          canvas.style.width = `${viewport.width / deviceScale}px`
          canvas.style.height = `${viewport.height / deviceScale}px`
          canvas.style.maxWidth = '100%'
          canvas.setAttribute('aria-label', `PDF 第 ${pageNumber} 页`)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('浏览器无法创建 PDF 画布')
          await page.render({ canvasContext: context, viewport }).promise
          if (cancelled) return
          container.appendChild(canvas)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'PDF 页面渲染失败')
          setStatus('error')
        }
      }
    })()

    return () => { cancelled = true }
  }, [status, zoom])

  return (
    <section className="flex h-full min-h-0 flex-col" data-testid="web-remote-pdf-preview">
      <div className="flex shrink-0 items-center justify-center gap-2 border-b border-border/30 px-2 py-1.5 text-xs text-muted-foreground">
        <button type="button" aria-label="缩小 PDF" title="缩小 PDF" disabled={status !== 'ready'} onClick={() => setZoom((value) => Math.max(0.5, value / 1.25))} className="h-7 w-8 rounded border border-border/40 disabled:opacity-40">−</button>
        <span aria-live="polite" className="min-w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="放大 PDF" title="放大 PDF" disabled={status !== 'ready'} onClick={() => setZoom((value) => Math.min(3, value * 1.25))} className="h-7 w-8 rounded border border-border/40 disabled:opacity-40">+</button>
      </div>
      {status === 'loading' && <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground" role="status">正在加载 PDF…</div>}
      {status === 'error' && <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-destructive" role="alert">{error}</div>}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4" />
    </section>
  )
}
