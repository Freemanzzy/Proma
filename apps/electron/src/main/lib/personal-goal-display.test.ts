// 注意：bun 会把 String.raw 模板里的中文转成 \u 转义，这里一律用普通字符串
import { describe, expect, test } from 'bun:test'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toString } from 'mdast-util-to-string'
import { normalizeLatexDelimiters } from '../../renderer/lib/normalize-latex'
import { formatHostSlashCommandForDisplay, unescapeEditorMarkdown } from '../../renderer/lib/personal-slash-command-display'
import { buildGoalCommandFailureReply, parseGoalCommand } from './personal-goal-memory'

// 2026-11-06 安装验证会话 5bd413ec 中落盘的用户消息原文（富文本输入框序列化后）
const storedSet = '/goal set {"expectedRevision":0,"originalText":"安装验证：a\\_b \\*重要\\* \\<tag\\> \\| 路径 C:\\\\\\\\temp","scope":\\["验证 /goal 粘贴"\\],"nonGoals":\\["不修改任何文件"\\],"hardConstraints":\\["保留 x\\_y \\[原样\\] \\<b\\>"\\],"acceptance":\\["1. status 显示 revision 1"\\]}'
const storedRevise = '/goal revise {"expectedRevision":1,"originalText":"路径 C:\\\\temp","scope":\\[\\],"nonGoals":\\[\\],"hardConstraints":\\[\\],"acceptance":\\[\\]}'

/** 宿主回复经 Markdown 渲染后用户看到的文字 */
function visibleMarkdownText(markdown: string): string {
  return toString(fromMarkdown(markdown))
}

describe('用户气泡：/goal 消息按纯文本显示', () => {
  test('原 Markdown 渲染路径会把 \\[ … \\] 当 LaTeX 公式（说明为什么要接管）', () => {
    expect(normalizeLatexDelimiters(storedRevise)).toContain('$$')
  })

  test('还原转义后与用户输入一致', () => {
    expect(formatHostSlashCommandForDisplay(storedSet)).toBe('/goal set {"expectedRevision":0,"originalText":"安装验证：a_b *重要* <tag> | 路径 C:\\\\temp","scope":["验证 /goal 粘贴"],"nonGoals":["不修改任何文件"],"hardConstraints":["保留 x_y [原样] <b>"],"acceptance":["1. status 显示 revision 1"]}')
    expect(formatHostSlashCommandForDisplay(storedRevise)).toBe('/goal revise {"expectedRevision":1,"originalText":"路径 C:\\temp","scope":[],"nonGoals":[],"hardConstraints":[],"acceptance":[]}')
  })

  test('显示文本与宿主解析看到的合同一致', () => {
    const displayed = formatHostSlashCommandForDisplay(storedSet)!
    expect(parseGoalCommand(displayed)).toEqual(parseGoalCommand(storedSet))
  })

  test('原始 JSON（纯文本模式发送）原样显示，不还原反斜杠', () => {
    const raw = '/goal set {"expectedRevision":0,"originalText":"C:\\\\temp","scope":[],"nonGoals":[],"hardConstraints":[],"acceptance":[]}'
    expect(formatHostSlashCommandForDisplay(raw)).toBe(raw)
  })

  test('其他 /goal 子命令与非法 JSON', () => {
    expect(formatHostSlashCommandForDisplay('/goal status')).toBe('/goal status')
    expect(formatHostSlashCommandForDisplay('  /goal off  ')).toBe('/goal off')
    expect(formatHostSlashCommandForDisplay('/goal set {坏的 \\[x\\]')).toBe('/goal set {坏的 [x]')
  })

  test('普通消息、Skill 提及、其他斜杠开头文本不接管', () => {
    expect(formatHostSlashCommandForDisplay('请看 \\[x\\] 和 **粗体**')).toBeNull()
    expect(formatHostSlashCommandForDisplay('/shared-skills 帮我检查')).toBeNull()
    expect(formatHostSlashCommandForDisplay('/compact')).toBeNull()
    expect(formatHostSlashCommandForDisplay('/goals 列表')).toBeNull()
    expect(formatHostSlashCommandForDisplay('/Users/jo/a.md')).toBeNull()
  })

  test('main 端 parseGoalCommand 与气泡共用同一个还原实现', () => {
    expect(unescapeEditorMarkdown('a\\_b \\\\\\\\ \\<t\\>')).toBe('a_b \\\\ <t>')
  })
})

describe('宿主失败提示在 Markdown 渲染后保持字面', () => {
  test('控制字符提示显示两个反斜杠', () => {
    let reply = ''
    try { parseGoalCommand(`/goal set ${JSON.stringify({ expectedRevision: 0, originalText: '路径 C:\temp', scope: [], nonGoals: [], hardConstraints: [], acceptance: [] })}`) } catch (error) { reply = buildGoalCommandFailureReply(error) }
    const visible = visibleMarkdownText(reply)
    expect(visible).toContain('originalText 含控制字符 U+0009')
    expect(visible).toContain('请在 JSON 中把反斜杠写成 \\\\')
    expect(visible).not.toContain('写成 \\。')
  })

  test('用法里的 <JSON合同> 不被当 HTML 丢弃', () => {
    const visible = visibleMarkdownText(buildGoalCommandFailureReply(new Error('未知的 Goal 子命令')))
    expect(visible).toContain('/goal set <JSON合同>')
    expect(visible).toContain('/goal revise <JSON合同>')
    expect(visible).toContain('/goal off')
  })

  test('未知子命令报错', () => {
    expect(() => parseGoalCommand('/goal frobnicate')).toThrow('未知的 Goal 子命令')
  })
})
