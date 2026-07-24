import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import { createSaveActions } from '@/app/document/io/save'
import { createEditorStore } from '@/app/editor/session'
import type { Tab } from '@/app/tabs'
import { findExistingTab } from '@/app/tabs/identity'

type SaveOptions = Parameters<typeof createSaveActions>[0]

function makeHandle(
  name: string,
  createWritable: () => Promise<FileSystemWritableFileStream>,
  isSameEntry: (other: FileSystemFileHandle) => Promise<boolean> = async () => false
): FileSystemFileHandle {
  return { kind: 'file', name, createWritable, isSameEntry } as FileSystemFileHandle
}

function makeWritable(events: string[]): FileSystemWritableFileStream {
  return {
    write: async () => {
      events.push('write')
    },
    close: async () => {
      events.push('close')
    }
  } as FileSystemWritableFileStream
}

function createHarness(initialHandle: FileSystemFileHandle | null = null) {
  const store = createEditorStore()
  let filePath: string | null = null
  let fileHandle = initialHandle
  let downloadName: string | null = initialHandle?.name ?? 'Untitled.fig'
  const events: string[] = []
  const updateSourceIdentity = vi.fn(
    (fileName: string, handle?: FileSystemFileHandle, path?: string) => {
      events.push('identity')
      store.updateSourceIdentity(fileName, handle, path)
    }
  )
  const options: SaveOptions = {
    state: store.state,
    buildFigFile: () => new Uint8Array([1, 2, 3]),
    getFilePath: () => filePath,
    setFilePath: (path) => {
      filePath = path
    },
    getFileHandle: () => fileHandle,
    setFileHandle: (handle) => {
      fileHandle = handle
    },
    getDownloadName: () => downloadName,
    setDownloadName: (name) => {
      downloadName = name
    },
    getSourceIdentityRevision: store.getSourceIdentityRevision,
    setSavedVersion: vi.fn(),
    setLastWriteTime: vi.fn(),
    startWatchingFile: vi.fn(),
    updateSourceIdentity
  }
  return {
    store,
    tab: { id: 'save-tab', store } as Tab,
    events,
    options,
    filePath: () => filePath,
    fileHandle: () => fileHandle,
    downloadName: () => downloadName,
    updateSourceIdentity
  }
}

