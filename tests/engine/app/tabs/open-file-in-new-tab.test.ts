import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import { readFigFile } from '@open-pencil/core/io/formats/fig'
import * as figMod from '@open-pencil/core/io/formats/fig'
import * as layoutMod from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/scene-graph'

import { openRemoteFileFromPath } from '@/app/shell/menu/files'
import {
  createTab,
  getActiveStore,
  getTabsSnapshot,
  openFileInNewTab,
  switchTab,
  tabCount
} from '@/app/tabs'

function setupGlobals() {
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

function teardownGlobals() {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
}

function makeSaveHandle(name: string): FileSystemFileHandle {
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

function startDelayedFigOpen(path: string) {
  const started = Promise.withResolvers<undefined>()
  const read = Promise.withResolvers<SceneGraph>()
  ;(readFigFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
    started.resolve(undefined)
    return read.promise
  })
  return {
    opening: openFileInNewTab(new File([], 'incoming.fig'), undefined, path),
    read,
    started: started.promise
  }
}

describe('openFileInNewTab', () => {
  beforeEach(() => {
    setupGlobals()
    vi.clearAllMocks()
    vi.spyOn(layoutMod, 'computeAllLayouts').mockReturnValue(undefined)
    vi.spyOn(figMod, 'readFigFile').mockResolvedValue(new SceneGraph())
    createTab()
  })

  afterEach(() => {
    teardownGlobals()
    vi.restoreAllMocks()
  })

  test('does not reuse a tab that has a non-empty redo stack', async () => {
    const originalStore = getActiveStore()
    const initialTabCount = tabCount()
    originalStore.undo.apply({
      label: 'draw',
      forward: () => void 0,
      inverse: () => void 0
    })
    originalStore.undo.undo()
    expect(originalStore.undo.canRedo).toBe(true)

    ;(readFigFile as ReturnType<typeof vi.fn>).mockResolvedValue(new SceneGraph())
    await openFileInNewTab(new File([], 'file.fig'), undefined, '/new/file.fig')

    expect(tabCount()).toBe(initialTabCount + 1)
    expect(originalStore.getSourcePath()).toBeNull()
  })

  test('does not reuse an undo-empty tab whose graph contains user content', async () => {
    const originalStore = getActiveStore()
    const pageId = originalStore.graph.getPages()[0]?.id
    if (!pageId) throw new Error('Expected an initial page')
    const existing = originalStore.graph.createNode('RECTANGLE', pageId, {
      name: 'Untracked content',
      width: 10,
      height: 10
    })
    const initialTabCount = tabCount()

    expect(originalStore.undo.canUndo).toBe(false)
    await openFileInNewTab(new File([], 'other.fig'), undefined, '/content/other.fig')

    expect(tabCount()).toBe(initialTabCount + 1)
    expect(originalStore.graph.getNode(existing.id)).toBe(existing)
    expect(originalStore.getSourcePath()).toBeNull()
  })

  test('does not reuse a tab whose default page was renamed without undo history', async () => {
    const originalStore = getActiveStore()
    const originalPage = originalStore.graph.getPages()[0]
    if (!originalPage) throw new Error('Expected an initial page')
    const initialTabCount = tabCount()

    originalStore.renamePage(originalPage.id, 'User work')

    expect(originalStore.undo.canUndo).toBe(false)
    expect(originalStore.graph.nodes.size).toBe(2)
    await openFileInNewTab(new File([], 'other.fig'), undefined, '/content/page-edit.fig')

    expect(tabCount()).toBe(initialTabCount + 1)
    expect(originalStore.graph.getNode(originalPage.id)?.name).toBe('User work')
    expect(originalStore.getSourcePath()).toBeNull()
  })

  test('preserves a reused tab that changes while the FIG read is pending', async () => {
    const store = getActiveStore()
    const originalPage = store.graph.getPages()[0]
    if (!originalPage) throw new Error('Expected an initial page')
    const initialTabCount = tabCount()
    const { opening, read, started } = startDelayedFigOpen('/content/incoming.fig')
    await started
    store.renamePage(originalPage.id, 'Concurrent work')
    read.resolve(new SceneGraph())

    await expect(opening).rejects.toThrow('Open target changed while loading')
    expect(tabCount()).toBe(initialTabCount)
    expect(store.graph.getNode(originalPage.id)?.name).toBe('Concurrent work')
    expect(store.getSourcePath()).toBeNull()
    expect(store.state.documentName).toBe('Untitled')

    ;(readFigFile as ReturnType<typeof vi.fn>).mockResolvedValue(new SceneGraph())
    await openFileInNewTab(new File([], 'next.fig'), undefined, '/content/next.fig')

    expect(tabCount()).toBe(initialTabCount + 1)
    expect(store.graph.getNode(originalPage.id)?.name).toBe('Concurrent work')
  })

  test('does not overwrite a same-named Save As identity during a pending FIG read', async () => {
    const store = getActiveStore()
    const originalGraph = store.graph
    const initialTabCount = tabCount()
    const { opening, read, started } = startDelayedFigOpen('/content/incoming.fig')
    await started
    const savedHandle = makeSaveHandle('incoming.fig')
    window.showSaveFilePicker = vi.fn(async () => savedHandle)
    await store.saveFigFileAs()
    const reopeningSaved = openFileInNewTab(new File([], 'incoming.fig'), savedHandle)
    read.resolve(new SceneGraph())

    await expect(opening).rejects.toEqual(new Error('Open target changed while loading'))
    await expect(reopeningSaved).resolves.toBeUndefined()
    expect(readFigFile).toHaveBeenCalledTimes(1)
    expect(tabCount()).toBe(initialTabCount)
    expect(store.graph).toBe(originalGraph)
    expect(store.state.documentName).toBe('incoming')
    expect(store.getSourceHandle()).toBe(savedHandle)
    expect(store.getSourcePath()).toBeNull()
    store.dispose()
  })

  test('preserves a Save As identity when a pending reused FIG read fails', async () => {
    const store = getActiveStore()
    const failure = new Error('incoming read failed')
    const { opening, read, started } = startDelayedFigOpen('/content/incoming-failure.fig')
    await started
    const savedHandle = makeSaveHandle('incoming.fig')
    window.showSaveFilePicker = vi.fn(async () => savedHandle)
    await store.saveFigFileAs()
    read.reject(failure)

    await expect(opening).rejects.toBe(failure)
    expect(store.state.documentName).toBe('incoming')
    expect(store.getSourceHandle()).toBe(savedHandle)
    expect(store.getSourcePath()).toBeNull()
    store.dispose()
  })

  test('concurrent opens of different files can overlap I/O', async () => {
    // Explicit barriers prove both reads start before either can finish.
    let startedCount = 0
    let resolveBothStarted!: () => void
    const bothStarted = new Promise<void>((resolve) => {
      resolveBothStarted = resolve
    })
    let resolveProceed!: () => void
    const proceed = new Promise<void>((resolve) => {
      resolveProceed = resolve
    })

    ;(readFigFile as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      startedCount++
      if (startedCount === 2) resolveBothStarted()
      await proceed
      return new SceneGraph()
    })

    const done = Promise.all([
      openFileInNewTab(new File([], 'a.fig'), undefined, '/a.fig'),
      openFileInNewTab(new File([], 'b.fig'), undefined, '/b.fig')
    ])

    // Wait until both I/O operations are in-flight concurrently.
    await bothStarted
    expect(startedCount).toBe(2)

    // Release the mocks so the operations can complete.
    resolveProceed()
    const [first, second] = await done

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
  })

  test('shares one successful load for concurrent opens of the same path', async () => {
    const initialTabCount = tabCount()
    const readStarted = Promise.withResolvers<undefined>()
    const read = Promise.withResolvers<SceneGraph>()
    ;(readFigFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      readStarted.resolve(undefined)
      return read.promise
    })

    const first = openFileInNewTab(new File([], 'shared.fig'), undefined, '/shared.fig')
    await readStarted.promise
    const duplicate = openFileInNewTab(new File([], 'shared.fig'), undefined, '/shared.fig')
    read.resolve(new SceneGraph())
    await Promise.all([first, duplicate])

    expect(readFigFile).toHaveBeenCalledTimes(1)
    expect(tabCount()).toBe(initialTabCount)
    expect(getActiveStore().getSourcePath()).toBe('/shared.fig')
  })

  test('canonicalizes browser URL aliases without conflating query identities', async () => {
    const originalFetch = globalThis.fetch
    const initialTabCount = tabCount()
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), window.location.href)
      return {
        url: url.href,
        blob: async () => new Blob([])
      } as Response
    })

    try {
      await Promise.all([
        openRemoteFileFromPath('/tests/fixtures/gold-preview.fig'),
        openRemoteFileFromPath('./tests/fixtures/../fixtures/gold-preview.fig'),
        openRemoteFileFromPath('http://127.0.0.1:41731/tests/fixtures/gold-preview.fig')
      ])

      expect(readFigFile).toHaveBeenCalledTimes(1)
      expect(tabCount()).toBe(initialTabCount)
      expect(getActiveStore().getSourcePath()).toBe(
        'http://127.0.0.1:41731/tests/fixtures/gold-preview.fig'
      )
      expect(getActiveStore().getSourceFileName()).toBe('gold-preview.fig')

      await Promise.all([
        openRemoteFileFromPath('/tests/fixtures/gold-preview.fig?copy=1'),
        openRemoteFileFromPath(
          'http://127.0.0.1:41731/tests/fixtures/../fixtures/gold-preview.fig?copy=1'
        )
      ])

      expect(readFigFile).toHaveBeenCalledTimes(2)
      expect(tabCount()).toBe(initialTabCount + 1)
      expect(getActiveStore().getSourcePath()).toBe(
        'http://127.0.0.1:41731/tests/fixtures/gold-preview.fig?copy=1'
      )
      expect(getActiveStore().getSourceFileName()).toBe('gold-preview.fig')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('shares an in-flight duplicate failure without reading twice', async () => {
    const readStarted = Promise.withResolvers<undefined>()
    const read = Promise.withResolvers<SceneGraph>()
    const failure = new Error('shared read failed')
    ;(readFigFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      readStarted.resolve(undefined)
      return read.promise
    })

    const first = openFileInNewTab(
      new File([], 'shared-failure.fig'),
      undefined,
      '/concurrent/shared-failure.fig'
    )
    await readStarted.promise
    expect(getActiveStore().getSourcePath()).toBe('/concurrent/shared-failure.fig')
    const duplicate = openFileInNewTab(
      new File([], 'shared-failure.fig'),
      undefined,
      '/concurrent/shared-failure.fig'
    )
    const results = Promise.allSettled([first, duplicate])
    read.reject(failure)

    const settled = await results
    expect(settled).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure }
    ])
    expect(readFigFile).toHaveBeenCalledTimes(1)
  })

  test('does not reactivate an older reused tab after a newer tab action', async () => {
    const reusedStore = getActiveStore()
    const readStarted = Promise.withResolvers<undefined>()
    const read = Promise.withResolvers<SceneGraph>()
    ;(readFigFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      readStarted.resolve(undefined)
      return read.promise
    })

    const opening = openFileInNewTab(new File([], 'older.fig'), undefined, '/focus/older.fig')
    await readStarted.promise
    const newerStore = createTab().store
    read.resolve(new SceneGraph())
    await opening

    expect(getActiveStore()).toBe(newerStore)
    expect(reusedStore.getSourcePath()).toBe('/focus/older.fig')
  })

  test('does not activate an existing match resolved after a newer tab action', async () => {
    const existingStore = getActiveStore()
    const storedHandle = {
      name: 'existing.fig',
      isSameEntry: vi.fn(async () => false)
    } as FileSystemFileHandle
    existingStore.updateSourceIdentity('existing.fig', storedHandle)

    createTab()
    const comparisonStarted = Promise.withResolvers<undefined>()
    const comparison = Promise.withResolvers<boolean>()
    const incomingHandle = {
      name: 'existing.fig',
      isSameEntry: vi.fn(() => {
        comparisonStarted.resolve(undefined)
        return comparison.promise
      })
    } as FileSystemFileHandle

    const opening = openFileInNewTab(new File([], 'existing.fig'), incomingHandle)
    await comparisonStarted.promise
    const newerStore = createTab().store
    comparison.resolve(true)
    await opening

    expect(getActiveStore()).toBe(newerStore)
    expect(readFigFile).not.toHaveBeenCalled()
  })

  test('does not activate an existing match after the active tab changes away and back', async () => {
    const existingStore = getActiveStore()
    const storedHandle = {
      name: 'existing.fig',
      isSameEntry: vi.fn(async () => false)
    } as FileSystemFileHandle
    existingStore.updateSourceIdentity('existing.fig', storedHandle)

    const requestTab = createTab()
    const comparisonStarted = Promise.withResolvers<undefined>()
    const comparison = Promise.withResolvers<boolean>()
    const incomingHandle = {
      name: 'existing.fig',
      isSameEntry: vi.fn(() => {
        comparisonStarted.resolve(undefined)
        return comparison.promise
      })
    } as FileSystemFileHandle

    const opening = openFileInNewTab(new File([], 'existing.fig'), incomingHandle)
    await comparisonStarted.promise
    createTab()
    switchTab(requestTab.id)
    comparison.resolve(true)
    await opening

    expect(getActiveStore()).toBe(requestTab.store)
    expect(readFigFile).not.toHaveBeenCalled()
  })

  test('does not consume a newer pristine tab after a delayed identity miss', async () => {
    const existingStore = getActiveStore()
    const storedHandle = {
      name: 'stored.fig',
      isSameEntry: vi.fn(async () => false)
    } as FileSystemFileHandle
    existingStore.updateSourceIdentity('stored.fig', storedHandle)

    createTab()
    const comparisonStarted = Promise.withResolvers<undefined>()
    const comparison = Promise.withResolvers<boolean>()
    const incomingHandle = {
      kind: 'file',
      name: 'incoming.fig',
      getFile: vi.fn(async () => new File([], 'incoming.fig', { lastModified: 0 })),
      isSameEntry: vi.fn(() => {
        comparisonStarted.resolve(undefined)
        return comparison.promise
      })
    } as FileSystemFileHandle

    const opening = openFileInNewTab(new File([], 'incoming.fig'), incomingHandle)
    await comparisonStarted.promise
    const newerTab = createTab()
    comparison.resolve(false)
    await opening

    expect(getActiveStore()).toBe(newerTab.store)
    expect(newerTab.store.state.documentName).toBe('Untitled')
    expect(newerTab.store.getSourcePath()).toBeNull()
    expect(newerTab.store.getSourceHandle()).toBeNull()
    const owners = getTabsSnapshot().filter((tab) => tab.store.getSourceHandle() === incomingHandle)
    expect(owners).toHaveLength(1)
    expect(owners[0]?.store).not.toBe(newerTab.store)
    for (const owner of owners) owner.store.dispose()
  })

  test('routes HTML files through DOM import on the claimed tab', async () => {
    const store = getActiveStore()
    const openDOMFile = vi.spyOn(store, 'openDOMFile').mockResolvedValue(undefined)

    const file = new File(['<main>Hello</main>'], 'card.html', { type: 'text/html' })
    await openFileInNewTab(file, undefined, '/imports/card.html')

    expect(openDOMFile).toHaveBeenCalledWith(file, {
      beforeApply: expect.any(Function),
      beforeCommitSource: expect.any(Function),
      handle: undefined,
      path: '/imports/card.html'
    })
    expect(getActiveStore()).toBe(store)
    expect(store.getSourcePath()).toBe('/imports/card.html')
  })

  test('preserves a reused tab that changes while DOM conversion is pending', async () => {
    const store = getActiveStore()
    const originalPage = store.graph.getPages()[0]
    if (!originalPage) throw new Error('Expected an initial page')
    const conversionStarted = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    vi.spyOn(store, 'openDOMFile').mockImplementation(async (_file, options) => {
      conversionStarted.resolve(undefined)
      await proceed.promise
      const guardedOptions = options as typeof options & { beforeApply?: () => void }
      guardedOptions.beforeApply?.()
      store.replaceGraph(new SceneGraph())
    })

    const opening = openFileInNewTab(
      new File(['<main>Hello</main>'], 'card.html', { type: 'text/html' }),
      undefined,
      '/imports/concurrent-card.html'
    )
    await conversionStarted.promise
    store.renamePage(originalPage.id, 'Concurrent DOM work')
    proceed.resolve(undefined)

    await expect(opening).rejects.toThrow('Open target changed while loading')
    expect(store.graph.getNode(originalPage.id)?.name).toBe('Concurrent DOM work')
    expect(store.getSourcePath()).toBeNull()
    expect(store.state.documentName).toBe('Untitled')
  })

  describe('when the file read fails', () => {
    test('clears source identity and resets the name of a reused untouched tab', async () => {
      const store = getActiveStore()
      expect(store.state.documentName).toBe('Untitled')

      ;(readFigFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('read failed'))

      await expect(
        openFileInNewTab(new File([], 'file.fig'), undefined, '/failure/reused.fig')
      ).rejects.toThrow('read failed')

      expect(getActiveStore()).toBe(store)
      expect(store.getSourcePath()).toBeNull()
      expect(store.getSourceFileName()).toBeNull()
      expect(store.state.documentName).toBe('Untitled')
    })

    test('closes a freshly-created tab and leaves the original active tab unchanged', async () => {
      const originalStore = getActiveStore()
      originalStore.setDocumentSource('existing.fig', 'pen', undefined, '/existing.fig')

      expect(getActiveStore().getSourcePath()).toBe('/existing.fig')

      ;(readFigFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('read failed'))

      await expect(
        openFileInNewTab(new File([], 'file.fig'), undefined, '/failure/fresh.fig')
      ).rejects.toThrow('read failed')

      expect(getActiveStore()).toBe(originalStore)
      expect(originalStore.getSourcePath()).toBe('/existing.fig')
    })

    test('allows retrying the same file after a failed read', async () => {
      const store = getActiveStore()

      ;(readFigFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('read failed'))

      await expect(
        openFileInNewTab(new File([], 'file.fig'), undefined, '/failure/retry.fig')
      ).rejects.toThrow('read failed')

      expect(store.getSourcePath()).toBeNull()
      expect(store.state.documentName).toBe('Untitled')

      ;(readFigFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new SceneGraph())

      await openFileInNewTab(new File([], 'file.fig'), undefined, '/failure/retry.fig')

      expect(store.getSourcePath()).toBe('/failure/retry.fig')
      expect(store.state.documentName).toBe('file')
    })

    test('clears preclaimed source identity when DOM import fails', async () => {
      const store = getActiveStore()
      const file = new File(['<main>Broken</main>'], 'broken.html')
      vi.spyOn(file, 'text').mockRejectedValue(new Error('dom failed'))
      vi.spyOn(console, 'error').mockImplementation(() => undefined)

      await expect(openFileInNewTab(file, undefined, '/broken.html')).rejects.toThrow('dom failed')

      expect(getActiveStore()).toBe(store)
      expect(store.getSourcePath()).toBeNull()
      expect(store.getSourceFileName()).toBeNull()
      expect(store.state.documentName).toBe('Untitled')
    })

    test('restores the original graph and viewport after a late open failure', async () => {
      const store = getActiveStore()
      const originalGraph = store.graph
      const originalPageId = store.state.currentPageId
      const originalTabCount = tabCount()
      store.state.panX = 17
      store.state.panY = 23
      store.state.zoom = 1.75
      vi.spyOn(store, 'fitCurrentPageToViewport')
        .mockRejectedValueOnce(new Error('fit failed'))
        .mockResolvedValueOnce(undefined)

      await expect(
        openFileInNewTab(new File([], 'late.fig'), undefined, '/failure/late.fig')
      ).rejects.toThrow('fit failed')

      expect(store.graph).toBe(originalGraph)
      expect(store.state.currentPageId).toBe(originalPageId)
      expect(store.state.panX).toBe(17)
      expect(store.state.panY).toBe(23)
      expect(store.state.zoom).toBe(1.75)
      expect(store.getSourcePath()).toBeNull()
      expect(store.getDocumentFilePath()).toBeNull()
      expect(store.state.documentName).toBe('Untitled')

      await openFileInNewTab(new File([], 'late.fig'), undefined, '/failure/late.fig')

      expect(tabCount()).toBe(originalTabCount)
      expect(getActiveStore()).toBe(store)
      expect(store.getSourcePath()).toBe('/failure/late.fig')
    })
  })
})
