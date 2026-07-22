import { shallowRef, computed, triggerRef } from 'vue'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { readFigFile } from '@open-pencil/core/io/formats/fig'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { setOpenPencilStore } from '@/app/browser-bridge'
import { yieldToUI } from '@/app/document/io/browser'
import { setActiveEditorStore } from '@/app/editor/active-store'
import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import { createFileOpenLock } from '@/app/tabs/identity'

export interface Tab {
  id: string
  store: EditorStore
}

const io = new IORegistry(BUILTIN_IO_FORMATS)

const fileOpenLock = createFileOpenLock(() => tabsRef.value)
const openAttemptsByTabId = new Map<string, OpenAttempt>()

type OpenAttempt = {
  outcome: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

type OpenRollbackState = {
  graph: SceneGraph
  currentPageId: string
  enteredContainerId: string | null
  documentName: string
  loading: boolean
  pageColor: EditorStore['state']['pageColor']
  panX: number
  panY: number
  zoom: number
}

type OpenDecision =
  | { kind: 'existing' }
  | { kind: 'join'; outcome: Promise<void> }
  | {
      kind: 'owner'
      tab: Tab
      reused: boolean
      rollback: OpenRollbackState | null
      attempt: OpenAttempt
    }

function hasSourceIdentity(store: EditorStore): boolean {
  return !!(store.getSourcePath() || store.getSourceHandle() || store.getSourceFileName())
}

function hasDocumentContent(store: EditorStore): boolean {
  const graph = store.graph
  const pages = graph.getPages()
  return (
    graph.nodes.size !== 2 ||
    pages.length !== 1 ||
    pages.some((page) => graph.getChildren(page.id).length > 0) ||
    graph.images.size > 0 ||
    graph.variables.size > 0 ||
    graph.variableCollections.size > 0 ||
    graph.activeMode.size > 0 ||
    graph.figKiwiVersion !== null ||
    graph.figSchemaDeflated !== null ||
    graph.documentColorSpace !== 'display-p3'
  )
}

function isPristineTab(store: EditorStore): boolean {
  return (
    store.state.documentName === 'Untitled' &&
    !store.state.loading &&
    !store.undo.canUndo &&
    !store.undo.canRedo &&
    !hasSourceIdentity(store) &&
    !hasDocumentContent(store)
  )
}

function createOpenAttempt(): OpenAttempt {
  let resolve: () => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const outcome = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  void outcome.catch(() => undefined)
  return { outcome, resolve, reject }
}

function getLiveTab(tab: Tab): Tab | undefined {
  return tabsRef.value.find((candidate) => candidate.id === tab.id && candidate.store === tab.store)
}

function requireLiveTab(tab: Tab): Tab {
  const live = getLiveTab(tab)
  if (!live) throw new Error('File open target tab no longer exists')
  return live
}

function captureOpenRollbackState(store: EditorStore): OpenRollbackState {
  return {
    graph: store.graph,
    currentPageId: store.state.currentPageId,
    enteredContainerId: store.state.enteredContainerId,
    documentName: store.state.documentName,
    loading: store.state.loading,
    pageColor: structuredClone(store.state.pageColor),
    panX: store.state.panX,
    panY: store.state.panY,
    zoom: store.state.zoom
  }
}

function restoreOpenRollbackState(tab: Tab, rollback: OpenRollbackState) {
  const live = getLiveTab(tab)
  if (!live) return
  const store = live.store
  store.clearSourceIdentity()
  if (store.graph !== rollback.graph) store.replaceGraph(rollback.graph)
  store.state.currentPageId = rollback.currentPageId
  store.state.enteredContainerId = rollback.enteredContainerId
  store.state.documentName = rollback.documentName
  store.state.loading = rollback.loading
  store.state.pageColor = structuredClone(rollback.pageColor)
  store.state.panX = rollback.panX
  store.state.panY = rollback.panY
  store.state.zoom = rollback.zoom
}

let nextTabId = 1

function generateTabId(): string {
  return `tab-${nextTabId++}`
}

const tabsRef = shallowRef<Tab[]>([])
const activeTabId = shallowRef('')

export const activeTab = computed(() => tabsRef.value.find((t) => t.id === activeTabId.value))

export const allTabs = computed(() =>
  tabsRef.value.map((t) => ({
    id: t.id,
    name: t.store.state.documentName,
    isActive: t.id === activeTabId.value
  }))
)

export function getActiveStore(): EditorStore {
  const tab = tabsRef.value.find((t) => t.id === activeTabId.value)
  if (!tab) throw new Error('No active tab')
  return tab.store
}

export function getActiveTabId(): string {
  return activeTabId.value
}

export function getTabById(tabId: string): Tab | undefined {
  return tabsRef.value.find((tab) => tab.id === tabId)
}

export function getTabForStore(store: EditorStore): Tab | undefined {
  return tabsRef.value.find((tab) => tab.store === store)
}

export function getTabsSnapshot(): Tab[] {
  return [...tabsRef.value]
}

export function createTab(store?: EditorStore, initialGraph?: SceneGraph): Tab {
  const s = store ?? createEditorStore(initialGraph)
  const tab: Tab = { id: generateTabId(), store: s }
  tabsRef.value = [...tabsRef.value, tab]
  activateTab(tab)
  return tab
}

function activateTab(tab: Tab) {
  activeTabId.value = tab.id
  setActiveEditorStore(tab.store)
  triggerRef(tabsRef)
  setOpenPencilStore(tab.store)
}

export function switchTab(tabId: string) {
  const tab = tabsRef.value.find((t) => t.id === tabId)
  if (!tab) return
  activateTab(tab)
}

export function closeTab(tabId: string) {
  const idx = tabsRef.value.findIndex((t) => t.id === tabId)
  if (idx === -1) return

  const closingTab = tabsRef.value[idx]
  const wasActive = activeTabId.value === tabId
  tabsRef.value = tabsRef.value.filter((t) => t.id !== tabId)

  if (tabsRef.value.length === 0) {
    createTab()
    closingTab.store.dispose()
    return
  }

  if (wasActive) {
    const newIdx = Math.min(idx, tabsRef.value.length - 1)
    activateTab(tabsRef.value[newIdx])
  }

  closingTab.store.dispose()
}

function isDOMImportFile(file: File): boolean {
  return /\.(html?|xhtml)$/i.test(file.name)
}

export async function openFileInNewTab(
  file: File,
  handle?: FileSystemFileHandle,
  path?: string
): Promise<void> {
  // The global lock intentionally protects only identity/tab-reuse decisions,
  // not the actual disk/network I/O. This keeps duplicate tabs impossible
  // while still allowing multiple different files to load concurrently.
  const decision = await fileOpenLock.run<OpenDecision>(handle, path, async (existingTab) => {
    if (existingTab) {
      switchTab(existingTab.id)
      const attempt = openAttemptsByTabId.get(existingTab.id)
      return attempt ? { kind: 'join', outcome: attempt.outcome } : { kind: 'existing' }
    }

    // Capture the current tab only after acquiring the global open lock so
    // that the file loads into the tab the user is currently looking at.
    const current = activeTab.value
    const reused = current ? isPristineTab(current.store) : false
    const tab = reused && current ? current : createTab()
    const rollback = reused ? captureOpenRollbackState(tab.store) : null
    const attempt = createOpenAttempt()
    openAttemptsByTabId.set(tab.id, attempt)

    // Claim the source identity immediately so concurrent opens of the same
    // file observe a matching tab. Heavy I/O then happens after the lock.
    tab.store.updateSourceIdentity(file.name, handle, path)
    return { kind: 'owner', tab, reused, rollback, attempt }
  })

  if (decision.kind === 'existing') return
  if (decision.kind === 'join') {
    await decision.outcome
    return
  }

  const { tab, reused, rollback, attempt } = decision
  const store = tab.store
  try {
    if (isDOMImportFile(file)) {
      await store.openDOMFile(file, { handle, path })
      requireLiveTab(tab)
      attempt.resolve()
      return
    }

    const documentName = file.name.replace(/\.[^.]+$/i, '')
    store.state.documentName = documentName
    store.state.loading = true
    await yieldToUI()
    requireLiveTab(tab)

    const isFig = file.name.toLowerCase().endsWith('.fig')
    const { graph: imported, sourceFormat } = isFig
      ? { graph: await readFigFile(file, { populate: 'first-page' }), sourceFormat: 'fig' }
      : await io.readDocument({
          name: file.name,
          mimeType: file.type || undefined,
          data: new Uint8Array(await file.arrayBuffer())
        })

    requireLiveTab(tab)
    const firstPageId = imported.getPages()[0]?.id
    if (firstPageId) computeAllLayouts(imported, firstPageId)
    store.replaceGraph(imported)
    store.undo.clear()
    store.setDocumentSource(file.name, sourceFormat, handle, path)
    store.clearSelection()
    const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
    await store.switchPage(pageId)
    requireLiveTab(tab)
    await store.fitCurrentPageToViewport()
    requireLiveTab(tab)
    store.state.loading = false
    attempt.resolve()
  } catch (error) {
    // Queue rollback behind identity decisions that were already invoked.
    // Those duplicates must observe and join this owner's outcome before its
    // optimistic identity is removed.
    await fileOpenLock.run(handle, path, async () => {
      if (reused && rollback) {
        restoreOpenRollbackState(tab, rollback)
      } else if (getLiveTab(tab)) {
        closeTab(tab.id)
      }
    })
    attempt.reject(error)
    throw error
  } finally {
    if (openAttemptsByTabId.get(tab.id) === attempt) openAttemptsByTabId.delete(tab.id)
  }
}

export function tabCount(): number {
  return tabsRef.value.length
}

export function useTabsStore() {
  return {
    tabs: allTabs,
    activeTabId,
    createTab,
    switchTab,
    closeTab,
    getActiveTabId,
    getTabById,
    getTabForStore,
    getTabsSnapshot,
    openFileInNewTab,
    getActiveStore,
    tabCount
  }
}