describe('Save As source identity', () => {
  const stores: Array<ReturnType<typeof createEditorStore>> = []

  beforeEach(() => {
    globalThis.window = {
      innerWidth: 1024,
      innerHeight: 768,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0)
        return 0
      },
      cancelAnimationFrame: vi.fn(),
      openPencil: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as Window & typeof globalThis
    globalThis.document = {
      fonts: { add: vi.fn(), ready: Promise.resolve() }
    } as Document
  })

  afterEach(() => {
    for (const store of stores.splice(0)) store.dispose()
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'prompt')
    vi.restoreAllMocks()
  })

  test('keeps the previous identity when the selected target write fails', async () => {
    const oldHandle = makeHandle('old.fig', async () => makeWritable([]))
    const replacement = makeHandle('replacement.fig', async () => {
      throw new Error('write failed')
    })
    const harness = createHarness(oldHandle)
    stores.push(harness.store)
    harness.store.state.documentName = 'Old'
    harness.store.updateSourceIdentity('old.fig', oldHandle)
    window.showSaveFilePicker = vi.fn(async () => replacement)

    await expect(createSaveActions(harness.options).saveFigFileAs()).rejects.toThrow('write failed')

    expect(harness.fileHandle()).toBe(oldHandle)
    expect(harness.filePath()).toBeNull()
    expect(harness.downloadName()).toBe('old.fig')
    expect(harness.store.state.documentName).toBe('Old')
    expect(harness.store.getSourceHandle()).toBe(oldHandle)
    expect(harness.updateSourceIdentity).not.toHaveBeenCalled()
    await expect(findExistingTab([harness.tab], oldHandle)).resolves.toBe(harness.tab)
    await expect(findExistingTab([harness.tab], replacement)).resolves.toBeNull()
  })

  test('commits the new identity only after a successful target write', async () => {
    const harness = createHarness()
    stores.push(harness.store)
    const replacement = makeHandle('replacement.fig', async () => {
      harness.events.push('create-writable')
      return makeWritable(harness.events)
    })
    window.showSaveFilePicker = vi.fn(async () => replacement)

    await createSaveActions(harness.options).saveFigFileAs()

    expect(harness.events).toEqual(['create-writable', 'write', 'close', 'identity'])
    expect(harness.fileHandle()).toBe(replacement)
    expect(harness.filePath()).toBeNull()
    expect(harness.store.state.documentName).toBe('replacement')
    expect(harness.store.getSourceHandle()).toBe(replacement)
    await expect(findExistingTab([harness.tab], replacement)).resolves.toBe(harness.tab)
  })

  test('does not expose a planned path as source identity before writing it', async () => {
    const harness = createHarness()
    stores.push(harness.store)

    harness.store.setPlannedFilePath('/planned/planned.fig')

    expect(harness.store.getSourcePath()).toBeNull()
    expect(harness.store.getSourceFileName()).toBeNull()
    await expect(
      findExistingTab([harness.tab], undefined, '/planned/planned.fig')
    ).resolves.toBeNull()
  })

  test('does not publish a planned path when the runtime has no writable sink', async () => {
    const harness = createHarness()
    stores.push(harness.store)
    harness.options.setFilePath('/planned/planned.fig')
    harness.options.setDownloadName('planned.fig')

    await createSaveActions(harness.options).saveFigFile()

    expect(harness.updateSourceIdentity).not.toHaveBeenCalled()
    expect(harness.store.getSourcePath()).toBeNull()
    expect(harness.store.getSourceFileName()).toBeNull()
    await expect(
      findExistingTab([harness.tab], undefined, '/planned/planned.fig')
    ).resolves.toBeNull()
  })

  test('replaces an old stable identity after browser fallback Save As', async () => {
    const oldUrl = 'https://example.test/original.fig'
    const harness = createHarness()
    stores.push(harness.store)
    harness.store.updateSourceIdentity('original.fig', undefined, oldUrl)
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn()
    }
    Object.assign(document, {
      createElement: vi.fn(() => anchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn()
      }
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:copy')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    globalThis.prompt = vi.fn(() => 'copy.fig')

    await createSaveActions(harness.options).saveFigFileAs()

    expect(anchor.click).toHaveBeenCalledTimes(1)
    expect(harness.updateSourceIdentity).toHaveBeenCalledWith('copy.fig')
    expect(harness.store.getSourceHandle()).toBeNull()
    expect(harness.store.getSourcePath()).toBeNull()
    expect(harness.store.getSourceFileName()).toBe('copy.fig')
    await expect(findExistingTab([harness.tab], undefined, oldUrl)).resolves.toBeNull()
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 110)
    })
  })

  test('commits an existing writable identity only after its first successful save', async () => {
    const events: string[] = []
    let attempts = 0
    const plannedHandle = makeHandle('planned.fig', async () => {
      attempts++
      if (attempts === 1) throw new Error('first write failed')
      return makeWritable(events)
    })
    const harness = createHarness(plannedHandle)
    stores.push(harness.store)
    harness.options.updateSourceIdentity = (
      fileName: string,
      handle?: FileSystemFileHandle,
      path?: string
    ) => {
      events.push('identity')
      harness.store.updateSourceIdentity(fileName, handle, path)
    }

    const actions = createSaveActions(harness.options)
    await expect(actions.saveFigFile()).rejects.toThrow('first write failed')
    expect(harness.store.getSourceHandle()).toBeNull()
    await expect(findExistingTab([harness.tab], plannedHandle)).resolves.toBeNull()

    await actions.saveFigFile()

    expect(events).toEqual(['write', 'close', 'identity'])
    expect(harness.store.getSourceHandle()).toBe(plannedHandle)
    await expect(findExistingTab([harness.tab], plannedHandle)).resolves.toBe(harness.tab)
  })
})
