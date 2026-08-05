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
import {
  activeStorageProviderID,
  createActiveStorageAdapter,
  type StorageDocument
} from '@/app/integrations/storage'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import { seedStorageCanvasFromRemote } from '@/app/storage/sync/persist'
import { createFileOpenLock, normalizeFilePath } from '@/app/tabs/identity'

export interface Tab {
  id: string
  store: EditorStore
}

const io = new IORegistry(BUILTIN_IO_FORMATS)

const fileOpenLock = createFileOpenLock(() => tabsRef.value)
type FileOpenOutcome = {
  handle: FileSystemFileHandle | undefined
  path: string | undefined
  promise: Promise<void>
}
type FileOpenClaim = {
  tab: Tab
  entry: FileOpenOutcome
}
const fileOpenOutcomes = new WeakMap<EditorStore, FileOpenOutcome>()
const fileOpenClaims = new Set<FileOpenClaim>()

type OpenContext = {
  tab: Tab
  isUntouched: boolean
  previousDocumentName: string | undefined
}

type OpenDecision = {
  tab: Tab
  existing: boolean
  outcome?: Promise<void>
}

function hasSourceIdentity(store: EditorStore): boolean {
  return !!(store.getSourcePath() || store.getSourceHandle() || store.getSourceFileName())
}

async function getMatchingFileOpenOutcome(
  store: EditorStore,
  handle: FileSystemFileHandle | undefined,
  path: string | undefined
): Promise<FileOpenOutcome | undefined> {
  const entry = fileOpenOutcomes.get(store)
  return entry && (await matchesFileOpenOutcome(entry, handle, path)) ? entry : undefined
}

async function matchesFileOpenOutcome(
  entry: FileOpenOutcome,
  handle: FileSystemFileHandle | undefined,
  path: string | undefined
): Promise<boolean> {
  if (path && entry.path && normalizeFilePath(path) === normalizeFilePath(entry.path)) {
    return true
  }
  if (!handle || !entry.handle) return false

  try {
    return await handle.isSameEntry(entry.handle)
  } catch {
    return false
  }
}

