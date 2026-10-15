type AttachmentReadApi = Pick<typeof window.electronAPI, 'readAttachment' | 'readBinaryBase64'>

/** Desktop preserves the original attachment IPC; Web Remote uses the session-authorized file reader. */
export function readAttachedImageBase64(
  api: AttachmentReadApi,
  filePath: string,
  sessionId: string | null,
  isWebRemote: boolean,
): Promise<string | null> {
  if (isWebRemote) {
    return api.readBinaryBase64(filePath, { sessionId: sessionId || undefined })
  }
  return api.readAttachment(filePath)
}
