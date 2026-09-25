import * as SharedTypes from '@proma/shared'
import * as ElectronTypes from '../../../../types'
import { UPDATER_IPC_CHANNELS } from '../../updater/updater-types'
import { WEB_REMOTE_FULL_UI_DENIED_CHANNELS } from './denied-channels'

export type WebRemoteChannelLevel = 'read' | 'session' | 'workspace' | 'confirm' | 'denied'
export type WebRemoteScope = 'none' | 'session' | 'workspace'

export interface WebRemoteChannelPolicyEntry {
  level: WebRemoteChannelLevel
  scope: WebRemoteScope
  /** 人工复核时用于说明为何可以暴露给远程 renderer。 */
  rationale: string
}

function channelValues(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.values(value).filter((item): item is string => typeof item === 'string')
}

/**
 * Generated-catalog equivalent: every exported IPC constant is included before
 * the classification rules below are applied. This makes additions visible to
 * the startup coverage check instead of silently falling through to allow.
 */
const DECLARED_CHANNELS = new Set<string>([
  ...Object.entries(SharedTypes).filter(([name]) => name.endsWith('IPC_CHANNELS')).flatMap(([, value]) => channelValues(value)),
  ...Object.entries(ElectronTypes).filter(([name]) => name.endsWith('IPC_CHANNELS')).flatMap(([, value]) => channelValues(value)),
  ...channelValues(UPDATER_IPC_CHANNELS),
])

const CONFIRM_CHANNELS = new Set<string>([
  'agent:delete-session',
  'agent:delete-workspace',
  'agent:move-session-to-workspace',
  'agent:rewind-session',
  'chat:delete-conversation',
  'chat:delete-message',
  'chat:truncate-messages-from',
  'automation:run-now',
  'automation:delete',
  'planning:delete-todo',
  'planning:delete-calendar-event',
  'planning:delete-group',
  'planning:delete-tag',
  'planning:delete-reminder',
  'planning:complete-todo',
])

const READ_CHANNELS = new Set<string>([
  'settings:get',
  'agent:list-sessions', 'agent:list-active-sessions', 'agent:list-archived-sessions', 'agent:count-archived-sessions',
  'agent:active-sessions-snapshot', 'agent:get-queued-messages', 'agent:get-sdk-messages', 'agent:search-messages',
  'agent:search-session-references', 'agent:list-workspaces', 'agent:get-capabilities', 'agent:get-mcp-config',
  'agent:get-skills', 'agent:get-other-workspace-skills', 'agent:get-default-skill-slugs', 'agent:read-skill-content',
  'agent:list-skill-files', 'agent:read-skill-file', 'agent:get-runtime-status',
  'chat:list-conversations', 'chat:get-messages', 'chat:get-recent-messages', 'chat:get-messages-around',
  'chat:search-messages', 'chat:search-session-messages',
  'automation:list', 'automation:get', 'planning:list-todos', 'planning:list-calendar-events', 'planning:list-groups',
  'planning:list-tags', 'planning:list-active-reminders', 'planning:get-todo', 'planning:get-calendar-event',
  'planning:get-group', 'planning:get-tag', 'planning:get-reminder',
  'ipc:get-runtime-status', 'runtime:get-status',
])

const READ_SESSION_CHANNELS = new Set<string>([
  'agent:get-sdk-messages', 'agent:get-queued-messages', 'chat:get-messages', 'chat:get-recent-messages',
  'chat:get-messages-around', 'chat:search-session-messages',
])
const READ_WORKSPACE_CHANNELS = new Set<string>([
  'agent:get-capabilities', 'agent:get-mcp-config', 'agent:get-skills', 'agent:get-other-workspace-skills',
  'agent:read-skill-content', 'agent:list-skill-files', 'agent:read-skill-file',
])

const DENIED_PREFIXES = [
  'terminal:', 'window:', 'dock:', 'tray:', 'quick-task:', 'voice-dictation:', 'agent-island:', 'windows-agent-island:',
  'updater:', 'installer:', 'proxy:', 'shell:', 'scratch-pad:', 'app:', 'storage:',
]

