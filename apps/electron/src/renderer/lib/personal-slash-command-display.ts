/**
 * 个人版：宿主处理的 `/命令`（目前是 `/goal`）在用户气泡里按纯文本显示。
 *
 * 富文本输入框发送前会把 `\ ` * _ [ ] < > |` 等加反斜杠转义（markdown-rich-text.ts escapeMarkdownText）。
 * 用户气泡按 Markdown 渲染，且 normalizeLatexDelimiters 会把 `\[ … \]` 当成 LaTeX 公式，
 * 于是 `/goal set` 的 JSON 显示成残缺文本和红色 KaTeX 错误（2026-11-06 实测）。
 * 这里只接管 `/goal` 消息：还原转义后整条按纯文本显示；普通消息与 Skill `/提及` 不受影响。
 */

/** 还原输入框 Markdown 序列化加入的反斜杠转义（main 端 parseGoalCommand 共用此实现）。 */
export function unescapeEditorMarkdown(value: string): string {
  return value.replace(/\\([\\`*_[\]<>|#+\-.])/g, '$1')
}

const HOST_SLASH_COMMAND = /^\/goal(?:\s|$)/i
const GOAL_CONTRACT_COMMAND = /^\/goal\s+(?:set|revise)\s+([\s\S]*)$/i

/**
 * 返回宿主 `/命令` 消息的显示文本；不是这类消息时返回 null（走原有 Markdown 渲染）。
 * 与 parseGoalCommand 一致：合同 JSON 按原文能解析时（纯文本模式发送）原样显示，否则显示还原转义后的文本。
 */
export function formatHostSlashCommandForDisplay(text: string): string | null {
  const trimmed = text.trim()
  if (!HOST_SLASH_COMMAND.test(trimmed)) return null
  const body = GOAL_CONTRACT_COMMAND.exec(trimmed)?.[1]?.trim()
  if (body !== undefined) {
    try {
      JSON.parse(body)
      return trimmed
    } catch {
      // 富文本模式发送的文本带转义，下面还原
    }
  }
  return unescapeEditorMarkdown(trimmed)
}
