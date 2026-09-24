import { describe, expect, test } from 'bun:test'
import { renderSafeMarkdown } from './web-remote-markdown'

describe('web remote safe markdown', () => {
  test('支持段落、换行、粗体、代码、列表和安全 https 链接', () => {
    const html = renderSafeMarkdown('第一行\n第二行\n\n**粗体** `code`\n\n- 一\n- 二\n\n[链接](https://example.com)')
    expect(html).toContain('<p>第一行<br>第二行</p>')
    expect(html).toContain('<strong>粗体</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<ul><li>一</li><li>二</li></ul>')
    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"')
  })

  test('整体转义并阻止常见 XSS 向量', () => {
    const html = renderSafeMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[javascript](javascript:alert(1))\n" onmouseover="alert(1)"\n```html\n<img onerror="x">\n```')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('onerror="')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img onerror=&quot;x&quot;&gt;')
  })
})
