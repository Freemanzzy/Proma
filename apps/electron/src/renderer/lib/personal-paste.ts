/**
 * 个人版：富文本输入框的粘贴例外。
 *
 * 上游在富文本模式下会把“看起来像 Markdown”的纯文本粘贴经 markdownToHtml 渲染成富文本，
 * 这会改写 `\\`（作为 Markdown 转义吃掉一个反斜杠）并丢弃 `<tag>`（视作内联 HTML）。
 * 以 `/命令` 开头的文本（如 `/goal set {...}`）必须逐字保留，因此按纯文本插入。
 * 插入时不带 uiEvent=paste：TipTap 的粘贴规则会把 `*重要*` 等转成格式（dev harness 2026-11-05 实测）。
 * 其余粘贴保持上游行为（粘贴 Markdown 渲染为富文本是上游有意提供的体验）。
 */
export function isSlashCommandPasteText(text: string): boolean {
  // 只接管带参数的命令；单独的 `/xxx` 仍走上游路径（不会被改写），且不触发 `/` Skill 提及弹窗的差异
  return /^\/[A-Za-z][\w-]*\s+\S/.test(text.trimStart())
}
