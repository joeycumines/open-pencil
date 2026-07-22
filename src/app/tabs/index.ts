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
const pristineSceneVersionByStore = new WeakMap<EditorStore, number>()
let activationRevision = 0
let latestOpenRequestRevision = 0

type OpenAttempt = {
  ownedState: OpenOwnedState
  outcome: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

type OpenSourceIdentity = {
  fileName: string | null
  handle: FileSystemFileHandle | null
  path: string | null
}

type OpenOwnedState = {
  documentName: string
  sourceIdentity: OpenSourceIdentity
}

type OpenFocusTicket = {
  activationRevision: number
  requestRevision: number
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
  sceneVersion: number
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
    store.state.sceneVersion === (pristineSceneVersionByStore.get(store) ?? 0) &&
    !store.undo.canUndo &&
    !store.undo.canRedo &&
    !hasSourceIdentity(store) &&
    !hasDocumentContent(store)
  )
}

function captureSourceIdentity(store: EditorStore): OpenSourceIdentity {
  return {
    fileName: store.getSourceFileName(),
    handle: store.getSourceHandle(),
    path: store.getSourcePath()
  }
}

function isSourceIdentityCurrent(store: EditorStore, identity: OpenSourceIdentity): boolean {
  return (
    store.getSourceFileName() === identity.fileName &&
    store.getSourceHandle() === identity.handle &&
    store.getSourcePath() === identity.path
  )
}

function captureOpenOwnedState(store: EditorStore): OpenOwnedState {
  return {
    documentName: store.state.documentName,
    sourceIdentity: captureSourceIdentity(store)
  }
}

function isOpenOwnedStateCurrent(store: EditorStore, ownedState: OpenOwnedState): boolean {
  return (
    store.state.documentName === ownedState.documentName &&
    isSourceIdentityCurrent(store, ownedState.sourceIdentity)
  )
}

function createOpenAttempt(ownedState: OpenOwnedState): OpenAttempt {
  let resolve: () => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const outcome = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  void outcome.catch(() => undefined)
  return { ownedState, outcome, resolve, reject }
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
    sceneVersion: store.state.sceneVersion,
    zoom: store.state.zoom
  }
}

function isOpenRollbackStateCurrent(
  tab: Tab,
  rollback: OpenRollbackState,
  ownedState: OpenOwnedState
): boolean {
  const live = getLiveTab(tab)
  if (!live) return false
  const store = live.store
  return (
    store.graph === rollback.graph &&
    store.state.sceneVersion === rollback.sceneVersion &&
    !store.undo.canUndo &&
    !store.undo.canRedo &&
    isOpenOwnedStateCurrent(store, ownedState)
  )
}