const DENIED_EXACT = new Set<string>([
  'settings:update', 'settings:set', 'settings:save', 'settings:write',
  'channel:create', 'channel:update', 'channel:delete', 'channel:decrypt-key', 'channel:test', 'channel:test-direct',
  'channel:fetch-models', 'channel:codex-oauth-login', 'channel:codex-oauth-cancel',
  'channel:github-copilot-oauth-login', 'channel:github-copilot-oauth-cancel', 'channel:xai-oauth-login', 'channel:xai-oauth-cancel',
  'agent:save-mcp-config', 'agent:delete-mcp', 'agent:refresh-mcp-connections', 'agent:set-mcp-enabled-and-validate',
  'agent:install-mcp-and-validate', 'agent:start-mcp-oauth', 'agent:save-mcp-oauth-client-secret', 'agent:save-mcp-api-key',
  'agent:delete-mcp-credential', 'agent:set-cli-integration-enabled', 'agent:test-mcp-server',
  'agent:open-skill-folder', 'agent:write-skill-content', 'agent:write-skill-file', 'agent:create-skill-entry', 'agent:delete-skill-entry',
  'agent:open-browser', 'agent:list-browser-tabs', 'agent:create-browser-tab', 'agent:select-browser-tab', 'agent:get-browser-state',
  'agent:set-browser-layout', 'agent:minimize-browser', 'agent:navigate-browser', 'agent:go-back-browser', 'agent:go-forward-browser',
  'agent:reload-browser', 'agent:close-browser', 'agent:browser-state-changed', 'agent:browser-tab-focused',
])

function inferScope(channel: string): WebRemoteScope {
  if (/^(agent|chat):/.test(channel)) {
    if (/(workspace|skill|mcp|file|capabilit|git|vault)/i.test(channel)) return 'workspace'
    if (/(session|conversation|message|title|model|worktree|send|stop|permission|pin|star|archive|fork|rewind|search)/i.test(channel)) return 'session'
  }
  if (/^(git|vault):/.test(channel)) return 'workspace'
  if (/^planning:/.test(channel)) return 'none'
  return 'none'
}

function classify(channel: string): WebRemoteChannelPolicyEntry {
  const scope = inferScope(channel)
  if (WEB_REMOTE_FULL_UI_DENIED_CHANNELS.has(channel) || DENIED_EXACT.has(channel) || DENIED_PREFIXES.some((prefix) => channel.startsWith(prefix))) {
    return { level: 'denied', scope: 'none', rationale: '原生窗口、终端、凭据、设置写入或外部副作用，不向手机 renderer 暴露。' }
  }
  if (CONFIRM_CHANNELS.has(channel)) {
    return { level: 'confirm', scope, rationale: '会删除、迁移、截断或立即执行外部任务，必须使用一次性手机确认标记。' }
  }
  if (READ_CHANNELS.has(channel) || /:(list|count|get|search|snapshot|status|history|messages|capabilities|skills|files|workspaces?)$/i.test(channel)
    || /(?:changed|stream-[a-z-]+|complete|chunk|error|progress|state|theme-settings-changed)$/i.test(channel)) {
    const readScope = READ_SESSION_CHANNELS.has(channel) ? 'session' : READ_WORKSPACE_CHANNELS.has(channel) ? 'workspace' : 'none'
    return { level: 'read', scope: readScope, rationale: '只读结果或状态事件；列表和设置结果在返回前按允许范围/敏感字段过滤。' }
  }
  if (/^(agent|chat|git):/.test(channel) && scope !== 'none') {
    return { level: scope, scope, rationale: '参数必须能解析出 sessionId 或 workspaceId/slug，并校验其在远程允许范围内。' }
  }
  if (/^(agent|chat|git):/.test(channel) && /^(send|stop|create|update|toggle|set|save|attach|import|start|generate|migrate|move|fork)/i.test(channel.split(':').slice(1).join(':'))) {
    return { level: scope === 'none' ? 'denied' : scope, scope, rationale: '状态变更只允许在已授权会话/工作区内执行。' }
  }
  return { level: 'denied', scope: 'none', rationale: '已登记但尚未完成人工复核，按最小权限默认拒绝。' }
}

export const WEB_REMOTE_CHANNEL_POLICY: Readonly<Record<string, WebRemoteChannelPolicyEntry>> = Object.freeze(
  Object.fromEntries([...DECLARED_CHANNELS].sort().map((channel) => [channel, classify(channel)])),
)

export function getWebRemoteChannelPolicy(channel: string): WebRemoteChannelPolicyEntry | undefined {
  return WEB_REMOTE_CHANNEL_POLICY[channel]
}

export function getDeclaredWebRemoteChannels(): string[] {
  return [...DECLARED_CHANNELS].sort()
}

export function policySummary(): Record<WebRemoteChannelLevel, number> {
  const summary: Record<WebRemoteChannelLevel, number> = { read: 0, session: 0, workspace: 0, confirm: 0, denied: 0 }
  for (const entry of Object.values(WEB_REMOTE_CHANNEL_POLICY)) summary[entry.level]++
  return summary
}
