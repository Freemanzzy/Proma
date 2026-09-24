/**
 * MainArea — 主内容区域
 *
 * 组合 TabBar + TabContent。文件、Markdown 和 Diff 预览统一由右侧工作区承载；
 * MainArea 仅保留对话主区。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  activeTabAtom,
} from '@/atoms/tab-atoms'
import { Panel } from '@/components/app-shell/Panel'
import { WelcomeView } from '@/components/welcome/WelcomeView'
import { useTrackSessionView } from '@/hooks/useTrackSessionView'
import { TabBar } from './TabBar'
import { TabContent } from './TabContent'
import { AutomationFormView } from '@/components/automation/AutomationFormView'
import { PlanningView } from '@/components/planning/PlanningView'
import { AgentSkillsView } from '@/components/agent-skills/AgentSkillsView'
import { VaultView } from '@/components/vault/VaultView'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { registerShortcut } from '@/lib/shortcut-registry'
import {
  currentSessionSidePanelOpenAtom,
} from '@/atoms/agent-atoms'

export function MainArea(): React.ReactElement {
  useTrackSessionView()

  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const automationFormOpen = useAtomValue(automationFormAtom).open
  const activeView = useAtomValue(activeViewAtom)

  // TabBar 立即反馈，较重的中心内容可让出当前交互帧；Agent 历史则保持当前会话避免旧内容占屏。
  const deferredActiveTabId = React.useDeferredValue(activeTabId)
  const contentTabId = activeTab?.type === 'agent' ? activeTabId : deferredActiveTabId
  // Agent 会话从左侧历史列表切换，中心区不再重复展示同一组顶部 Tab。
  const showCenterTabBar = activeTab?.type !== 'agent'
  const [isRightPanelOpen, setRightPanelOpen] = useAtom(currentSessionSidePanelOpenAtom)
  const toggleRightPanel = React.useCallback(() => {
    if (activeTab?.type !== 'agent') return
    setRightPanelOpen(!isRightPanelOpen)
  }, [activeTab?.type, isRightPanelOpen, setRightPanelOpen])

  // 不能依赖 TabBar 注册：Agent 会话已不渲染中心 TabBar，快捷键需要在常驻主内容区监听。
  React.useEffect(() => registerShortcut('toggle-right-panel', toggleRightPanel), [toggleRightPanel])

  React.useEffect(() => {
    if (tabs.length > 0 && !activeTabId) setActiveTabId(tabs[0]!.id)
  }, [tabs, activeTabId, setActiveTabId])


  return (
    <Panel variant="grow" className="bg-content-area">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-1 flex-col min-w-0 h-full">
          {activeView === 'planning' ? (
            automationFormOpen ? <AutomationFormView /> : <PlanningView />
          ) : activeView === 'agent-skills' ? (
            <AgentSkillsView />
          ) : activeView === 'vault' ? (
            <VaultView />
          ) : (
            <>
              {showCenterTabBar && <TabBar />}
              {automationFormOpen && activeView !== 'conversations' ? (
                <AutomationFormView />
              ) : tabs.length === 0 ? (
                <WelcomeView />
              ) : contentTabId ? (
                <div className="flex-1 min-h-0 titlebar-no-drag"><TabContent tabId={contentTabId} /></div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Panel>
  )
}
