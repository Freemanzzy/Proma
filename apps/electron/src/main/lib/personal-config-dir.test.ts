import { describe, expect, test } from 'bun:test'
import { resolvePersonalConfigDirName } from './personal-config-dir'

describe('开发数据目录隔离', () => {
  test('打包版忽略开发覆盖并始终使用正式目录', () => {
    expect(resolvePersonalConfigDirName(true, '.proma-dev-fixture')).toEqual({
      name: '.proma',
      warning: 'PROMA_DEV_DATA_DIR_NAME 在打包版中被忽略，打包版始终使用 ~/.proma/',
    })
  })

  test('非法开发目录名回退到默认目录并产生警告', () => {
    const result = resolvePersonalConfigDirName(false, '../.proma')
    expect(result.name).toBe('.proma-dev')
    expect(result.warning).toContain('PROMA_DEV_DATA_DIR_NAME 无效')
  })

  test('合法开发目录名生效且不产生警告', () => {
    expect(resolvePersonalConfigDirName(false, '.proma-dev-fixture')).toEqual({ name: '.proma-dev-fixture' })
  })

  test('未设置覆盖时未打包版继续使用默认目录', () => {
    expect(resolvePersonalConfigDirName(false, undefined)).toEqual({ name: '.proma-dev' })
  })
})
