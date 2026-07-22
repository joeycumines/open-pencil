import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import { readFigFile } from '@open-pencil/core/io/formats/fig'
import * as figMod from '@open-pencil/core/io/formats/fig'
import * as layoutMod from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/scene-graph'

import { openRemoteFileFromPath } from '@/app/shell/menu/files'
import { createTab, getActiveStore, openFileInNewTab, tabCount } from '@/app/tabs'

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

  test('concurrent opens of different files can overlap I/O', async () => {
    // Verify concurrency through explicit synchronization — no timing
    // thresholds, no Date.now(), no flakiness. The mock blocks each
    // readFigFile call on a shared `proceed` promise and signals a
    // `bothStarted` barrier when the second call enters. If the lock
    // incorrectly serialized I/O (not just identity resolution), the
    // second mock would never start before `proceed` resolves and
    // `bothStarted` would never fire.
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

  test('routes HTML files through DOM import on the claimed tab', async () => {
    const store = getActiveStore()
    const openDOMFile = vi.spyOn(store, 'openDOMFile').mockResolvedValue(undefined)

    const file = new File(['<main>Hello</main>'], 'card.html', { type: 'text/html' })
    await openFileInNewTab(file, undefined, '/imports/card.html')

    expect(openDOMFile).toHaveBeenCalledWith(file, {
      handle: undefined,
      path: '/imports/card.html'
    })
    expect(getActiveStore()).toBe(store)
    expect(store.getSourcePath()).toBe('/imports/card.html')
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
      store.state.panX = 17
      store.state.panY = 23
      store.state.zoom = 1.75
      vi.spyOn(store, 'fitCurrentPageToViewport').mockRejectedValue(new Error('fit failed'))

      await expect(
        openFileInNewTab(new File([], 'late.fig'), undefined, '/failure/late.fig')
      ).rejects.toThrow('fit failed')

      expect(store.graph).toBe(originalGraph)
      expect(store.state.currentPageId).toBe(originalPageId)
      expect(store.state.panX).toBe(17)
      expect(store.state.panY).toBe(23)
      expect(store.state.zoom).toBe(1.75)
      expect(store.getSourcePath()).toBeNull()
      expect(store.state.documentName).toBe('Untitled')
    })
  })
})
