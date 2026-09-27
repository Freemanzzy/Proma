import * as React from 'react'
import { ExternalLink, Home, Camera, Play, Square, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SimulatorDevice, SimulatorPreviewStatus } from '@proma/shared'

type Props = { sessionId: string; workspaceSlug: string }

export function SimulatorPanel({ sessionId, workspaceSlug }: Props): React.ReactElement {
  const [devices, setDevices] = React.useState<SimulatorDevice[]>([])
  const [udid, setUdid] = React.useState('')
  const [status, setStatus] = React.useState<SimulatorPreviewStatus>({ running: false })
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const api = window.electronAPI
  const isAvailable = /Mac/.test(navigator.platform) && !(window as Window & { __PROMA_WEB_REMOTE__?: boolean }).__PROMA_WEB_REMOTE__

  const refresh = React.useCallback(async () => {
    try {
      const [list, preview] = await Promise.all([api.listSimulators(), api.getSimulatorPreviewStatus()])
      setDevices(list); setStatus(preview)
      setUdid((current) => preview.udid || current || list.find((device) => device.state === 'Booted')?.udid || list[0]?.udid || '')
      setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }, [api])

  React.useEffect(() => { if (isAvailable) void refresh() }, [isAvailable, refresh])
  React.useEffect(() => {
    if (!status.running) return
    const timer = window.setInterval(() => { void api.getSimulatorPreviewStatus().then(setStatus).catch(() => undefined) }, 2000)
    return () => window.clearInterval(timer)
  }, [api, status.running])
  if (!isAvailable) return <div className="p-4 text-sm text-muted-foreground">iOS 模拟器仅在 macOS 桌面版可用。</div>

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setMessage('')
    try { const result = await action(); if (result && typeof result === 'object' && 'running' in result) setStatus(result as SimulatorPreviewStatus); else await refresh() }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  return <section className="flex h-full min-h-0 flex-col" data-web-remote-simulator-panel>
    <header className="flex min-h-10 flex-wrap items-center gap-1 border-b px-2 py-1">
      <select aria-label="选择 iOS 模拟器" disabled={status.running || busy} className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs" value={udid} onChange={(event) => setUdid(event.target.value)}>
        {devices.length ? devices.map((device) => <option key={device.udid} value={device.udid}>{device.name} · {device.state === 'Booted' ? '运行中' : '已关机'}</option>) : <option value="">未发现模拟器</option>}
      </select>
      <Button size="sm" variant="outline" disabled={busy || !udid} onClick={() => void run(() => status.running ? api.stopSimulatorPreview(status.udid ?? udid) : api.startSimulatorPreview(udid))} title={status.running ? '停止预览' : '启动预览'}>{status.running ? <Square className="size-3.5" /> : <Play className="size-3.5" />}</Button>
      <Button size="sm" variant="outline" disabled={busy || !udid} onClick={() => void run(() => api.pressSimulatorHome(udid))} title="Home"><Home className="size-3.5" /></Button>
      <Button size="sm" variant="outline" disabled={busy || !udid} onClick={() => void run(async () => { const path = await api.captureSimulatorScreenshot(udid, sessionId, workspaceSlug); setMessage(`截屏已保存：${path}`) })} title="截屏"><Camera className="size-3.5" /></Button>
      <Button size="sm" variant="outline" disabled={!status.url} onClick={() => status.url && void api.openExternal(status.url)} title="在浏览器中打开"><ExternalLink className="size-3.5" /></Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()} title="刷新设备列表"><RefreshCw className="size-3.5" /></Button>
    </header>
    {(message || busy) && <div className="border-b px-3 py-2 text-xs text-muted-foreground" role="status">{message || '正在启动模拟器预览；首次启动会下载 serve-sim，请稍候…'}</div>}
    {status.error && <div className="border-b px-3 py-2 text-xs text-destructive" role="alert">{status.error}</div>}
    {status.url ? <iframe title="iOS 模拟器预览" src={status.url} sandbox="allow-scripts allow-same-origin" className="min-h-0 flex-1 border-0 bg-black" /> : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-5 text-center text-sm text-muted-foreground"><p>选择一台 iOS 模拟器并启动预览。首次启动可能需要下载 serve-sim。</p><Button disabled={busy || !udid} onClick={() => void run(() => api.startSimulatorPreview(udid))}><Play className="mr-2 size-4" />启动模拟器</Button>{!devices.length && <Button variant="ghost" onClick={() => void refresh()}>重新检查</Button>}</div>}
  </section>
}
