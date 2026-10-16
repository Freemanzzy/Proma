import { describe, expect, test } from 'bun:test'
import { decodeBase64ToBytes, getWebRemoteFileMimeType, WEB_REMOTE_FILE_MAX_BYTES } from './web-remote-file-utils'

describe('Web Remote 文件预览字节工具', () => {
  test('解码 base64 保留文件原始字节', () => {
    expect([...decodeBase64ToBytes('JVBERi0xLjQ=')]).toEqual([37, 80, 68, 70, 45, 49, 46, 52])
  })

  test('下载与 PDF 预览读取上限为 50 MiB', () => {
    expect(WEB_REMOTE_FILE_MAX_BYTES).toBe(50 * 1024 * 1024)
  })

  test('按扩展名设置常见文件 MIME，未知扩展使用二进制类型', () => {
    expect(getWebRemoteFileMimeType('sample.pdf')).toBe('application/pdf')
    expect(getWebRemoteFileMimeType('sample.yaml')).toBe('text/yaml;charset=utf-8')
    expect(getWebRemoteFileMimeType('sample.bin')).toBe('application/octet-stream')
  })
})
