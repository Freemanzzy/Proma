import { describe, expect, test } from 'bun:test'
import { isDesktopAdminAllowed, isWebRemoteActivationAllowed, isWebRemoteConfigDirAllowed, resolveWebRemoteIconDir } from './web-remote-policy'

const enabled = { enabled: true, configDirName: '.proma', allowProd: false, envEnabled: false }

describe('Web Remote activation policy', () => {
  test('personal packaged build can use config enabled in formal data dir without env flag', () => {
    expect(isWebRemoteActivationAllowed({ ...enabled, packaged: true, personalBuild: true })).toBe(true)
  })

  test('development instances allow only the default or validated isolated data-directory names', () => {
    expect(isWebRemoteConfigDirAllowed('.proma-dev')).toBe(true)
    expect(isWebRemoteConfigDirAllowed('.proma-dev-fixture')).toBe(true)
    expect(isWebRemoteConfigDirAllowed('.proma-dev-batch-20261014')).toBe(true)
    expect(isWebRemoteConfigDirAllowed('.proma')).toBe(false)
    expect(isWebRemoteConfigDirAllowed('.proma-dev-')).toBe(false)
    expect(isWebRemoteConfigDirAllowed('.proma-dev-Fixture')).toBe(false)
    expect(isWebRemoteConfigDirAllowed('.proma-dev-fixture/extra')).toBe(false)
    expect(isWebRemoteConfigDirAllowed('.proma-dev-fixture', true)).toBe(true)
  })

  test('development instance retains environment flag requirement for isolated data directories', () => {
    expect(isWebRemoteActivationAllowed({ ...enabled, packaged: false, personalBuild: false, configDirName: '.proma-dev-fixture', envEnabled: true })).toBe(true)
    expect(isWebRemoteActivationAllowed({ ...enabled, packaged: false, personalBuild: false, configDirName: '.proma-dev-fixture' })).toBe(false)
    expect(isWebRemoteActivationAllowed({ ...enabled, packaged: false, personalBuild: false, configDirName: '.proma-dev-Fixture', envEnabled: true })).toBe(false)
  })

  test('official packaged build never enables even with production override flags', () => {
    expect(isWebRemoteActivationAllowed({ ...enabled, packaged: true, personalBuild: false, allowProd: true, envEnabled: true })).toBe(false)
    expect(isWebRemoteActivationAllowed({ ...enabled, packaged: true, personalBuild: false, configDirName: '.proma-dev-fixture', allowProd: true, envEnabled: true })).toBe(false)
  })

  test('desktop admin IPC permits packaged file renderer only in personal build or dev instance', () => {
    expect(isDesktopAdminAllowed({ personalPackaged: true, configDirName: '.proma', packaged: true, url: 'file:///Applications/Proma.app/index.html' })).toBe(true)
    expect(isDesktopAdminAllowed({ personalPackaged: false, configDirName: '.proma', packaged: true, url: 'file:///Applications/Proma.app/index.html' })).toBe(false)
    expect(isDesktopAdminAllowed({ personalPackaged: false, configDirName: '.proma-dev-fixture', packaged: true, url: 'file:///Applications/Proma.app/index.html' })).toBe(false)
    expect(isDesktopAdminAllowed({ personalPackaged: false, configDirName: '.proma-dev', packaged: false, url: 'http://127.0.0.1:5173/settings' })).toBe(true)
    expect(isDesktopAdminAllowed({ personalPackaged: false, configDirName: '.proma-dev-fixture', packaged: false, url: 'http://127.0.0.1:5173/settings' })).toBe(true)
    expect(isDesktopAdminAllowed({ personalPackaged: false, configDirName: '.proma-dev-fixture/extra', packaged: false, url: 'http://127.0.0.1:5173/settings' })).toBe(false)
    expect(isDesktopAdminAllowed({ personalPackaged: true, configDirName: '.proma', packaged: true, url: undefined })).toBe(false)
  })

  test('手机图标目录：安装包取 resourcesPath/web-remote，开发实例取源码树 resources/web-remote', () => {
    expect(resolveWebRemoteIconDir({ packaged: true, resourcesPath: '/App/Contents/Resources', moduleDir: '/App/Contents/Resources/app.asar/dist' }))
      .toBe('/App/Contents/Resources/web-remote')
    expect(resolveWebRemoteIconDir({ packaged: false, resourcesPath: '/unused', moduleDir: '/repo/apps/electron/dist' }))
      .toBe('/repo/apps/electron/resources/web-remote')
  })
})
