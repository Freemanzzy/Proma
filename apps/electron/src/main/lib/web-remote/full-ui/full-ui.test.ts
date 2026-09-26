import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getWebRemoteDeniedError } from './denied-channels'
import { WebRemoteRegistrationTable } from './registration-table'
import { prepareWebRemoteFullUi } from './prepare'
import { decodeWebRemoteValue, encodeWebRemoteValue } from './serialization'

/** 临时改写 process.resourcesPath，运行完毕后还原（个人版标记检测依赖它）。 */
function withResourcesPath(value: string | undefined, run: () => void): void {
  const proc = process as NodeJS.Process & { resourcesPath?: string }
  const original = proc.resourcesPath
  if (value === undefined) delete (proc as { resourcesPath?: string }).resourcesPath
  else proc.resourcesPath = value
  try {
    run()
  } finally {
    Object.defineProperty(proc, 'resourcesPath', { value: original, configurable: true, writable: true })
  }
}

/** 临时改写 PROMA_WEB_REMOTE，运行完毕后还原。 */
function withWebRemoteEnv(value: string | undefined, run: () => void): void {
  const previous = process.env.PROMA_WEB_REMOTE
  if (value === undefined) delete process.env.PROMA_WEB_REMOTE
  else process.env.PROMA_WEB_REMOTE = value
  try {
    run()
  } finally {
    if (previous === undefined) delete process.env.PROMA_WEB_REMOTE
    else process.env.PROMA_WEB_REMOTE = previous
  }
}

describe('web remote full-ui spike', () => {
  test('serializes transport-only values and restores them', () => {
    const original = { missing: undefined, when: new Date('2026-09-25T00:00:00.000Z'), bytes: new Uint8Array([1, 2, 3]) }
    const roundTrip = decodeWebRemoteValue(encodeWebRemoteValue(original)) as typeof original
    expect(roundTrip.missing).toBeUndefined()
    expect(roundTrip.when).toBeInstanceOf(Date)
    expect((roundTrip.bytes as Uint8Array)[2]).toBe(3)
  })

  test('returns structured denial for sensitive and desktop-only mobile-admin channels', () => {
    expect(getWebRemoteDeniedError('channel:decrypt-key')).toEqual({ denied: true, channel: 'channel:decrypt-key' })
    for (const channel of ['web-remote:admin-get', 'web-remote:admin-save', 'web-remote:admin-pair', 'web-remote:admin-revoke']) {
      expect(getWebRemoteDeniedError(channel)).toEqual({ denied: true, channel })
    }
    expect(getWebRemoteDeniedError('agent:list-sessions')).toBeNull()
  })

  test('keeps an invoke and event registration table', () => {
    const invokes = new WebRemoteRegistrationTable<() => unknown>()
    const events = new WebRemoteRegistrationTable<() => void>()
    invokes.set('demo:invoke', async () => 'ok')
    events.set('demo:event', () => {})
    expect({ invoke: invokes.size, event: events.size }).toEqual({ invoke: 1, event: 1 })
  })

  test('installs synchronously before later handler registration', () => {
    const registered: Record<string, Function> = {}
    const target = {
      handle(channel: string, listener: Function) { registered[`handle:${channel}`] = listener },
      on(channel: string, listener: Function) { registered[`on:${channel}`] = listener },
    }
    const previous = process.env.PROMA_WEB_REMOTE
    process.env.PROMA_WEB_REMOTE = '1'
    try {
      const bridge = prepareWebRemoteFullUi(target, { enabled: true, fullUi: true })
      expect(bridge).toBeTruthy()
      target.handle('demo:invoke', async () => 'ok')
      target.on('demo:event', () => {})
      expect(bridge?.getRegistrationCounts()).toEqual({ invoke: 1, event: 1 })
      expect(typeof registered['handle:demo:invoke']).toBe('function')
    } finally {
      if (previous === undefined) delete process.env.PROMA_WEB_REMOTE
      else process.env.PROMA_WEB_REMOTE = previous
    }
  })

  test('打包的个人版即使没有 .proma-dev 与 PROMA_WEB_REMOTE，标记存在且配置开启也能装上桥', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-personal-full-ui-'))
    try {
      writeFileSync(join(root, 'personal-build.json'), '{"personal":true}')
      withWebRemoteEnv(undefined, () => withResourcesPath(root, () => {
        const target = { handle() {}, on() {} }
        const bridge = prepareWebRemoteFullUi(target, { enabled: true, fullUi: true }, undefined, { packaged: true })
        expect(bridge).toBeTruthy()
      }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('打包但没有个人版标记时，不装桥', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-personal-full-ui-'))
    try {
      withWebRemoteEnv(undefined, () => withResourcesPath(root, () => {
        const target = { handle() {}, on() {} }
        const bridge = prepareWebRemoteFullUi(target, { enabled: true, fullUi: true }, undefined, { packaged: true })
        expect(bridge).toBeNull()
      }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('打包个人版标记存在但 config.fullUi 未开启时，不装桥', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-personal-full-ui-'))
    try {
      writeFileSync(join(root, 'personal-build.json'), '{"personal":true}')
      withWebRemoteEnv(undefined, () => withResourcesPath(root, () => {
        const target = { handle() {}, on() {} }
        const bridge = prepareWebRemoteFullUi(target, { enabled: true, fullUi: false }, undefined, { packaged: true })
        expect(bridge).toBeNull()
      }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