function restoreOpenOwnedStateAfterDrift(
  tab: Tab,
  rollback: OpenRollbackState,
  ownedState: OpenOwnedState
) {
  const live = getLiveTab(tab)
  if (!live) return
  const store = live.store
  if (isSourceIdentityCurrent(store, ownedState.sourceIdentity)) {
    store.clearSourceIdentity()
    if (store.state.documentName === ownedState.documentName) {
      store.state.documentName = rollback.documentName
    }
  }
  store.state.loading = rollback.loading
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
  pristineSceneVersionByStore.set(store, store.state.sceneVersion)
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

function appendTab(store?: EditorStore, initialGraph?: SceneGraph): Tab {
  const s = store ?? createEditorStore(initialGraph)
  const tab: Tab = { id: generateTabId(), store: s }
  tabsRef.value = [...tabsRef.value, tab]
  return tab
}

export function createTab(store?: EditorStore, initialGraph?: SceneGraph): Tab {
  const tab = appendTab(store, initialGraph)
  activateTab(tab)
  return tab
}

function activateTab(tab: Tab) {
  if (activeTabId.value !== tab.id) activationRevision++
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

function canActivateForOpen(ticket: OpenFocusTicket): boolean {
  return (
    ticket.activationRevision === activationRevision &&
    ticket.requestRevision === latestOpenRequestRevision
  )
}

export async function openFileInNewTab(
  file: File,
  handle?: FileSystemFileHandle,
  path?: string
): Promise<void> {
  const focusTicket: OpenFocusTicket = {
    activationRevision,
    requestRevision: ++latestOpenRequestRevision
  }

  // The global lock intentionally protects only identity/tab-reuse decisions,
  // not the actual disk/network I/O. This keeps duplicate tabs impossible
  // while still allowing multiple different files to load concurrently.
  const decision = await fileOpenLock.run<OpenDecision>(handle, path, async (existingTab) => {
    if (existingTab) {
      if (canActivateForOpen(focusTicket)) switchTab(existingTab.id)
      const attempt = openAttemptsByTabId.get(existingTab.id)
      return attempt &&
        isSourceIdentityCurrent(existingTab.store, attempt.ownedState.sourceIdentity)
        ? { kind: 'join', outcome: attempt.outcome }
        : { kind: 'existing' }
    }

    // A delayed identity decision must not consume or supersede a newer tab
    // action. Stale opens receive an inactive owner tab instead.
    const shouldActivate = canActivateForOpen(focusTicket)
    const current =
      focusTicket.activationRevision === activationRevision ? activeTab.value : undefined
    const reused = current ? isPristineTab(current.store) : false
    let tab: Tab
    if (reused && current) {
      tab = current
    } else if (shouldActivate) {
      tab = createTab()
    } else {
      tab = appendTab()
    }
    const rollback = reused ? captureOpenRollbackState(tab.store) : null

    // Claim the source identity immediately so concurrent opens of the same
    // file observe a matching tab. Heavy I/O then happens after the lock.
    tab.store.updateSourceIdentity(file.name, handle, path)
    const attempt = createOpenAttempt(captureOpenOwnedState(tab.store))
    openAttemptsByTabId.set(tab.id, attempt)
    return { kind: 'owner', tab, reused, rollback, attempt }
  })

  if (decision.kind === 'existing') return
  if (decision.kind === 'join') {
    await decision.outcome
    return
  }

  const { tab, reused, rollback, attempt } = decision
  const store = tab.store
  let destructiveApplyStarted = false
  const requireOpenOwnedState = () => {
    if (!reused || !rollback) return
    const live = requireLiveTab(tab)
    if (!isOpenOwnedStateCurrent(live.store, attempt.ownedState)) {
      throw new Error('Open target changed while loading')
    }
  }
  const beforeDestructiveApply = () => {
    if (!reused || !rollback) return
    if (!isOpenRollbackStateCurrent(tab, rollback, attempt.ownedState)) {
      throw new Error('Open target changed while loading')
    }
    destructiveApplyStarted = true
  }
  try {
    if (isDOMImportFile(file)) {
      await store.openDOMFile(file, {
        beforeApply: beforeDestructiveApply,
        beforeCommitSource: (documentName) => {
          attempt.ownedState.documentName = documentName
          requireOpenOwnedState()
        },
        handle,
        path
      })
      requireLiveTab(tab)
      attempt.resolve()
      return
    }

    const documentName = file.name.replace(/\.[^.]+$/i, '')
    store.state.documentName = documentName
    attempt.ownedState.documentName = documentName
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
    beforeDestructiveApply()
    store.replaceGraph(imported)
    store.undo.clear()
    store.clearSelection()
    const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
    await store.switchPage(pageId)
    requireLiveTab(tab)
    await store.fitCurrentPageToViewport()
    requireLiveTab(tab)
    requireOpenOwnedState()
    store.setDocumentSource(file.name, sourceFormat, handle, path)
    store.state.loading = false
    attempt.resolve()
  } catch (error) {
    // Queue rollback behind identity decisions that were already invoked.
    // Those duplicates must observe and join this owner's outcome before its
    // optimistic identity is removed.
    await fileOpenLock.run(handle, path, async () => {
      if (reused && rollback) {
        if (
          (destructiveApplyStarted && isOpenOwnedStateCurrent(store, attempt.ownedState)) ||
          isOpenRollbackStateCurrent(tab, rollback, attempt.ownedState)
        ) {
          restoreOpenRollbackState(tab, rollback)
        } else {
          restoreOpenOwnedStateAfterDrift(tab, rollback, attempt.ownedState)
        }
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
