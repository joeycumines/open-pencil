import { vi } from 'bun:test'

export function setupTabsTestGlobals() {
  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    },
    cancelAnimationFrame: vi.fn(),
    openPencil: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: { href: 'http://127.0.0.1:41731/' } as Location
  } as Window & typeof globalThis

  globalThis.document = {
    fonts: { add: vi.fn(), ready: Promise.resolve() }
  } as Document

  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame
  globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame
}

export function teardownTabsTestGlobals() {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
}

export function makeSaveHandle(name: string): FileSystemFileHandle {
  const handle = {
    kind: 'file',
    name,
    createWritable: vi.fn(async () => {
      return {
        write: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined)
      } as FileSystemWritableFileStream
    }),
    getFile: vi.fn(async () => new File([], name, { lastModified: 0 })),
    isSameEntry: vi.fn(async (other: FileSystemFileHandle) => other === handle)
  } as FileSystemFileHandle
  return handle
}
