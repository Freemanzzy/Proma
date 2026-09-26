import * as React from 'react'
import { Copy, Plus, RefreshCw, Trash2 } from 'lucide-react'

type AdminState = {
  config: { enabled?: boolean; fullUi?: boolean; allowedOrigin?: string; workspaceScope?: 'all' | 'allowlist'; allowedWorkspaceIds?: string[]; trustedTailscaleNodes?: string[] }
  running: boolean
  connectedDevices: number
  devices: Array<{ id: string; label: string; createdAt: number; lastUsedAt?: number }>
  pushSubscriptions: Array<{ deviceId: string; label: string; updatedAt: number }>
  pairing: { code: string; expiresAt: number } | null
  candidates: Array<{ name: string; os: string; online: boolean; login: string }>
  workspaces: Array<{ id: string; name: string; slug: string }>
}

export function WebRemoteMobileSettings(): React.ReactElement {
  const [data, setData] = React.useState<AdminState | null>(null)
  const [selected, setSelected] = React.useState<string[]>([])
  const [pairCode, setPairCode] = React.useState<{ code: string; expiresAt: number } | null>(null)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [remaining, setRemaining] = React.useState(0)
  const isWebRemote = (window as Window & { __PROMA_WEB_REMOTE__?: boolean }).__PROMA_WEB_REMOTE__ === true
  const refresh = React.useCallback(async () => {
    if (isWebRemote) return
    try { const next = await window.electronAPI.getWebRemoteAdminStatus() as AdminState; setData(next); setSelected(next.config.allowedWorkspaceIds ?? []) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [isWebRemote])
  React.useEffect(() => { if (isWebRemote) return; void refresh(); const timer = window.setInterval(() => { void refresh() }, 2000); return () => window.clearInterval(timer) }, [isWebRemote, refresh])
  React.useEffect(() => { const timer = window.setInterval(() => setRemaining(pairCode ? Math.max(0, Math.ceil((pairCode.expiresAt - Date.now()) / 1000)) : 0), 500); return () => window.clearInterval(timer) }, [pairCode])

  const save = async (patch: Record<string, unknown>, restart = false) => {
    setError(''); setNotice('')
    try { await window.electronAPI.saveWebRemoteAdminConfig(patch); await refresh(); setNotice(restart ? '已保存；启用状态或完整界面需重启开发实例后生效。' : '已保存；受信设备和工作区范围会在数秒内同步到现有连接。') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const addTrusted = async (name: string) => { const current = data?.config.trustedTailscaleNodes ?? []; if (!current.includes(name)) await save({ trustedTailscaleNodes: [...current, name] }) }
  const revoke = async (id: string) => { if (!window.confirm('确定撤销此配对设备？其连接将立即断开。')) return; try { await window.electronAPI.revokeWebRemoteDevice(id); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
  const createPair = async () => { try { const value = await window.electronAPI.createWebRemotePairingCode(); setPairCode(value) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
  const testPush = async (deviceId: string) => { setError(''); setNotice(''); try { const result = await window.electronAPI.sendWebRemotePushTest(deviceId); setNotice(result.status ? `推送端点响应 ${result.status}。` : `发送失败：${result.error || '推送端点无响应'}`); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
  const deletePush = async (deviceId: string) => { try { await window.electronAPI.deleteWebRemotePushSubscription(deviceId); await refresh(); setNotice('已删除该设备的通知订阅。') } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setNotice('已复制到剪贴板。') } catch { setError('复制失败，请手动选择文本。') } }

  if (isWebRemote) return <div hidden aria-hidden="true" />
  if (!data) return <section className="space-y-3"><h2 className="text-lg font-semibold">手机访问</h2><p className="text-sm text-muted-foreground">{error || '正在读取手机访问设置…'}</p></section>
  const config = data.config
  return <section className="max-w-3xl space-y-6" aria-label="手机访问">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">手机访问</h2><p className="text-sm text-muted-foreground">管理开发实例的 Web Remote 手机连接。</p></div><button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void refresh()} aria-label="刷新手机访问状态"><RefreshCw size={14} /></button></div>
    <div className="rounded-lg border p-4 space-y-2 text-sm"><div>服务状态：<strong>{data.running ? '运行中' : '未运行'}</strong>　当前连接设备：<strong>{data.connectedDevices}</strong></div><div className="flex flex-wrap items-center gap-2">访问地址：<code className="select-all break-all">{config.allowedOrigin || '未配置'}</code>{config.allowedOrigin && <button className="rounded border px-2 py-1" onClick={() => void copy(config.allowedOrigin!)}><Copy size={13}/><span className="sr-only">复制访问地址</span></button>}</div></div>
    <div className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">服务选项</h3><label className="flex items-center gap-3"><input type="checkbox" checked={config.enabled === true} onChange={(e) => void save({ enabled: e.target.checked }, true)} />启用远程服务</label><label className="flex items-center gap-3"><input type="checkbox" checked={config.fullUi === true} onChange={(e) => void save({ fullUi: e.target.checked }, true)} />启用完整桌面界面（关闭时使用轻量页面）</label><p className="text-xs text-muted-foreground">以上开关需重启开发实例生效。手机端设置入口保持隐藏。</p></div>
    <div className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">受信 Tailnet 设备</h3><p className="text-xs text-muted-foreground">候选来自只读 tailscale status --json，并仅列同账号设备。</p><ul className="space-y-2">{(config.trustedTailscaleNodes ?? []).map((name) => <li key={name} className="flex items-center justify-between gap-2 rounded bg-muted/40 px-3 py-2"><span>{name}</span><button className="rounded border px-2 py-1" onClick={() => void save({ trustedTailscaleNodes: (config.trustedTailscaleNodes ?? []).filter((item) => item !== name) })} aria-label={`删除受信设备 ${name}`}><Trash2 size={14}/></button></li>)}</ul><div className="flex flex-wrap gap-2">{data.candidates.filter((item) => item.online && !(config.trustedTailscaleNodes ?? []).includes(item.name)).map((item) => <button key={item.name} className="rounded border px-3 py-2 text-left text-sm" onClick={() => void addTrusted(item.name)}><Plus size={13} className="mr-1 inline"/>{item.name} · {item.os} · 在线</button>)}{data.candidates.length === 0 && <span className="text-sm text-muted-foreground">暂未发现同账号在线设备。</span>}</div></div>
    <div className="space-y-3 rounded-lg border p-4"><div className="flex items-center justify-between"><h3 className="font-medium">已配对设备</h3><button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => void createPair()}>生成配对码</button></div>{pairCode && remaining > 0 && <div className="rounded-md bg-muted p-3 text-center"><strong className="text-2xl tracking-[.3em]">{pairCode.code}</strong><div className="text-xs text-muted-foreground">剩余 {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</div></div>}<ul className="space-y-2">{data.devices.map((device) => <li key={device.id} className="flex items-center justify-between gap-2 rounded bg-muted/40 px-3 py-2"><span className="min-w-0 truncate">{device.label} <small className="text-muted-foreground">· {device.lastUsedAt ? `最近连接 ${new Date(device.lastUsedAt).toLocaleString()}` : '尚未连接'}</small></span><button className="rounded border px-2 py-1" onClick={() => void revoke(device.id)}>撤销</button></li>)}</ul>{data.devices.length === 0 && <p className="text-sm text-muted-foreground">暂无已配对设备。</p>}</div>
    <div className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">通知订阅</h3><p className="text-xs text-muted-foreground">手机需在 /app/ 中点击“开启通知”；iPhone 需从主屏幕以独立模式打开。</p><ul className="space-y-2">{data.pushSubscriptions.map((item) => <li key={item.deviceId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted/40 px-3 py-2"><span>{item.label} · {item.deviceId.startsWith('tailnet:') ? 'Tailnet 设备' : '已配对设备'} · {new Date(item.updatedAt).toLocaleString()}</span><span className="flex gap-2"><button className="rounded border px-2 py-1" onClick={() => void testPush(item.deviceId)}>发送测试通知</button><button className="rounded border px-2 py-1" onClick={() => void deletePush(item.deviceId)}>删除订阅</button></span></li>)}</ul>{data.pushSubscriptions.length === 0 && <p className="text-sm text-muted-foreground">暂无通知订阅设备。</p>}</div>
    <div className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">工作区范围</h3><label className="flex items-center gap-3"><input type="radio" checked={config.workspaceScope === 'all'} onChange={() => void save({ workspaceScope: 'all' })}/>全部工作区</label><label className="flex items-center gap-3"><input type="radio" checked={config.workspaceScope !== 'all'} onChange={() => void save({ workspaceScope: 'allowlist', allowedWorkspaceIds: selected })}/>指定工作区</label>{config.workspaceScope !== 'all' && <div className="max-h-48 space-y-2 overflow-auto pl-6">{data.workspaces.map((workspace) => <label key={workspace.id} className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(workspace.id)} onChange={(e) => { const next = e.target.checked ? [...selected, workspace.id] : selected.filter((id) => id !== workspace.id); setSelected(next); void save({ workspaceScope: 'allowlist', allowedWorkspaceIds: next }) }}/>{workspace.name}</label>)}</div>}</div>
    {(notice || error) && <p role="status" className={`text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{error || notice}</p>}
  </section>
}
