import { describe, expect, test } from 'bun:test'
import { copyTextToClipboard } from './clipboard'

describe('消息文本复制', () => {
  test('优先使用 Electron 主进程剪贴板', async () => {
    const calls: string[] = []

    await copyTextToClipboard('消息内容', {
      native: async (text) => { calls.push(`native:${text}`) },
      browser: async (text) => { calls.push(`browser:${text}`) },
    })

    expect(calls).toEqual(['native:消息内容'])
  })

  test('主进程复制失败时回退到 renderer 剪贴板', async () => {
    const calls: string[] = []

    await copyTextToClipboard('消息内容', {
      native: async () => { throw new Error('native clipboard unavailable') },
      browser: async (text) => { calls.push(`browser:${text}`) },
    })

    expect(calls).toEqual(['browser:消息内容'])
  })

  test('没有可用剪贴板实现时抛出错误', async () => {
    await expect(copyTextToClipboard('消息内容', {})).rejects.toThrow('当前环境不支持写入剪贴板')
  })

  test('Web Remote 不走主进程（手机端主进程剪贴板无用且被拒绝），直接用浏览器剪贴板', async () => {
    const calls: string[] = []
    await copyTextToClipboard('代码', {
      webRemote: true,
      native: async (text) => { calls.push(`native:${text}`) },
      browser: async (text) => { calls.push(`browser:${text}`) },
      legacy: (text) => { calls.push(`legacy:${text}`); return true },
    })
    expect(calls).toEqual(['browser:代码'])
  })

  test('Web Remote 浏览器剪贴板失败时用 execCommand 兜底', async () => {
    const calls: string[] = []
    await copyTextToClipboard('代码', {
      webRemote: true,
      native: async (text) => { calls.push(`native:${text}`) },
      browser: async () => { throw new Error('NotAllowedError') },
      legacy: (text) => { calls.push(`legacy:${text}`); return true },
    })
    expect(calls).toEqual(['legacy:代码'])
  })

  test('Web Remote 没有浏览器剪贴板时直接用 execCommand', async () => {
    const calls: string[] = []
    await copyTextToClipboard('代码', {
      webRemote: true,
      legacy: (text) => { calls.push(`legacy:${text}`); return true },
    })
    expect(calls).toEqual(['legacy:代码'])
  })

  test('Web Remote 全部失败时抛错，不能假装复制成功', async () => {
    let nativeCalled = false
    await expect(copyTextToClipboard('代码', {
      webRemote: true,
      native: async () => { nativeCalled = true },
      browser: async () => { throw new Error('NotAllowedError') },
      legacy: () => false,
    })).rejects.toThrow('复制失败')
    expect(nativeCalled).toBe(false)
  })
})

