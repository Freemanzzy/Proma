import { describe, expect, test } from 'bun:test'
import { assertOwnedSessionMutation } from './mobile-harness.mjs'

describe('mobile harness session mutation guard', () => {
  test('rejects existing, missing, and null session IDs', () => {
    const created = new Set(['new-session-1'])
    expect(() => assertOwnedSessionMutation('existing-session', created, 'rename')).toThrow('拒绝对本次运行新建会话以外的目标执行 rename')
    expect(() => assertOwnedSessionMutation(null, created, 'permission mode change')).toThrow('拒绝对本次运行新建会话以外的目标执行 permission mode change')
    expect(() => assertOwnedSessionMutation(undefined, created, 'rename')).toThrow()
  })

  test('allows mutations only for session IDs created in this run', () => {
    expect(() => assertOwnedSessionMutation('new-session-1', new Set(['new-session-1']), 'permission mode change')).not.toThrow()
  })
})
