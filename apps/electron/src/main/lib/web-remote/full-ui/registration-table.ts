export class WebRemoteRegistrationTable<Handler> {
  private readonly handlers = new Map<string, Handler>()

  set(channel: string, handler: Handler): void { this.handlers.set(channel, handler) }
  get(channel: string): Handler | undefined { return this.handlers.get(channel) }
  keys(): IterableIterator<string> { return this.handlers.keys() }
  get size(): number { return this.handlers.size }
}
