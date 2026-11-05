import { describe, expect, test } from 'bun:test'
import { DOMParser } from '@xmldom/xmldom'
import { htmlToMarkdown } from '../../renderer/lib/markdown-rich-text'
import { buildGoalCommandFailureReply, parseGoalCommand, unescapeEditorMarkdown } from './personal-goal-memory'

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
