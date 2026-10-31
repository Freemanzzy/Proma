import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { inputToolbarButtonClass } from '@/components/ai-elements/input-toolbar-styles'
import { preventHoverPopoverFocusRestore } from '@/components/ai-elements/input-toolbar-popover-focus'
import { agentSessionViewStreamStateAtomFamily } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'
import type { PersonalSessionUsageSummary, PersonalSessionUsageTotals } from '@proma/shared'

const closeDelay = 150
const blank: PersonalSessionUsageTotals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, largeCacheRebuilds: 0, relativeCostIndex: 0, cacheHitRate: 0 }
export function formatUsageNumber(value: number): string { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : `${value}` }
export function shouldHideSessionUsageBadge(isWebRemote: boolean, touchPoints: number, coarsePointer: boolean, width: number): boolean { return isWebRemote && (touchPoints > 0 || coarsePointer || width < 768) }
function hiddenOnTouch(): boolean { return shouldHideSessionUsageBadge(Boolean((window as Window & { __PROMA_WEB_REMOTE__?: boolean }).__PROMA_WEB_REMOTE__), navigator.maxTouchPoints, window.matchMedia?.('(pointer: coarse)').matches ?? false, window.innerWidth) }
export function badgePresentation(summary: PersonalSessionUsageSummary): { label: string; warning: boolean } {
  return { label: `缓存 ${Math.round(summary.session.cacheHitRate * 100)}% · ${formatUsageNumber(summary.session.relativeCostIndex)}`, warning: Boolean(summary.lastRequest?.largeCacheRebuild) }
}
export function SessionUsageBadge({ sessionId }: { sessionId?: string }): React.ReactElement | null {
  const stream = useAtomValue(agentSessionViewStreamStateAtomFamily(sessionId || ''))
  const usageSignature = `${stream.inputTokens ?? ''}:${stream.outputTokens ?? ''}:${stream.cacheReadTokens ?? ''}:${stream.cacheCreationTokens ?? ''}`
  const [summary, setSummary] = React.useState<PersonalSessionUsageSummary | null>(null)
  const [open, setOpen] = React.useState(false)
  const popoverReceivedFocus = React.useRef(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>()
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>()
  const [hidden, setHidden] = React.useState(hiddenOnTouch)
  React.useEffect(() => { const update = () => setHidden(hiddenOnTouch()); window.addEventListener('resize', update); return () => window.removeEventListener('resize', update) }, [])
  React.useEffect(() => {
    let active = true
    setSummary(null)
    if (!sessionId) return
    const refresh = () => window.electronAPI.getAgentSessionPersonalUsage(sessionId).then(value => { if (active) setSummary(value) }).catch(() => { if (active) setSummary(null) })
    void refresh()
    clearTimeout(timer.current); timer.current = setTimeout(() => void refresh(), 250)
    return () => { active = false; clearTimeout(timer.current); clearTimeout(closeTimer.current) }
  }, [sessionId, usageSignature])
  if (hidden || !summary || summary.session.requests === 0) return null
  const s = summary.session
  const hit = Math.round(s.cacheHitRate * 100)
  const { warning, label } = badgePresentation(summary)
  const rows: [string, string][] = [['请求数', `${s.requests}`], ['Input', s.input.toLocaleString()], ['Output', s.output.toLocaleString()], ['Cache Read', s.cacheRead.toLocaleString()], ['Cache Write', s.cacheWrite.toLocaleString()], ['命中率', `${hit}%`], ['大额重建', `${s.largeCacheRebuilds}`], ['相对成本指数', formatUsageNumber(s.relativeCostIndex)]]
  const enter = () => { clearTimeout(closeTimer.current); setOpen(true) }
  const leave = () => { closeTimer.current = setTimeout(() => setOpen(false), closeDelay) }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" data-session-usage-badge="true" className={cn(inputToolbarButtonClass, 'h-8 w-auto px-2 text-xs tabular-nums', warning && 'text-amber-600 dark:text-amber-400')} onMouseEnter={enter} onMouseLeave={leave} aria-label={`本会话缓存命中率 ${hit}%，相对成本指数 ${formatUsageNumber(s.relativeCostIndex)}`}>
      {label}
    </Button></PopoverTrigger>
    <PopoverContent side="top" align="center" className="w-72 space-y-2 p-3 text-xs" onMouseEnter={enter} onMouseLeave={leave} onFocusCapture={() => { popoverReceivedFocus.current = true }} onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => { preventHoverPopoverFocusRestore(event, popoverReceivedFocus.current); popoverReceivedFocus.current = false }}>
      <div className="font-medium">本会话累计</div>{rows.map(([label, value]) => <div key={label} className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{value}</span></div>)}
      {summary.lastRequest && <div className="border-t pt-2">最近一次请求：Cache Write {summary.lastRequest.cacheWrite.toLocaleString()} · 命中率 {Math.round(summary.lastRequest.cacheHitRate * 100)}%</div>}
      {summary.children && <div className="space-y-1 border-t pt-2"><div className="font-medium">含子 Agent 合计</div>{([['请求数', `${summary.children.requests}`], ['Input', summary.children.input.toLocaleString()], ['Output', summary.children.output.toLocaleString()], ['Cache Read', summary.children.cacheRead.toLocaleString()], ['Cache Write', summary.children.cacheWrite.toLocaleString()], ['命中率', `${Math.round(summary.children.cacheHitRate * 100)}%`], ['大额重建', `${summary.children.largeCacheRebuilds}`], ['相对成本指数', formatUsageNumber(summary.children.relativeCostIndex)]] as [string, string][]).map(([label, value]) => <div key={label} className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{value}</span></div>)}</div>}
      <p className="border-t pt-2 text-muted-foreground">相对成本指数按 Anthropic 价格比例折算，仅用于比较，不是账单；订阅额度见压缩按钮浮层。</p>
    </PopoverContent>
  </Popover>
}
