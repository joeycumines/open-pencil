import { expect, spyOn, test } from 'bun:test'

import { connectAutomation } from '@/app/automation/bridge/server'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  sent: string[] = []
  closeCalls = 0

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closeCalls += 1
  }
}

test('reconnects quiet normal closes without letting stale sockets replace successors', () => {
  const originalWebSocket = globalThis.WebSocket
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const scheduled: Array<() => void> = []
  const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
  const debug = spyOn(console, 'debug').mockImplementation(() => undefined)

  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket,
    writable: true
  })
  globalThis.setTimeout = ((handler: TimerHandler) => {
    if (typeof handler !== 'function') throw new TypeError('Expected timer callback')
    scheduled.push(handler)
    return scheduled.length
  }) as typeof setTimeout
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout
  FakeWebSocket.instances = []

  try {
    const connection = connectAutomation(() => {
      throw new Error('No automation request expected')
    }, 'test-token')
    const first = FakeWebSocket.instances[0]
    if (!first?.onclose) throw new Error('Expected first WebSocket close handler')

    first.onclose({ code: 1000, reason: 'server restart' } as CloseEvent)
    expect(debug).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(1)

    scheduled.shift()?.()
    const second = FakeWebSocket.instances[1]
    expect(second?.url).toBe('ws://127.0.0.1:7600')

    first.onclose({ code: 1006, reason: 'stale close' } as CloseEvent)
    expect(scheduled).toHaveLength(0)
    expect(FakeWebSocket.instances).toHaveLength(2)

    connection.disconnect()
    expect(second?.closeCalls).toBe(1)
  } finally {
    globalThis.WebSocket = originalWebSocket
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
    warn.mockRestore()
    debug.mockRestore()
  }
})
