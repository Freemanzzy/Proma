import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAgentSessionSDKMessagesWindowFromFile } from './agent-session-history-window'

const roots: string[] = []
function fixture(messages: unknown[], trailingNewline = true): string {
  const root = mkdtempSync(join(tmpdir(), 'proma-history-window-'))
  roots.push(root)
  const path = join(root, 'session.jsonl')
  const text = messages.map((message) => JSON.stringify(message)).join('\n') + (trailingNewline ? '\n' : '')
  writeFileSync(path, text)
  return path
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop SDK history file windows', () => {
  test('selects complete user turns from the tail and supports loading earlier pages', () => {
    const messages = [
      { type: 'user', text: 'q1' },
      { type: 'assistant', content: [{ type: 'tool_use', id: 'call-1' }] },
      { type: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'result' }] },
      { type: 'assistant', text: 'a1' },
      { type: 'user', text: 'q2' },
      { type: 'assistant', text: 'a2' },
      { type: 'user', text: 'q3' },
      { type: 'assistant', text: 'a3' },
    ]
    const path = fixture(messages)
    const last = readAgentSessionSDKMessagesWindowFromFile(path, { budgetBytes: 1 }, (value) => value)
    expect(last.messages).toEqual(messages.slice(6))
    expect(last.startIndex).toBe(6)
    expect(last.total).toBe(messages.length)
    expect(last.hasEarlier).toBe(true)

    const earlier = readAgentSessionSDKMessagesWindowFromFile(path, { endIndex: last.startIndex, budgetBytes: 1 }, (value) => value)
    expect(earlier.messages).toEqual(messages.slice(4, 6))
    expect(earlier.startIndex).toBe(4)
    expect(earlier.hasEarlier).toBe(true)

    const toolTurn = readAgentSessionSDKMessagesWindowFromFile(path, { endIndex: 4, budgetBytes: 1 }, (value) => value)
    expect(toolTurn.messages).toEqual(messages.slice(0, 4))
    expect(toolTurn.startIndex).toBe(0)
  })

  test('does not mistake a tool_result at the beginning of a reverse-read batch for a turn boundary', () => {
    const messages = [
      { type: 'user', text: 'original prompt' },
      { type: 'assistant', content: [{ type: 'tool_use', id: 'long-running-tool' }] },
      ...Array.from({ length: 127 }, (_, index) => ({ type: 'assistant', text: `progress-${index}` })),
      { type: 'user', content: [{ type: 'tool_result', tool_use_id: 'long-running-tool', content: 'done' }] },
      { type: 'assistant', text: 'finished' },
    ]
    const result = readAgentSessionSDKMessagesWindowFromFile(fixture(messages), { budgetBytes: 1 }, (value) => value)
    expect(result.messages).toEqual(messages)
    expect(result.startIndex).toBe(0)
  })

  test('re-reads the loaded suffix after appends and counts a final line without newline', () => {
    const messages = [{ type: 'user', text: 'q1' }, { type: 'assistant', text: 'a1' }]
    const path = fixture(messages, false)
    const initial = readAgentSessionSDKMessagesWindowFromFile(path, { startIndex: 1 }, (value) => value)
    expect(initial.messages).toEqual(messages.slice(1))
    expect(initial.total).toBe(2)
    expect(initial.startIndex).toBe(1)

    const appended = [...messages, { type: 'user', text: 'q2' }, { type: 'assistant', text: 'a2' }]
    writeFileSync(path, appended.map((message) => JSON.stringify(message)).join('\n'))
    const refreshed = readAgentSessionSDKMessagesWindowFromFile(path, { startIndex: 1 }, (value) => value)
    expect(refreshed.messages).toEqual(appended.slice(1))
    expect(refreshed.total).toBe(4)
  })
})
