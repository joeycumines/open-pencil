import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import { readFigFile } from '@open-pencil/core/io/formats/fig'
import * as figMod from '@open-pencil/core/io/formats/fig'
import * as layoutMod from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/scene-graph'

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

  test('preserves a page edit made after DOM apply when later work fails', async () => {
    const store = getActiveStore()
    const imported = new SceneGraph()
    const importedPage = imported.getPages()[0]
    if (!importedPage) throw new Error('Expected an imported page')
    const failure = new Error('DOM post-apply work failed')
    const applied = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    vi.spyOn(store, 'openDOMFile').mockImplementation(async (_file, options) => {
      const guarded = options as typeof options & {
        beforeSetDocumentName?: () => void
      }
      guarded.beforeApply?.()
      store.replaceGraph(imported)
      guarded.beforeSetDocumentName?.()
      store.state.documentName = 'card'
      applied.resolve(undefined)
      await proceed.promise
      throw failure
    })

    const opening = openFileInNewTab(
      new File(['<main>Hello</main>'], 'card.html', { type: 'text/html' }),
      undefined,
      '/card.html'
    )
    await applied.promise
    store.renamePage(importedPage.id, 'Concurrent imported work')
    proceed.resolve(undefined)

    await expect(opening).rejects.toBe(failure)
    expect(store.graph).toBe(imported)
    expect(store.graph.getNode(importedPage.id)?.name).toBe('Concurrent imported work')
    expect(store.getSourcePath()).toBeNull()
    expect(store.getSourceFileName()).toBeNull()
  })
})
