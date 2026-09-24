export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function renderSafeMarkdown(markdown: string): string {
  const safeUrl = /^https?:\/\//i
  const escape = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
  const inlineMarkdown = (value: string): string => {
    const escaped = escape(value)
    const placeholders: string[] = []
    const protect = (html: string): string => {
      const key = `\u0000${placeholders.length}\u0000`
      placeholders.push(html)
      return key
    }
    let result = escaped.replace(/`([^`\n]+)`/g, (_match, code: string) => protect(`<code>${code}</code>`))
    result = result.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
      const rawHref = href.replace(/&amp;/g, '&')
      return safeUrl.test(rawHref)
        ? protect(`<a href="${escape(rawHref)}" target="_blank" rel="noopener noreferrer">${label}</a>`)
        : label
    })
    result = result.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    return result.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => placeholders[Number(index)] ?? '')
  }

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let inCode = false
  let codeLines: string[] = []
  let paragraph: string[] = []
  let listType: 'ul' | 'ol' | null = null
  const closeList = (): void => { if (listType) output.push(`</${listType}>`); listType = null }
  const closeParagraph = (): void => { if (paragraph.length) { output.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`); paragraph = [] } }
  const closeBlocks = (): void => { closeParagraph(); closeList() }

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      closeBlocks()
      if (inCode) { output.push(`<pre><code>${codeLines.join('\n')}</code></pre>`); codeLines = [] }
      inCode = !inCode
      continue
    }
    if (inCode) { codeLines.push(escape(line)); continue }
    if (!line.trim()) { closeBlocks(); continue }
    const unordered = line.match(/^\s*[-*]\s+(.*)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (unordered || ordered) {
      closeParagraph()
      const nextType = unordered ? 'ul' : 'ol'
      if (listType !== nextType) { closeList(); listType = nextType; output.push(`<${listType}>`) }
      output.push(`<li>${inlineMarkdown((unordered ?? ordered)![1]!)}</li>`)
      continue
    }
    closeList()
    paragraph.push(line)
  }
  if (inCode) output.push(`<pre><code>${codeLines.join('\n')}</code></pre>`)
  closeBlocks()
  return output.join('')
}
