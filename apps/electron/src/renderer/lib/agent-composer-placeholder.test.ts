import { describe, expect, test } from 'bun:test'
import { resolveAgentComposerPlaceholder } from './agent-composer-placeholder'

describe('resolveAgentComposerPlaceholder', () => {
  const base = { hasChannel: true, hasAvailableModel: true, isMobileWebRemote: false }

  test('only shortens the available-model placeholder in a narrow Web Remote viewport', () => {
    expect(resolveAgentComposerPlaceholder({ ...base, isMobileWebRemote: true, sendWithCmdEnter: false })).toBe('输入消息…')
    expect(resolveAgentComposerPlaceholder({ ...base, isMobileWebRemote: false, sendWithCmdEnter: false })).toContain('Enter 发送')
    expect(resolveAgentComposerPlaceholder({ ...base, isMobileWebRemote: false, sendWithCmdEnter: true })).toContain('⌘/Ctrl+Enter 发送')
  })

  test('keeps channel/model setup prompts unchanged on mobile', () => {
    expect(resolveAgentComposerPlaceholder({ ...base, hasChannel: false, isMobileWebRemote: true, sendWithCmdEnter: false })).toBe('请先选择模型')
    expect(resolveAgentComposerPlaceholder({ ...base, hasAvailableModel: false, isMobileWebRemote: true, sendWithCmdEnter: false })).toBe('暂无可用模型，请先在设置中启用渠道')
  })
})
