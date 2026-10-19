export function resolveAgentComposerPlaceholder(options: {
  hasChannel: boolean
  hasAvailableModel: boolean
  isMobileWebRemote: boolean
  sendWithCmdEnter: boolean
}): string {
  if (!options.hasChannel) return '请先选择模型'
  if (!options.hasAvailableModel) return '暂无可用模型，请先在设置中启用渠道'
  if (options.isMobileWebRemote) return '输入消息…'
  return options.sendWithCmdEnter
    ? '输入消息...（@ 引用文件，/ 调用 Skill，# 使用 MCP，& 引用会话，～ 引用待办/日程；⌘/Ctrl+Enter 发送）'
    : '输入消息...（@ 引用文件，/ 调用 Skill，# 使用 MCP，& 引用会话，～ 引用待办/日程；Enter 发送）'
}
