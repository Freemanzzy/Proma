export class WebRemoteRegistrationTable<Handler> {
  private readonly handlers = new Map<string, Handler>()

  set(channel: string, handler: Handler): void { this.handlers.set(channel, handler) }
  get(channel: string): Handler | undefined { return this.handlers.get(channel) }
  get size(): number { return this.handlers.size }
}
