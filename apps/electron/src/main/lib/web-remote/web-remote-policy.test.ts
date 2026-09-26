import { describe, expect, test } from 'bun:test'
import { isDesktopAdminAllowed, isWebRemoteActivationAllowed } from './web-remote-policy'

const enabled = { enabled: true, configDirName: '.proma', allowProd: false, envEnabled: false }

describe('Web Remote activation policy', () => {
  test('personal packaged build can use config enabled in formal data dir without env flag', () => {
    expect(isWebRemoteActivationAllowed({ ...enabled, packaged: true, personalBuild: true })).toBe(true)
  })

  test('development instance retains environment flag requirement', () => {
    expect(isWebRemoteActivationAllowed({ ...enabled, packaged: false, personalBuild: false, configDirName: '.proma-dev', envEnabled: true })).toBe(true)
    expect(isWebRemoteActivationAllowed({ ...enabled, packaged: false, personalBuild: false, configDirName: '.proma-dev' })).toBe(false)
  })

  test('official packaged build never enables even with production override flags', () => {
    expect(isWebRemoteActivationAllowed({ ...enabled, packaged: true, personalBuild: false, allowProd: true, envEnabled: true })).toBe(false)
  })

  test('desktop admin IPC permits packaged file renderer only in personal build or dev instance', () => {
    expect(isDesktopAdminAllowed({ personalPackaged: true, configDirName: '.proma', packaged: true, url: 'file:///Applications/Proma.app/index.html' })).toBe(true)
    expect(isDesktopAdminAllowed({ personalPackaged: false, configDirName: '.proma', packaged: true, url: 'file:///Applications/Proma.app/index.html' })).toBe(false)
    expect(isDesktopAdminAllowed({ personalPackaged: false, configDirName: '.proma-dev', packaged: false, url: 'http://127.0.0.1:5173/settings' })).toBe(true)
    expect(isDesktopAdminAllowed({ personalPackaged: true, configDirName: '.proma', packaged: true, url: undefined })).toBe(false)
  })
})
