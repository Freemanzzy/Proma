/** 标题生成 Prompt */
export const TITLE_PROMPT = '根据用户的第一条消息，生成一个简短的对话标题（10字以内）。只输出标题，不要有任何其他内容、标点符号或引号。如果消息内容过短或无明确主题，直接使用原始消息作为标题。\n\n用户消息：'

/** 短消息阈值：低于此长度直接使用原文作为标题 */
export const SHORT_MESSAGE_THRESHOLD = 4

/** 最大标题长度 */
export const MAX_TITLE_LENGTH = 20

const TITLE_PUNCTUATION = /^["'“”‘’「《]+|["'“”‘’」》]+$/g
const MARKDOWN_PREFIX = /^(?:[#>*\-\d.)]\s*)+/
const WHITESPACE = /\s+/g
const ENCODED_REFERENCE_VALUE = String.raw`[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？；：、（）【】《》“”‘’]+`
const TITLE_REFERENCE_PATTERN = new RegExp(
  String.raw`@file:(?<file>${ENCODED_REFERENCE_VALUE})|/skill:(?<skill>\S+)|#mcp:(?<mcp>\S+)|&session:(?<session>[A-Za-z0-9-]+)(?:(?:~|::)(?<sessionLabel>${ENCODED_REFERENCE_VALUE}))?|&todo:(?<todo>[A-Za-z0-9-]+)(?:(?:~|::)(?<todoLabel>${ENCODED_REFERENCE_VALUE}))?|&calendar_event:(?<calendarEvent>[A-Za-z0-9-]+)(?:(?:~|::)(?<calendarEventLabel>${ENCODED_REFERENCE_VALUE}))?|&quote:(?<quote>[A-Za-z0-9%_.!~*'()-]+)`,
  'gu',
)

/**
 * 从模型返回的原始标题内容中提取文本。
 *
 * OpenAI 兼容端点对推理模型可能把 `message.content` 返回为
 * 字符串、内容块数组（`[{ type: 'text', text: '...' }]`）或空值。逐个归一为
 * 纯文本，避免 `.trim()` 在非字符串上抛异常，导致整个标题生成在 catch 里静默丢弃。
 */
function extractTitleText(title: unknown): string {
  if (typeof title === 'string') return title
  if (Array.isArray(title)) {
    return title
      .map((block) => {
        if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
          return (block as { text: string }).text
        }
        return ''
      })
      .join('')
      .trim()
  }
  if (title && typeof title === 'object' && typeof (title as { text?: unknown }).text === 'string') {
    return (title as { text: string }).text
  }
  return ''
}

/** 清理模型返回的标题。兼容字符串与内容块数组，非文本内容返回 null。 */
export function sanitizeGeneratedTitle(title: string | unknown): string | null {
  const text = extractTitleText(title)
  const cleaned = text.trim().replace(TITLE_PUNCTUATION, '').trim()
  return cleaned.slice(0, MAX_TITLE_LENGTH) || null
}

function decodeReferenceValue(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** 清理发给标题模型或本地兜底的用户消息中的 UI 引用协议标记。 */
export function cleanUserMessageForTitle(userMessage: string): string {
  return userMessage.replace(TITLE_REFERENCE_PATTERN, (marker, ...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string | undefined>
    if (groups.file !== undefined) {
      const decoded = decodeReferenceValue(groups.file)
      return decoded?.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
    }
    if (groups.session !== undefined) {
      return groups.sessionLabel === undefined ? '' : decodeReferenceValue(groups.sessionLabel) ?? ''
    }
    if (groups.todo !== undefined) {
      return groups.todoLabel === undefined ? '' : decodeReferenceValue(groups.todoLabel) ?? ''
    }
    if (groups.calendarEvent !== undefined) {
      return groups.calendarEventLabel === undefined ? '' : decodeReferenceValue(groups.calendarEventLabel) ?? ''
    }
    if (groups.quote !== undefined) {
      const decoded = decodeReferenceValue(groups.quote)
      if (!decoded) return ''
      try {
        const payload = JSON.parse(decoded) as { text?: unknown }
        return typeof payload.text === 'string' ? payload.text : ''
      } catch {
        return ''
      }
    }
    if (groups.skill !== undefined || groups.mcp !== undefined) return ''
    return marker
  }).replace(WHITESPACE, ' ').trim()
}

/**
 * 无法调用标题模型时，基于首条用户消息生成一个稳定兜底标题。
 *
 * ChatGPT (Codex) OAuth 使用 Pi SDK 的 Codex Responses 协议，不适配当前
 * @proma/core 的 Chat Completions / Messages 标题请求，因此需要本地兜底，
 * 避免会话长期停留在“新 Agent 会话”。
 */
export function createFallbackTitle(userMessage: string): string | null {
  const cleanedMessage = cleanUserMessageForTitle(userMessage)
  const firstLine = cleanedMessage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?? ''

  const cleaned = firstLine
    .replace(MARKDOWN_PREFIX, '')
    .replace(WHITESPACE, ' ')
    .trim()

  return cleaned.slice(0, MAX_TITLE_LENGTH) || null
}
