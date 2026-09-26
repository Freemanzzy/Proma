import { CHANNEL_IPC_CHANNELS, CHAT_IPC_CHANNELS, TERMINAL_IPC_CHANNELS, AGENT_ISLAND_IPC_CHANNELS } from '@proma/shared'
import { DOCK_BADGE_IPC_CHANNELS, QUICK_TASK_IPC_CHANNELS, WINDOWS_AGENT_ISLAND_IPC_CHANNELS } from '../../../../types'

/** Validation-spike deny list. Keep channel names centralized for review. */
export const WEB_REMOTE_FULL_UI_DENIED_CHANNELS = new Set<string>([
  CHANNEL_IPC_CHANNELS.DECRYPT_KEY,
  ...Object.values(TERMINAL_IPC_CHANNELS),
  ...Object.values(AGENT_ISLAND_IPC_CHANNELS),
  ...Object.values(DOCK_BADGE_IPC_CHANNELS),
  ...Object.values(QUICK_TASK_IPC_CHANNELS),
  ...Object.values(WINDOWS_AGENT_ISLAND_IPC_CHANNELS),
  'shell:open-external',
  'web-remote:admin-get', 'web-remote:admin-save', 'web-remote:admin-pair', 'web-remote:admin-revoke',
  'agent:show-in-folder',
  'agent:open-terminal',
  'agent:open-workspace-folder',
  'app:quit',
  'app:restart',
  'app:update',
  'updater:quit-and-install',
  CHAT_IPC_CHANNELS.OPEN_FILE_DIALOG,
  CHAT_IPC_CHANNELS.SAVE_IMAGE_AS,
  CHAT_IPC_CHANNELS.SAVE_RESOURCE_FILE_AS,
  'scratch-pad:choose-export-path',
  'scratch-pad:export',
  'agent:open-folder-dialog',
  'agent:open-file-or-folder-dialog',
])

export interface WebRemoteDeniedError {
  denied: true
  channel: string
}

export function getWebRemoteDeniedError(channel: string): WebRemoteDeniedError | null {
  return WEB_REMOTE_FULL_UI_DENIED_CHANNELS.has(channel) ? { denied: true, channel } : null
}
