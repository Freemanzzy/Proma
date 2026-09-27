/**
 * RightSidePanel — 右侧边栏容器
 *
 * 在 Agent 模式下显示文件面板，样式与 LeftSidebar 一致。
 * 从全局 atom 读取当前会话 ID 和路径。
 * 管理「文件 / 代码改动」视图；文件中包含会话文件与项目文件。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { appModeAtom } from '@/atoms/app-mode'
import {
  currentAgentSessionIdAtom,
  currentSessionSidePanelOpenAtom,
  agentSessionPathMapAtom,
  agentDiffPanelTabAtom,
  agentTerminalTabsAtom,
  getTerminalSidePanelTab,
  getPreviewSidePanelTab,
} from '@/atoms/agent-atoms'
import type { AgentSidePanelTab } from '@/atoms/agent-atoms'
import { SidePanel } from '@/components/agent/SidePanel'
import { getPreviewFileId, previewFileMapAtom } from '@/atoms/preview-atoms'

export function RightSidePanel({ width }: { width?: number }): React.ReactElement | null {
  const appMode = useAtomValue(appModeAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const diffPanelTabMap = useAtomValue(agentDiffPanelTabAtom)
  const setDiffPanelTabMap = useSetAtom(agentDiffPanelTabAtom)
  const setTerminalTabsMap = useSetAtom(agentTerminalTabsAtom)
  const setSidePanelOpen = useSetAtom(currentSessionSidePanelOpenAtom)
  const previewFileMap = useAtomValue(previewFileMapAtom)
  const currentPreviewFile = currentSessionId ? previewFileMap.get(currentSessionId) ?? null : null

  const setActiveTab = React.useCallback((tab: AgentSidePanelTab) => {
    if (!currentSessionId) return
    setDiffPanelTabMap((prev) => {
      const map = new Map(prev)
      map.set(currentSessionId, tab)
      return map
    })
  }, [currentSessionId, setDiffPanelTabMap])

  // Agent 可见终端（TerminalExecute/TerminalOpen）打开或关闭时同步到右侧工作区。
  React.useEffect(() => {
    const unsubscribeOpen = window.electronAPI.onAgentTerminalOpen((event) => {
      setTerminalTabsMap((previous) => {
        const current = previous.get(event.sessionId) ?? []
        if (current.some((terminal) => terminal.terminalId === event.terminalId)) return previous
        const next = new Map(previous)
        next.set(event.sessionId, [...current, { terminalId: event.terminalId, title: event.title, cwd: event.cwd }])
        return next
      })
      if (event.sessionId !== currentSessionId) return
      setSidePanelOpen(true)
      setDiffPanelTabMap((previous) => {
        const next = new Map(previous)
        next.set(event.sessionId, getTerminalSidePanelTab(event.terminalId))
        return next
      })
    })
    const unsubscribeClose = window.electronAPI.onAgentTerminalClose((event) => {
      setTerminalTabsMap((previous) => {
        const current = previous.get(event.sessionId) ?? []
        const remaining = current.filter((terminal) => terminal.terminalId !== event.terminalId)
        if (remaining.length === current.length) return previous
        const next = new Map(previous)
        if (remaining.length > 0) next.set(event.sessionId, remaining)
        else next.delete(event.sessionId)
        return next
      })
      if (event.sessionId !== currentSessionId) return
      setDiffPanelTabMap((previous) => {
        if (previous.get(event.sessionId) !== getTerminalSidePanelTab(event.terminalId)) return previous
        const next = new Map(previous)
        next.set(event.sessionId, 'files')
        return next
      })
    })
    return () => {
      unsubscribeOpen()
      unsubscribeClose()
    }
  }, [currentSessionId, setDiffPanelTabMap, setSidePanelOpen, setTerminalTabsMap])

  if (appMode !== 'agent' || !currentSessionId) {
    return null
  }

  const sessionPath = sessionPathMap.get(currentSessionId) ?? null
  const storedTab = diffPanelTabMap.get(currentSessionId) ?? 'files'
  // 旧版本可能留下“浏览器”工作区值，统一回退到文件面板。
  const activeTab: AgentSidePanelTab = (storedTab as string) === 'browser'
    ? 'files'
    : storedTab === 'preview'
      ? currentPreviewFile ? getPreviewSidePanelTab(getPreviewFileId(currentPreviewFile)) : 'files'
      : storedTab

  return (
    <SidePanel
      sessionId={currentSessionId}
      sessionPath={sessionPath}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      width={width}
    />
  )
}
