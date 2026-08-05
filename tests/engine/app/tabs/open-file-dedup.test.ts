import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import * as figModule from '@open-pencil/core/io/formats/fig'
import * as layoutModule from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/scene-graph'

import { resolveBrowserFileURL } from '@/app/document/io/browser'
import { createTab, getActiveStore, openFileInNewTab, tabCount } from '@/app/tabs'
import { findExistingTab } from '@/app/tabs/identity'

function setupGlobals() {
  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    },
    cancelAnimationFrame: vi.fn(),
    openPencil: {},
    location: { href: 'http://localhost/' } as Location,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  } as Window & typeof globalThis
  globalThis.document = {
    fonts: { add: vi.fn(), ready: Promise.resolve() }
  } as Document
  globalThis.requestAnimationFrame = window.requestAnimationFrame
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame
}

function makeHandle(
  name: string,
  isSameEntry: (other: FileSystemFileHandle) => Promise<boolean>
): FileSystemFileHandle {
  return { kind: 'file', name, isSameEntry } as FileSystemFileHandle
}

describe('file identity', () => {
  test('matches equivalent handles without using file names as identity', async () => {
    const stored = makeHandle('design.fig', async () => false)
    // The incoming alias handle reports the stored handle as the same entry,
    // so the alias request finds the stored tab even though the names differ.
    const alias = makeHandle('alias.fig', async (other) => other.name === 'design.fig')
    const sameName = makeHandle('design.fig', async () => false)

    const storedTab = {
      store: {
        getSourceHandle: () => stored,
        getSourcePath: () => null,
        getFileHandle: () => null,
        getFilePath: () => null
      }
    }
    const sameNameTab = {
      store: {
        getSourceHandle: () => sameName,
        getSourcePath: () => null,
        getFileHandle: () => null,
        getFilePath: () => null
      }
    }

    // The stored handle reports the alias handle as the same entry, so the
    // alias request finds the stored tab even though the names differ.
    await expect(findExistingTab([storedTab], alias, undefined)).resolves.toBe(storedTab)
    // A different handle with the same name is not the same file.
    await expect(findExistingTab([storedTab], sameName, undefined)).resolves.toBeNull()
    await expect(
      findExistingTab([storedTab, sameNameTab], undefined, undefined)
    ).resolves.toBeNull()
  })

  test('finds a tab by path and ignores tabs without stable identity', async () => {
    const matched = {
      store: { getSourcePath: () => '/tmp/design.fig', getSourceHandle: () => null }
    }
    const unidentified = {
      store: {
        getSourcePath: () => null,
        getSourceHandle: () => null,
        getFilePath: () => null,
        getFileHandle: () => null
      }
    }

    await expect(
      findExistingTab([unidentified, matched], undefined, '/tmp/design.fig')
    ).resolves.toBe(matched)
    await expect(findExistingTab([unidentified], undefined, '/tmp/design.fig')).resolves.toBeNull()
    await expect(findExistingTab([unidentified], undefined, undefined)).resolves.toBeNull()
  })

  test('matches platform-equivalent path spellings', async () => {
    const matched = {
      store: { getSourcePath: () => '/tmp//design.fig/', getSourceHandle: () => null }
    }

    await expect(findExistingTab([matched], undefined, '/tmp/design.fig')).resolves.toBe(matched)
  })
})

describe('openFileInNewTab deduplication', () => {
  beforeEach(() => {
    setupGlobals()
    vi.spyOn(layoutModule, 'computeAllLayouts').mockReturnValue(undefined)
    vi.spyOn(figModule, 'readFigFile').mockResolvedValue(new SceneGraph())
    createTab()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  })

  test('canonicalizes browser URLs before using them as file identity', () => {
    expect(resolveBrowserFileURL('/design.fig#selection').href).toBe('http://localhost/design.fig')
  })

  test('activates the existing tab when the same path is opened again', async () => {
    const initialCount = tabCount()
    const file = new File([], 'design.fig')

    await openFileInNewTab(file, undefined, '/tmp/design.fig')
    const openedStore = getActiveStore()
    await openFileInNewTab(file, undefined, '/tmp/design.fig')

    expect(tabCount()).toBe(initialCount)
    expect(getActiveStore()).toBe(openedStore)
    expect(figModule.readFigFile).toHaveBeenCalledTimes(1)
  })

  test('shares one load between concurrent opens of the same path', async () => {
    const started = Promise.withResolvers<undefined>()
    const read = Promise.withResolvers<SceneGraph>()
    ;(figModule.readFigFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      started.resolve(undefined)
      return read.promise
    })
    const initialCount = tabCount()
    const file = new File([], 'concurrent.fig')

    const first = openFileInNewTab(file, undefined, '/tmp/concurrent.fig')
    await started.promise
    const second = openFileInNewTab(file, undefined, '/tmp/concurrent.fig')
    await Promise.resolve()

    expect(figModule.readFigFile).toHaveBeenCalledTimes(1)
    read.resolve(new SceneGraph())
    await Promise.all([first, second])
    expect(tabCount()).toBe(initialCount)
  })

  test('allows different files to load concurrently', async () => {
    const reads = [Promise.withResolvers<SceneGraph>(), Promise.withResolvers<SceneGraph>()]
    const bothStarted = Promise.withResolvers<undefined>()
    let readIndex = 0
    ;(figModule.readFigFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const read = reads[readIndex++]
      if (readIndex === 2) bothStarted.resolve(undefined)
      return read?.promise ?? Promise.resolve(new SceneGraph())
    })
    const initialCount = tabCount()

    const first = openFileInNewTab(new File([], 'first.fig'), undefined, '/tmp/first.fig')
    const second = openFileInNewTab(new File([], 'second.fig'), undefined, '/tmp/second.fig')
    await bothStarted.promise

    expect(figModule.readFigFile).toHaveBeenCalledTimes(2)
    reads[0].resolve(new SceneGraph())
    reads[1].resolve(new SceneGraph())
    await Promise.all([first, second])
    expect(tabCount()).toBe(initialCount + 1)
  })

  test('removes a failed pending open so the file can be retried', async () => {
    ;(figModule.readFigFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(new SceneGraph())

    await expect(
      openFileInNewTab(new File([], 'retry.fig'), undefined, '/tmp/retry.fig')
    ).rejects.toThrow('read failed')
    await expect(
      openFileInNewTab(new File([], 'retry.fig'), undefined, '/tmp/retry.fig')
    ).resolves.toBeUndefined()

    expect(figModule.readFigFile).toHaveBeenCalledTimes(2)
    expect(getActiveStore().getSourcePath()).toBe('/tmp/retry.fig')
  })

  test('keeps same-named files distinct without a path or handle', async () => {
    const initialCount = tabCount()
    const file = new File([], 'same-name.fig')

    await openFileInNewTab(file)
    await openFileInNewTab(file)

    expect(tabCount()).toBe(initialCount + 1)
    expect(figModule.readFigFile).toHaveBeenCalledTimes(2)
  })
})
