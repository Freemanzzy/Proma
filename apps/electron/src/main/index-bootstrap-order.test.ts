import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('个人版启动顺序', () => {
  test('scheduler 在可能触发钥匙串的 Bridge 初始化前启动', () => {
    const source = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8')
    const webRemote = source.indexOf("await safeAwait('startWebRemoteIfEnabled', startWebRemoteIfEnabled)")
    const scheduler = source.indexOf("safeRun('startScheduler', startScheduler)")
    const healthCheck = source.indexOf("safeRun('startPersonalHealthCheck', startPersonalHealthCheck)")
    const bridges = source.indexOf("await safeAwait('startAllBridges', () => startAllBridges())")
    expect(webRemote).toBeGreaterThanOrEqual(0)
    expect(scheduler).toBeGreaterThan(webRemote)
    expect(healthCheck).toBeGreaterThan(scheduler)
    expect(bridges).toBeGreaterThan(healthCheck)
  })
})
