export const WEB_REMOTE_AGENT_RENAME_HANDLER_KEY = '__PROMA_WEB_REMOTE_AGENT_RENAME_HANDLER__'

type RenameHandlerTarget = { [WEB_REMOTE_AGENT_RENAME_HANDLER_KEY]?: () => void }

export function attachWebRemoteAgentRenameHandler<T extends object>(
  target: T | null,
  onRename: () => void,
): () => void {
  if (!target) return () => {}
  const handlerTarget = target as T & RenameHandlerTarget
  handlerTarget[WEB_REMOTE_AGENT_RENAME_HANDLER_KEY] = onRename

  return () => {
    if (handlerTarget[WEB_REMOTE_AGENT_RENAME_HANDLER_KEY] === onRename) {
      delete handlerTarget[WEB_REMOTE_AGENT_RENAME_HANDLER_KEY]
    }
  }
}

export function invokeWebRemoteAgentRenameHandler<T extends object>(target: T | null): boolean {
  const handlerTarget = target as (T & RenameHandlerTarget) | null
  const onRename = handlerTarget?.[WEB_REMOTE_AGENT_RENAME_HANDLER_KEY]
  if (!onRename) return false
  onRename()
  return true
}
