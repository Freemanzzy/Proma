import { describe, expect, test } from 'bun:test'

type TestShim = typeof import('./web-electron-shim')

class FakeSocket {
  static OPEN = 1
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  constructor(readonly url: URL) {}
  send(payload: string): void { this.sent.push(payload) }
  close(): void { this.readyState = 3; this.onclose?.() }
}

describe('Web Remote SDK history budgets', () => {
  test('uses 1 MiB by default, preserves earlier-page budget, and enforces data-saver budget', async () => {
    const globals = globalThis as typeof globalThis & { window?: Window; WebSocket?: typeof WebSocket }
    const previousWindow = globals.window
    const previousWebSocket = globals.WebSocket
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const sockets: FakeSocket[] = []
    let dataSaverOverride = 'off'
    const fakeWindow = {
      location: { href: 'https://proma.example/app/' },
      localStorage: { getItem: () => dataSaverOverride },
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      setTimeout: (callback: TimerHandler, delay?: number): number => {
        const timer = setTimeout(() => { timers.delete(timer); if (typeof callback === 'function') callback() }, delay)
        timers.add(timer)
        return timer as unknown as number
      },
      clearTimeout: (timer: number): void => { clearTimeout(timer as unknown as ReturnType<typeof setTimeout>); timers.delete(timer as unknown as ReturnType<typeof setTimeout>) },
    } as unknown as Window
    class Socket extends FakeSocket { constructor(url: URL) { super(url); sockets.push(this) } }

    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: Socket })
    const delayTurn = () => new Promise((resolve) => setTimeout(resolve, 0))
    const respond = (socket: FakeSocket, request: { id: string }, index: number) => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'response', id: request.id, ok: true, value: { __webRemoteHistoryWindow: true, messages: [{ index }], omittedCount: index, hasEarlier: index > 0, startIndex: index } }) })
    }
    try {
      const loadShim = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<TestShim>
      const shim = await loadShim(new URL(`./web-electron-shim.ts?history-budget=${Date.now()}`, import.meta.url).href)
      shim.ipcRenderer.on('history-budget-test', () => {})
      const socket = sockets[0]!
      socket.readyState = FakeSocket.OPEN
      socket.onopen?.()

      const initial = shim.ipcRenderer.invoke('agent:get-sdk-messages', 'session-test')
      await delayTurn()
      let invokes = socket.sent.map((line) => JSON.parse(line)).filter((frame) => frame.type === 'invoke' && frame.channel === 'agent:get-sdk-messages')
      expect(invokes[0]!.args[1]).toEqual({ budgetBytes: 1024 * 1024, inlineImageBudgetBytes: 1024 * 1024 })
      respond(socket, invokes[0]!, 0)
      await expect(initial).resolves.toEqual([{ index: 0 }])

      const earlier = shim.ipcRenderer.invoke('agent:get-sdk-messages', 'session-test', { endIndex: 10, budgetBytes: 2 * 1024 * 1024 })
      await delayTurn()
      invokes = socket.sent.map((line) => JSON.parse(line)).filter((frame) => frame.type === 'invoke' && frame.channel === 'agent:get-sdk-messages')
      expect(invokes[1]!.args[1]).toEqual({ endIndex: 10, budgetBytes: 2 * 1024 * 1024, inlineImageBudgetBytes: 1024 * 1024 })
      respond(socket, invokes[1]!, 10)
      await expect(earlier).resolves.toEqual([{ index: 10 }])

      dataSaverOverride = 'on'
      const saver = shim.ipcRenderer.invoke('agent:get-sdk-messages', 'session-test')
      await delayTurn()
      invokes = socket.sent.map((line) => JSON.parse(line)).filter((frame) => frame.type === 'invoke' && frame.channel === 'agent:get-sdk-messages')
      expect(invokes[2]!.args[1]).toEqual({ budgetBytes: 256 * 1024, inlineImageBudgetBytes: 0 })
      respond(socket, invokes[2]!, 0)
      await expect(saver).resolves.toEqual([{ index: 0 }])
      socket.close()
    } finally {
      for (const timer of timers) clearTimeout(timer)
      if (previousWindow === undefined) delete (globalThis as { window?: Window }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
      if (previousWebSocket === undefined) delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
      else Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: previousWebSocket })
    }
  })
})
