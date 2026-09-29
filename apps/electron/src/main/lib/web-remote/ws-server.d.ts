declare module 'ws' {
  import { EventEmitter } from 'node:events'
  import type { IncomingMessage } from 'node:http'
  import type { Duplex } from 'node:stream'

  export class WebSocketServer extends EventEmitter {
    constructor(options: {
      noServer: boolean
      perMessageDeflate?: {
        threshold?: number
        serverNoContextTakeover?: boolean
        clientNoContextTakeover?: boolean
        concurrencyLimit?: number
      }
    })
    handleUpgrade(
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (client: WebSocket) => void,
    ): void
    close(callback?: (error?: Error) => void): void
  }
}
