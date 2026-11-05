import { describe, expect, test } from 'bun:test'
import { DOMParser } from '@xmldom/xmldom'
import { htmlToMarkdown, looksLikeMarkdownText, markdownToHtml } from '../../renderer/lib/markdown-rich-text'
import { isSlashCommandPasteText } from '../../renderer/lib/personal-paste'
import { buildGoalCommandFailureReply, findGoalControlCharacter, formatGoalOriginalTextEcho, parseGoalCommand, unescapeEditorMarkdown } from './personal-goal-memory'

// 与 renderer/lib/markdown-rich-text.test.ts 相同的最小 DOM 替身：经真实 htmlToMarkdown 序列化输入框内容。
function withHtmlDocument<T>(run: () => T): T {
  const originalDocument = globalThis.document
  const originalNode = globalThis.Node
  const parser = new DOMParser()
  Object.assign(globalThis, {
    document: {
      createElement: () => {
        let root: Element | null = null
        return {
          nodeType: 1,
          tagName: 'DIV',
          getAttribute: () => null,
          set innerHTML(html: string) { root = parser.parseFromString(`<div>${html}</div>`, 'text/html').documentElement },
          get childNodes() { return root?.childNodes ?? [] },
        }
      },
    },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  })
  try { return run() } finally { Object.assign(globalThis, { document: originalDocument, Node: originalNode }) }
}

const htmlText = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const contract = {
  expectedRevision: 0,
  originalText: '修 a_b 的 *重要* <tag> | 路径 C:\\temp\\x，# 不是标题',
  scope: ['验证 /goal 命令与证据读取'],
  nonGoals: ['不修改任何文件'],
  hardConstraints: ['保留 x_y [原样]'],
  acceptance: ['1. 通过'],
}

describe('/goal set 经桌面输入框序列化后仍能解析', () => {
  test('真实 htmlToMarkdown 转义后的命令解析为与原文完全一致的合同', () => {
    const typed = `/goal set ${JSON.stringify(contract)}`
    const sent = withHtmlDocument(() => htmlToMarkdown(`<p>${htmlText(typed)}</p>`))
    expect(sent).not.toBe(typed)
    expect(sent).toContain('\\[')
    expect(() => JSON.parse(sent.replace(/^\/goal set /, ''))).toThrow()
    const parsed = parseGoalCommand(sent)
    expect(parsed).toEqual({ command: 'set', input: contract })
  })

  test('未经序列化的原始 JSON 不做还原（转义反斜杠保持不变）', () => {
    const raw = `/goal set ${JSON.stringify(contract)}`
    expect(parseGoalCommand(raw)).toEqual({ command: 'set', input: contract })
  })

  test('revise 同样处理', () => {
    const typed = `/goal revise ${JSON.stringify({ ...contract, expectedRevision: 1 })}`
    const sent = withHtmlDocument(() => htmlToMarkdown(`<p>${htmlText(typed)}</p>`))
    expect(parseGoalCommand(sent)).toEqual({ command: 'revise', input: { ...contract, expectedRevision: 1 } })
  })

  test('还原只处理输入框会加的转义', () => {
    expect(unescapeEditorMarkdown('\\[a\\_b\\] \\\\ \\"q\\" \\n')).toBe('[a_b] \\ \\"q\\" \\n')
  })

  test('仍非法时报出可读错误，失败回复说明合同未改变', () => {
    expect(() => parseGoalCommand('/goal set {not json')).toThrow('JSON 解析失败')
    const reply = buildGoalCommandFailureReply(new Error('expectedRevision 必须是非负整数'))
    expect(reply).toContain('Goal 命令未执行：expectedRevision 必须是非负整数')
    expect(reply).toContain('合同未改变')
  })
})

// 2026-11-05 缺陷 3：剪贴板只有 text/plain 时，富文本输入框曾把它当 Markdown 渲染（markdownToHtml），改写 \\ 与 <tag>。
const pasteContract = {
  expectedRevision: 0,
  originalText: '安装验证：a_b *重要* <tag> | 路径 C:\\temp [x]',
  scope: ['验证 /goal 命令与证据读取'],
  nonGoals: ['不修改任何文件'],
  hardConstraints: ['保留 x_y [原样] <b>'],
  acceptance: ['1. status 显示 revision 1'],
}

describe('/goal set 经粘贴（剪贴板只有 text/plain）', () => {
  const pasted = `/goal set ${JSON.stringify(pasteContract)}`
  const pastedPretty = `/goal set ${JSON.stringify(pasteContract, null, 2)}`

  test('上游 Markdown 粘贴路径会改写这段文本（说明为什么必须绕开）', () => {
    expect(looksLikeMarkdownText(pasted)).toBe(true)
    const html = markdownToHtml(pasted)
    expect(html).toContain('raw-html-inline') // <tag> 被当作内联 HTML，粘贴进编辑器后丢失
    expect(html).toContain('<em>重要</em>')
    expect(html).not.toContain('C:\\\\temp')
  })

  test('/命令 粘贴走纯文本插入；路径、普通文本不受影响', () => {
    expect(isSlashCommandPasteText(pasted)).toBe(true)
    expect(isSlashCommandPasteText(`  ${pastedPretty}`)).toBe(true)
    expect(isSlashCommandPasteText('/goal status')).toBe(true)
    expect(isSlashCommandPasteText('/compact')).toBe(false) // 无参数：走上游默认粘贴，纯单词不会被改写
    expect(isSlashCommandPasteText('/Users/jo/file.md')).toBe(false)
    expect(isSlashCommandPasteText('**粗体** 文本')).toBe(false)
    expect(isSlashCommandPasteText('/ 斜杠开头的句子')).toBe(false)
  })

  test('纯文本插入后经真实 htmlToMarkdown 序列化，解析出的合同逐字一致（单行与多行 JSON）', () => {
    for (const text of [pasted, pastedPretty]) {
      // 纯文本插入 = 编辑器里一个文本节点；发送时 getMarkdown → htmlToMarkdown
      const sent = withHtmlDocument(() => htmlToMarkdown(`<p>${htmlText(text)}</p>`))
      expect(parseGoalCommand(sent)).toEqual({ command: 'set', input: pasteContract })
    }
  })

  test('合同含换行以外的控制字符时拒绝（如 C:\\temp 被改写成制表符）', () => {
    const broken = { ...pasteContract, originalText: '路径 C:\temp' }
    expect(findGoalControlCharacter(broken.originalText)).toBe('U+0009')
    expect(() => parseGoalCommand(`/goal set ${JSON.stringify(broken)}`)).toThrow('originalText 含控制字符 U+0009')
    expect(() => parseGoalCommand(`/goal set ${JSON.stringify({ ...pasteContract, scope: ['a\u0007b'] })}`)).toThrow('scope 含控制字符 U+0007')
    expect(findGoalControlCharacter('第一行\n第二行')).toBeNull()
  })

  test('已保存回复回显原文（超长截断）', () => {
    expect(formatGoalOriginalTextEcho('a<tag>\\b')).toBe('原文：「a<tag>\\b」')
    expect(formatGoalOriginalTextEcho('x'.repeat(400))).toBe(`原文：「${'x'.repeat(300)}…」`)
  })
})
