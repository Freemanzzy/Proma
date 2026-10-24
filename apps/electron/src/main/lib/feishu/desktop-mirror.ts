import type { FeishuChatBinding } from '@proma/shared'

export function shouldMirrorDesktopRun(
  binding: Pick<FeishuChatBinding, 'source' | 'mirrorDesktopRuns'> | null | undefined,
  origin: 'desktop' | 'feishu',
): boolean {
  return origin === 'desktop' && binding?.source !== 'session-mirror' && binding?.mirrorDesktopRuns === true
}

/** Remove encoded UI reference markers rather than exposing their file/path payloads. */
export function cleanDesktopMirrorText(text: string, limit = 2_000): string {
  const cleaned = text
    .replace(/@file:[^\s]+|&(?:session|todo|calendar_event|quote):[^\s]+|\/skill:\S+|#mcp:\S+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return cleaned.slice(0, limit)
}

export function canToggleDesktopMirror(binding: Pick<FeishuChatBinding, 'userId'> | null | undefined, senderOpenId: string): boolean {
  return Boolean(binding?.userId && senderOpenId && binding.userId === senderOpenId)
}