async function findClaimedFileOpenOutcome(
  handle: FileSystemFileHandle | undefined,
  path: string | undefined
): Promise<{ tab: Tab; entry: FileOpenOutcome } | undefined> {
  for (const claim of fileOpenClaims) {
    if (await matchesFileOpenOutcome(claim.entry, handle, path)) return claim
  }
  return undefined
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

async function loadClaimedFile(
  file: File,
  handle: FileSystemFileHandle | undefined,
  path: string | undefined,
  context: OpenContext
): Promise<void> {
  const { tab, isUntouched, previousDocumentName } = context
  const store = tab.store
  if (isDOMImportFile(file)) {
    try {
      await store.openDOMFile(file, { handle, path })
    } catch (error) {
      store.clearSourceIdentity()
      if (isUntouched && previousDocumentName !== undefined) {
        store.state.documentName = previousDocumentName
      }
      if (!isUntouched) {
        closeTab(tab.id)
      }
      throw error
    }
    if (isUntouched) {
      activateTab(tab)
    }
    return
  }
  const documentName = file.name.replace(/\.[^.]+$/i, '')

  store.state.documentName = documentName
  store.state.loading = true
  await yieldToUI()

  try {
    const isFig = file.name.toLowerCase().endsWith('.fig')
    const { graph: imported, sourceFormat } = isFig
      ? { graph: await readFigFile(file, { populate: 'first-page' }), sourceFormat: 'fig' }
      : await io.readDocument({
          name: file.name,
          mimeType: file.type || undefined,
          data: new Uint8Array(await file.arrayBuffer())
        })

    const firstPageId = imported.getPages()[0]?.id
    if (firstPageId) computeAllLayouts(imported, firstPageId)
    store.replaceGraph(imported)
    store.undo.clear()
    store.setDocumentSource(file.name, sourceFormat, handle, path)
    store.clearSelection()
    const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
    await store.switchPage(pageId)
    await store.fitCurrentPageToViewport()
  } catch (error) {
    // A failed read must not permanently taint the tab with a source identity
    // that would block future attempts to open the same file.
    store.clearSourceIdentity()
    if (isUntouched && previousDocumentName !== undefined) {
      store.state.documentName = previousDocumentName
    }
    store.state.loading = false
    if (!isUntouched) {
      closeTab(tab.id)
    }
    throw error
  }

  store.state.loading = false

  // When reusing an untouched existing tab we must explicitly activate it,
  // because the active tab may have changed while we were loading.
  if (isUntouched) {
    activateTab(tab)
  }
}

export async function openFileInNewTab(
  file: File,
  handle?: FileSystemFileHandle,
  path?: string
): Promise<void> {
  // The global lock protects only identity/tab-reuse decisions. A new load is
  // started and published while holding the lock, but its promise is carried
  // out without being awaited so different files can still load concurrently.
  const decision = await fileOpenLock.run<OpenDecision>(handle, path, async (existingTab) => {
    if (existingTab) {
      return {
        tab: existingTab,
        existing: true,
        outcome: (await getMatchingFileOpenOutcome(existingTab.store, handle, path))?.promise
      }
    }

    // A failed owner clears its store identity before rejecting. Requests
    // already queued behind a slower identity comparison must still find the
    // retained, identity-tagged outcome instead of starting a second load.
    const claimed = await findClaimedFileOpenOutcome(handle, path)
    if (claimed) {
      return {
        tab: claimed.tab,
        existing: true,
        outcome: claimed.entry.promise
      }
    }

    // Capture the current tab only after acquiring the global open lock so
    // that the file loads into the tab the user is currently looking at.
    const current = activeTab.value
    const previousDocumentName = current?.store.state.documentName
    const isUntouched =
      current?.store.state.documentName === 'Untitled' &&
      !current.store.undo.canUndo &&
      // A tab with a redo stack is not "untouched" — overwriting it would
      // destroy recoverable user work.
      !current.store.undo.canRedo &&
      !hasSourceIdentity(current.store)

    const tab = isUntouched ? current : createTab()

    // Claim the source identity and publish the owning load promise before
    // releasing the decision lock, so duplicates share its exact outcome.
    tab.store.updateSourceIdentity(file.name, handle, path)
    const outcome = loadClaimedFile(file, handle, path, {
      tab,
      isUntouched,
      previousDocumentName
    })
    void outcome.catch(() => undefined)
    const entry: FileOpenOutcome = { handle, path, promise: outcome }
    fileOpenOutcomes.set(tab.store, entry)
    const claim: FileOpenClaim = { tab, entry }
    fileOpenClaims.add(claim)
    const clearOutcome = () => {
      // Queue cleanup behind identity decisions that were already registered
      // when the load settled, so those callers still observe its outcome.
      void fileOpenLock.run(undefined, undefined, async () => {
        fileOpenClaims.delete(claim)
        if (fileOpenOutcomes.get(tab.store) === entry) {
          fileOpenOutcomes.delete(tab.store)
        }
      })
    }
    void outcome.then(clearOutcome, clearOutcome)
    return { tab, existing: false, outcome }
  })

  if (decision.outcome) await decision.outcome
  if (decision.existing) switchTab(decision.tab.id)
}

export function tabCount(): number {
  return tabsRef.value.length
}

function reusableTabStore(): EditorStore {
  const current = activeTab.value
  const isUntouched =
    current?.store.state.documentName === 'Untitled' && !current.store.undo.canUndo
  return isUntouched ? current.store : createTab().store
}

function findStorageTab(providerId: string, documentId: string): Tab | undefined {
  return tabsRef.value.find((tab) => {
    const binding = tab.store.getStorageBinding()
    return binding?.providerId === providerId && binding.documentId === documentId
  })
}

export async function openStorageDocumentInNewTab(document: StorageDocument): Promise<void> {
  const providerId = activeStorageProviderID.value
  const existing = findStorageTab(providerId, document.id)
  if (existing) {
    switchTab(existing.id)
    return
  }

  const store = reusableTabStore()
  store.state.documentName = document.name
  store.state.loading = true
  try {
    const local = getLocalCanvasStore()
    const localMetadata = await local.getMeta(document.id)
    const localBytes = localMetadata?.hasFig ? await local.readFig(document.id) : null
    const localIsAuthoritative =
      localMetadata?.syncStatus !== 'synced' ||
      !document.metadataAuthoritative ||
      localMetadata.updatedAt >= document.updatedAt
    let bytes = localBytes && localIsAuthoritative ? localBytes : null

    if (!bytes) {
      bytes = await createActiveStorageAdapter(providerId).getDocument(document.id)
      await seedStorageCanvasFromRemote({
        providerId,
        canvasId: document.id,
        name: document.name,
        updatedAt: document.updatedAt,
        figBytes: bytes
      })
    }

    const fileBytes = new Uint8Array(bytes.byteLength)
    fileBytes.set(bytes)
    const file = new File([fileBytes.buffer], `${document.name}.fig`, {
      type: 'application/octet-stream'
    })
    const imported = await readFigFile(file, { populate: 'first-page' })
    const firstPageId = imported.getPages()[0]?.id
    if (firstPageId) computeAllLayouts(imported, firstPageId)
    store.replaceGraph(imported)
    store.undo.clear()
    store.setStorageDocumentSource({ providerId, documentId: document.id }, document.name)
    store.clearSelection()
    const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
    await store.switchPage(pageId)
    await store.fitCurrentPageToViewport()
  } finally {
    store.state.loading = false
  }
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
    openStorageDocumentInNewTab,
    getActiveStore,
    tabCount
  }
}
