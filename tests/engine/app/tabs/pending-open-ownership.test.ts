import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { readFigFile } from '@open-pencil/core/io/formats/fig'
import * as figMod from '@open-pencil/core/io/formats/fig'
import * as layoutMod from '@open-pencil/core/layout'
import * as domCssBrowser from '@open-pencil/dom-css/browser'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createDOMOpenActions } from '@/app/document/io/dom'
import { createTab, getActiveStore, getTabsSnapshot, openFileInNewTab, tabCount } from '@/app/tabs'

import { makeSaveHandle, setupTabsTestGlobals, teardownTabsTestGlobals } from './helpers'

function startFreshDelayedFigOpen(fileName = 'incoming.fig', path = '/incoming.fig') {
  const originalStore = getActiveStore()
  originalStore.setDocumentSource('existing.fig', 'fig', undefined, '/existing.fig')
  const started = Promise.withResolvers<undefined>()
  const read = Promise.withResolvers<SceneGraph>()
  ;(readFigFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
    started.resolve(undefined)
    return read.promise
  })
  return {
    opening: openFileInNewTab(new File([], fileName), undefined, path),
    originalStore,
    read,
    started: started.promise
  }
}

describe('pending open ownership', () => {
  beforeEach(() => {
    setupTabsTestGlobals()
    vi.clearAllMocks()
    vi.spyOn(layoutMod, 'computeAllLayouts').mockReturnValue(undefined)
    vi.spyOn(figMod, 'readFigFile').mockResolvedValue(new SceneGraph())
    createTab()
  })

  afterEach(() => {
    teardownTabsTestGlobals()
    vi.restoreAllMocks()
  })

  test('preserves a planned writable target acquired during a pending reused open', async () => {
    const store = getActiveStore()
    const originalGraph = store.graph
    const started = Promise.withResolvers<undefined>()
    const read = Promise.withResolvers<SceneGraph>()
    ;(readFigFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      started.resolve(undefined)
      return read.promise
    })

    const opening = openFileInNewTab(
      new File([], 'incoming.fig'),
      undefined,
      '/content/incoming.fig'
    )
    await started.promise
    store.setPlannedFilePath('/planned/incoming.fig')
    const newerStore = createTab().store
    const duplicateOutcome = openFileInNewTab(
      new File([], 'incoming.fig'),
      undefined,
      '/content/incoming.fig'
    ).then(
      () => undefined,
      (error: unknown) => error
    )
    read.resolve(new SceneGraph())

    await expect(opening).rejects.toEqual(new Error('Open target changed while loading'))
    expect(getActiveStore()).toBe(newerStore)
    expect(await duplicateOutcome).toEqual(new Error('Open target changed while loading'))
    expect(store.graph).toBe(originalGraph)
    expect(store.getDocumentFilePath()).toBe('/planned/incoming.fig')
    expect(store.getSourcePath()).toBeNull()
    expect(store.state.documentName).toBe('incoming')
  })

  test('does not overwrite Save As identity on a fresh owner when its FIG read succeeds', async () => {
    const initialTabCount = tabCount()
    const { opening, read, started } = startFreshDelayedFigOpen()
    await started
    const savedStore = getActiveStore()
    const savedHandle = makeSaveHandle('incoming.fig')
    window.showSaveFilePicker = vi.fn(async () => savedHandle)
    await savedStore.saveFigFileAs()
    const reopeningSaved = openFileInNewTab(new File([], 'incoming.fig'), savedHandle)
    read.resolve(new SceneGraph())

    await expect(opening).rejects.toEqual(new Error('Open target changed while loading'))
    await expect(reopeningSaved).resolves.toBeUndefined()
    expect(tabCount()).toBe(initialTabCount + 1)
    expect(getActiveStore()).toBe(savedStore)
    expect(savedStore.getSourceHandle()).toBe(savedHandle)
    expect(savedStore.getSourcePath()).toBeNull()
  })

  test('does not close a fresh owner after Save As when its FIG read fails', async () => {
    const initialTabCount = tabCount()
    const failure = new Error('incoming read failed')
    const { opening, read, started } = startFreshDelayedFigOpen(
      'fresh-failure.fig',
      '/fresh-failure.fig'
    )
    await started
    const savedStore = getActiveStore()
    const savedHandle = makeSaveHandle('fresh-failure.fig')
    window.showSaveFilePicker = vi.fn(async () => savedHandle)
    await savedStore.saveFigFileAs()
    read.reject(failure)

    await expect(opening).rejects.toBe(failure)
    expect(tabCount()).toBe(initialTabCount + 1)
    expect(getTabsSnapshot().some((tab) => tab.store === savedStore)).toBe(true)
    expect(savedStore.getSourceHandle()).toBe(savedHandle)
    expect(savedStore.getSourcePath()).toBeNull()
  })

  test('preserves a fresh owner page edit when its FIG read succeeds', async () => {
    const initialTabCount = tabCount()
    const { opening, read, started } = startFreshDelayedFigOpen('fresh-edit.fig', '/fresh-edit.fig')
    await started
    const owner = getActiveStore()
    const page = owner.graph.getPages()[0]
    if (!page) throw new Error('Expected a fresh owner page')
    owner.renamePage(page.id, 'Concurrent fresh work')
    read.resolve(new SceneGraph())

    await expect(opening).rejects.toEqual(new Error('Open target changed while loading'))
    expect(tabCount()).toBe(initialTabCount + 1)
    expect(getTabsSnapshot().some((tab) => tab.store === owner)).toBe(true)
    expect(owner.graph.getNode(page.id)?.name).toBe('Concurrent fresh work')
    expect(owner.getSourcePath()).toBeNull()
    expect(owner.state.documentName).toBe('Untitled')
  })

  test('preserves a fresh owner page edit when its FIG read fails', async () => {
    const initialTabCount = tabCount()
    const failure = new Error('fresh edited read failed')
    const { opening, read, started } = startFreshDelayedFigOpen(
      'fresh-edit-failure.fig',
      '/fresh-edit-failure.fig'
    )
    await started
    const owner = getActiveStore()
    const page = owner.graph.getPages()[0]
    if (!page) throw new Error('Expected a fresh owner page')
    owner.renamePage(page.id, 'Concurrent failed work')
    read.reject(failure)

    await expect(opening).rejects.toBe(failure)
    expect(tabCount()).toBe(initialTabCount + 1)
    expect(getTabsSnapshot().some((tab) => tab.store === owner)).toBe(true)
    expect(owner.graph.getNode(page.id)?.name).toBe('Concurrent failed work')
    expect(owner.getSourcePath()).toBeNull()
    expect(owner.state.documentName).toBe('Untitled')
  })

  test('preserves an imported page edit made while FIG page setup is pending', async () => {
    const store = getActiveStore()
    const imported = new SceneGraph()
    const importedPage = imported.getPages()[0]
    if (!importedPage) throw new Error('Expected an imported page')
    const pageSetupStarted = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    const switchPage = store.switchPage
    vi.spyOn(store, 'switchPage').mockImplementation(async (...args) => {
      pageSetupStarted.resolve(undefined)
      await proceed.promise
      await switchPage(...args)
    })
    const failure = new Error('FIG fit failed after page setup')
    vi.spyOn(store, 'fitCurrentPageToViewport').mockRejectedValue(failure)
    ;(readFigFile as ReturnType<typeof vi.fn>).mockResolvedValue(imported)

    const opening = openFileInNewTab(
      new File([], 'pending-page.fig'),
      undefined,
      '/pending-page.fig'
    )
    await pageSetupStarted.promise
    expect(store.graph).toBe(imported)
    store.renamePage(importedPage.id, 'Concurrent imported work')
    proceed.resolve(undefined)

    await expect(opening).rejects.toEqual(new Error('Open target changed while loading'))
    expect(store.graph).toBe(imported)
    expect(store.graph.getNode(importedPage.id)?.name).toBe('Concurrent imported work')
    expect(store.getSourcePath()).toBeNull()
    expect(store.getSourceFileName()).toBeNull()
  })

  test('preserves a node edit made while FIG page setup is pending', async () => {
    const store = getActiveStore()
    const imported = new SceneGraph()
    const importedPage = imported.getPages()[0]
    if (!importedPage) throw new Error('Expected an imported page')
    const rectangle = imported.createNode('RECTANGLE', importedPage.id, {
      width: 10,
      height: 10
    })
    const pageSetupStarted = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    const switchPage = store.switchPage
    vi.spyOn(store, 'switchPage').mockImplementation(async (...args) => {
      pageSetupStarted.resolve(undefined)
      await proceed.promise
      await switchPage(...args)
    })
    const failure = new Error('FIG fit failed after node edit')
    vi.spyOn(store, 'fitCurrentPageToViewport').mockRejectedValue(failure)
    ;(readFigFile as ReturnType<typeof vi.fn>).mockResolvedValue(imported)

    const opening = openFileInNewTab(
      new File([], 'pending-color.fig'),
      undefined,
      '/pending-color.fig'
    )
    await pageSetupStarted.promise
    store.updateNode(rectangle.id, { opacity: 0.5 })
    proceed.resolve(undefined)

    await expect(opening).rejects.toEqual(new Error('Open target changed while loading'))
    expect(store.graph).toBe(imported)
    expect(store.graph.getNode(rectangle.id)?.opacity).toBe(0.5)
    expect(store.getSourcePath()).toBeNull()
    expect(store.getSourceFileName()).toBeNull()
  })

  test('does not close a fresh owner saved to its exact preclaimed handle', async () => {
    const originalStore = getActiveStore()
    originalStore.setDocumentSource('existing.fig', 'fig', undefined, '/existing.fig')
    const initialTabCount = tabCount()
    const failure = new Error('exact handle read failed')
    const savedHandle = makeSaveHandle('incoming.fig')
    const started = Promise.withResolvers<undefined>()
    const read = Promise.withResolvers<SceneGraph>()
    ;(readFigFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      started.resolve(undefined)
      return read.promise
    })

    const opening = openFileInNewTab(new File([], 'incoming.fig'), savedHandle)
    await started.promise
    const savedStore = getActiveStore()
    window.showSaveFilePicker = vi.fn(async () => savedHandle)
    await savedStore.saveFigFileAs()
    const reopeningSaved = openFileInNewTab(new File([], 'incoming.fig'), savedHandle)
    read.reject(failure)

    await expect(opening).rejects.toBe(failure)
    await expect(reopeningSaved).resolves.toBeUndefined()
    expect(tabCount()).toBe(initialTabCount + 1)
    expect(getTabsSnapshot().some((tab) => tab.store === savedStore)).toBe(true)
    expect(savedStore.getSourceHandle()).toBe(savedHandle)
    expect(savedStore.getSourcePath()).toBeNull()
    expect(savedStore.state.documentName).toBe('incoming')
  })

  test('activates a newer duplicate retry after failed-owner rollback', async () => {
    const originalStore = getActiveStore()
    const originalHandle = makeSaveHandle('original.fig')
    originalStore.setDocumentSource('original.fig', 'fig', originalHandle)
    const incomingHandle = makeSaveHandle('incoming.fig')
    const rollbackComparisonStarted = Promise.withResolvers<undefined>()
    const releaseRollbackComparison = Promise.withResolvers<boolean>()
    let holdRollbackComparison = false
    let rollbackComparisonHeld = false
    incomingHandle.isSameEntry = vi.fn((other) => {
      if (holdRollbackComparison && !rollbackComparisonHeld && other === originalHandle) {
        rollbackComparisonHeld = true
        rollbackComparisonStarted.resolve(undefined)
        return releaseRollbackComparison.promise
      }
      return Promise.resolve(false)
    })
    const firstReadStarted = Promise.withResolvers<undefined>()
    const firstRead = Promise.withResolvers<SceneGraph>()
    ;(readFigFile as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => {
        firstReadStarted.resolve(undefined)
        return firstRead.promise
      })
      .mockResolvedValueOnce(new SceneGraph())
    const failure = new Error('first incoming read failed')

    const first = openFileInNewTab(new File([], 'incoming.fig'), incomingHandle)
    await firstReadStarted.promise
    holdRollbackComparison = true
    firstRead.reject(failure)
    await rollbackComparisonStarted.promise
    const retry = openFileInNewTab(new File([], 'incoming.fig'), incomingHandle)
    releaseRollbackComparison.resolve(false)

    await expect(first).rejects.toBe(failure)
    await expect(retry).resolves.toBeUndefined()
    const incomingTabs = getTabsSnapshot().filter(
      (tab) => tab.store.getSourceHandle() === incomingHandle
    )
    expect(incomingTabs).toHaveLength(1)
    expect(getActiveStore()).toBe(incomingTabs[0]?.store)
  })

  test('preserves Save As name and identity during post-apply DOM work', async () => {
    const store = getActiveStore()
    const imported = new SceneGraph()
    const afterApply = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    vi.spyOn(store, 'openDOMFile').mockImplementation(async (file, options) => {
      const guarded = options as typeof options & {
        beforeSetDocumentName?: () => void
      }
      guarded.beforeApply?.()
      store.replaceGraph(imported)
      afterApply.resolve(undefined)
      await proceed.promise
      guarded.beforeSetDocumentName?.()
      store.state.documentName = 'card'
      guarded.beforeCommitSource?.()
      store.setDocumentSource(file.name, 'html', options.handle, options.path)
    })

    const opening = openFileInNewTab(
      new File(['<main>Hello</main>'], 'card.html', { type: 'text/html' }),
      undefined,
      '/card.html'
    )
    await afterApply.promise
    const savedHandle = makeSaveHandle('saved.fig')
    window.showSaveFilePicker = vi.fn(async () => savedHandle)
    await store.saveFigFileAs()
    proceed.resolve(undefined)

    await expect(opening).rejects.toEqual(new Error('Open target changed while loading'))
    expect(store.graph).toBe(imported)
    expect(store.state.documentName).toBe('saved')
    expect(store.getSourceHandle()).toBe(savedHandle)
    expect(store.getSourcePath()).toBeNull()
  })

  test('restores a reused tab when DOM post-apply work fails', async () => {
    const store = getActiveStore()
    const originalGraph = store.graph
    const failure = new Error('DOM fit failed')
    vi.spyOn(store, 'openDOMFile').mockImplementation(async (_file, options) => {
      options.beforeApply?.()
      store.replaceGraph(new SceneGraph())
      store.state.documentName = 'card'
      throw failure
    })

    await expect(
      openFileInNewTab(
        new File(['<main>Hello</main>'], 'card.html', { type: 'text/html' }),
        undefined,
        '/card.html'
      )
    ).rejects.toBe(failure)
    expect(store.graph).toBe(originalGraph)
    expect(store.state.documentName).toBe('Untitled')
    expect(store.getSourcePath()).toBeNull()
    expect(store.getSourceFileName()).toBeNull()
  })

  test('opens through the real DOM pipeline while page setup remains owned', async () => {
    const store = getActiveStore()
    const imported = new SceneGraph()
    vi.spyOn(domCssBrowser, 'browserHTMLToSceneGraph').mockResolvedValue(imported)

    await expect(
      openFileInNewTab(
        new File(['<main>Hello</main>'], 'card.html', { type: 'text/html' }),
        undefined,
        '/card.html'
      )
    ).resolves.toBeUndefined()

    expect(store.graph).toBe(imported)
    expect(store.getSourcePath()).toBe('/card.html')
    expect(store.getSourceFileName()).toBe('card.html')
  })

  test('keeps unguarded DOM import rendering after viewport fitting', async () => {
    const editor = createEditor()
    const order: string[] = []
    const requestRender = vi.spyOn(editor, 'requestRender').mockImplementation(() => {
      order.push('render')
    })
    const { importDOMText } = createDOMOpenActions({
      editor,
      state: editor.state,
      setDocumentSource: vi.fn(),
      fitCurrentPageToViewport: vi.fn(async () => {
        order.push('fit')
      })
    })
    vi.spyOn(domCssBrowser, 'browserHTMLToSceneGraph').mockResolvedValue(new SceneGraph())

    await importDOMText('<main>Hello</main>')

    expect(requestRender).toHaveBeenCalled()
    expect(order.slice(-2)).toEqual(['fit', 'render'])
  })

  test('preserves a node edit through real DOM page setup', async () => {
    const imported = new SceneGraph()
    const importedPage = imported.getPages()[0]
    if (!importedPage) throw new Error('Expected an imported page')
    const rectangle = imported.createNode('RECTANGLE', importedPage.id, {
      width: 10,
      height: 10
    })
    imported.createNode('TEXT', importedPage.id, {
      text: 'Deferred',
      fontFamily: 'Deferred DOM Font',
      width: 80,
      height: 20
    })
    const fontLoadStarted = Promise.withResolvers<undefined>()
    const fontLoad = Promise.withResolvers<ArrayBuffer | null>()
    const editor = createEditor({
      loadFont: async () => {
        fontLoadStarted.resolve(undefined)
        return fontLoad.promise
      }
    })
    const setDocumentSource = vi.fn()
    const { openDOMFile } = createDOMOpenActions({
      editor,
      state: editor.state,
      setDocumentSource,
      fitCurrentPageToViewport: vi.fn(async () => undefined)
    })
    let installedGraph: SceneGraph | null = null
    let installedSceneVersion = -1
    let installedUndo = false
    let installedRedo = false
    const captureInstalledState = () => {
      installedGraph = editor.graph
      installedSceneVersion = editor.state.sceneVersion
      installedUndo = editor.undo.canUndo
      installedRedo = editor.undo.canRedo
    }
    const requireInstalledState = () => {
      if (
        editor.graph !== installedGraph ||
        editor.state.sceneVersion !== installedSceneVersion ||
        editor.undo.canUndo !== installedUndo ||
        editor.undo.canRedo !== installedRedo
      ) {
        throw new Error('Open target changed while loading')
      }
    }
    vi.spyOn(domCssBrowser, 'browserHTMLToSceneGraph').mockResolvedValue(imported)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const opening = openDOMFile(
      new File(['<main>Hello</main>'], 'card.html', { type: 'text/html' }),
      {
        afterGraphReplace: captureInstalledState,
        beforePageSetupFinalize: requireInstalledState,
        path: '/card.html'
      }
    )
    await fontLoadStarted.promise
    expect(editor.graph).toBe(imported)
    editor.updateNode(rectangle.id, { opacity: 0.5 })
    fontLoad.resolve(new ArrayBuffer(8))

    await expect(opening).rejects.toEqual(new Error('Open target changed while loading'))
    expect(editor.graph).toBe(imported)
    expect(editor.graph.getNode(rectangle.id)?.opacity).toBe(0.5)
    expect(editor.state.documentName).toBe('Untitled')
    expect(setDocumentSource).not.toHaveBeenCalled()
  })
})
