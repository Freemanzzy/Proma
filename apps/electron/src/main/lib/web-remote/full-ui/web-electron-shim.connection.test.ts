import { describe, expect, test } from 'bun:test'

type TestShim = typeof import('./web-electron-shim')

describe('Web Remote IPC connection coalescing', () => {
  test('an existing reconnect timer reuses a socket recreated by another caller', async () => {
    const globals = globalThis as typeof globalThis & { window?: Window; WebSocket?: typeof WebSocket }
    const previousWindow = globals.window
    const previousWebSocket = globals.WebSocket
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const instances: FakeSocket[] = []
    const fakeWindow = {
      location: { href: 'https://proma.example/app/' },
      localStorage: { getItem: () => null },
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      setTimeout: (callback: TimerHandler, delay?: number): number => {
        const timer = setTimeout(() => {
          timers.delete(timer)
          if (typeof callback === 'function') callback()
        }, delay)
        timers.add(timer)
        return timer as unknown as number
      },
      clearTimeout: (timer: number): void => {
        clearTimeout(timer)
        timers.delete(timer as unknown as ReturnType<typeof setTimeout>)
      },
    } as unknown as Window

    class FakeSocket {
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      constructor(readonly url: URL) { instances.push(this) }
      send(): void {}
      close(): void { this.readyState = 3; this.onclose?.() }
    }

    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: FakeSocket })
    try {
      const loadShim = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<TestShim>
      const shim = await loadShim(new URL(`./web-electron-shim.ts?connection-test=${Date.now()}`, import.meta.url).href)

      shim.ipcRenderer.on('first-listener', () => {})
      shim.ipcRenderer.on('second-listener', () => {})
      expect(instances).toHaveLength(1)
      const first = instances[0]!
      first.readyState = FakeSocket.OPEN
      first.onopen?.()

      // The original close schedules backoff. A request starts a replacement before it fires.
      first.readyState = 3
      first.onclose?.()
      shim.ipcRenderer.on('recovery-request', () => {})
      expect(instances).toHaveLength(2)
      await new Promise((resolve) => setTimeout(resolve, 350))
      expect(instances).toHaveLength(2)

      instances[1]!.readyState = 3
      instances[1]!.onclose?.()
    } finally {
      for (const timer of timers) clearTimeout(timer)
      if (previousWindow === undefined) delete (globalThis as { window?: Window }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
      if (previousWebSocket === undefined) delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
      else Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: previousWebSocket })
    }
  })
})
