import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldCreatePageNotification } from './notifications'

describe('Web Remote push/page notification dedupe', () => {
  test('does not create a page notification when push is subscribed, and preserves fallback without subscription', () => {
    expect(shouldCreatePageNotification(true)).toBe(false)
    expect(shouldCreatePageNotification(false)).toBe(true)
    const source = readFileSync(join(import.meta.dir, 'notifications.ts'), 'utf8')
    expect(source).toContain('__PROMA_WEB_REMOTE_HAS_PUSH_SUBSCRIPTION')
    expect(source).toContain('!shouldCreatePageNotification(await hasWebRemotePushSubscription())) return')
  })
})
