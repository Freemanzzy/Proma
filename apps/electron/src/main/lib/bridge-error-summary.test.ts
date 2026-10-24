import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { summarizeBridgeError } from './bridge-log-redaction'

describe('summarizeBridgeError', () => {
  test('keeps HTTP status and Feishu code/msg in one line', () => {
    const error = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { code: 99991672, msg: 'Access denied. One of the following scopes is required' } },
    })
    expect(summarizeBridgeError(error)).toBe('status=400 code=99991672 msg=Access denied. One of the following scopes is required message=Request failed with status code 400')
  })

  test('redacts secrets and handles plain values', () => {
    expect(summarizeBridgeError(new Error('app_secret=abc123 failed'))).toBe('message=app_secret=[REDACTED] failed')
    expect(summarizeBridgeError('boom')).toBe('boom')
    expect(summarizeBridgeError(undefined)).toBe('unknown error')
  })
})

describe('Feishu bindings load', () => {
  test('does not overwrite binding channel/model with app defaults on startup', () => {
    const source = readFileSync(join(import.meta.dir, 'feishu-bridge.ts'), 'utf8')
    const start = source.indexOf('private loadBindings(): void')
    const body = source.slice(start, source.indexOf('private saveBindings', start))
    expect(body).not.toContain('b.modelId = appSettings.agentModelId')
    expect(body).not.toContain('b.channelId = appSettings.agentChannelId')
  })
})
