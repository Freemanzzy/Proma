export const WEB_REMOTE_FILE_MAX_BYTES = 50 * 1024 * 1024

const MIME_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  txt: 'text/plain;charset=utf-8', md: 'text/markdown;charset=utf-8', markdown: 'text/markdown;charset=utf-8', yaml: 'text/yaml;charset=utf-8', yml: 'text/yaml;charset=utf-8',
  json: 'application/json', csv: 'text/csv;charset=utf-8', html: 'text/html;charset=utf-8', xml: 'application/xml', zip: 'application/zip',
}

export function getWebRemoteFileMimeType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return MIME_TYPES[extension] ?? 'application/octet-stream'
}

export function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
