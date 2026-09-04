import type { Editor, EditorState } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'

import { createAutosave } from '@/app/document/autosave'
import {
  documentNameFromFigPath,
  downloadNameFromPath,
  figDownloadName
} from '@/app/document/io/names'
import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import { createDocumentRecovery } from '@/app/document/recovery'
import { recoveryEnabled } from '@/app/document/recovery/preferences'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

export { createDocumentSourceState }

type DocumentSourceOptions = DocumentSourceAccess & {
  editor: Editor
  state: DocumentSourceState
  stopWatchingFile: () => void
  startWatchingFile: () => Promise<void>
  getRenderer: () => Editor['renderer']
  setSourceHandle: (handle: FileSystemFileHandle | null) => void
  setSourcePath: (path: string | null) => void
  setSourceFileName: (name: string | null) => void
}

export function createDocumentSourceActions({
  editor,
  state,
  stopWatchingFile,
  startWatchingFile,
  getFileHandle,
  setFileHandle,
  getFilePath,
  setFilePath,
  getDownloadName,
  setDownloadName,
  getStorageBinding,
  setStorageBinding,
  setSourceIdentity,
  getSavedVersion,
  setSavedVersion,
  setLastWriteTime,
  setSourceHandle,
  setSourcePath,
  setSourceFileName,
  getRenderer
}: DocumentSourceOptions) {
  function buildFigFile() {
    const renderer = getRenderer()
    return exportFigFile(editor.graph, renderer?.ck, renderer ?? undefined, state.currentPageId)
  }

  function buildRecoveryFigFile() {
    return exportFigFile(editor.graph, undefined, undefined, state.currentPageId)
  }

  const recovery = createDocumentRecovery({
    state,
    isEnabled: () => recoveryEnabled.value,
    buildFigFile: buildRecoveryFigFile,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding()
  })

  const { saveFigFile, saveFigFileAs, writeFile } = createSaveActions({
    state,
    buildFigFile,
    getFilePath,
    setFilePath,
    getFileHandle,
    setFileHandle,
    getDownloadName,
    setDownloadName,
    getStorageBinding,
    setStorageBinding,
    setSourceIdentity,
    setSavedVersion,
    setLastWriteTime,
    updateSourceIdentity,
    startWatchingFile: () => {
      void startWatchingFile()
    },
    onWriteSuccess: (version) => recovery.markProtectedVersion(version),
    onDownloadSuccess: (version) => recovery.markProtectedVersion(version)
  })

  const autosave = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding(),
    saveCurrentDocument: async (version) => {
      const data = await buildFigFile()
      await writeFile(data, version)
    }
  })

  function setDocumentSource(
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) {
    stopWatchingFile()
    setStorageBinding(null)
    const isFig = sourceFormat === 'fig'
    setFileHandle(isFig ? (handle ?? null) : null)
    setFilePath(isFig ? (path ?? null) : null)

    // Store identity metadata for all source formats so the tab layer can
    // deduplicate files on every platform, not only .fig files.
    updateSourceIdentity(fileName, handle, path)

    setDownloadName(figDownloadName(fileName, sourceFormat))
    setSourceIdentity({ handle: handle ?? null, path: path ?? null })
    setSavedVersion(state.sceneVersion)
    void recovery.markProtectedVersion(state.sceneVersion)
    if (isFig && (handle || path)) {
      void startWatchingFile()
    }
  }

  function setStorageDocumentSource(binding: StorageDocumentBinding, documentName: string) {
    stopWatchingFile()
    setFileHandle(null)
    setFilePath(null)
    setDownloadName(`${documentName}.fig`)
    setSourceIdentity({ handle: null, path: null })
    setStorageBinding(binding)
    state.documentName = documentName
    state.autosaveEnabled = true
    setSavedVersion(state.sceneVersion)
    void recovery.markProtectedVersion(state.sceneVersion)
  }

  function setPlannedFilePath(path: string) {
    stopWatchingFile()
    setStorageBinding(null)
    setFileHandle(null)
    setFilePath(path)
    const downloadName = downloadNameFromPath(path)
    setDownloadName(downloadName)
    state.documentName = documentNameFromFigPath(downloadName)
    updateSourceIdentity(downloadName, undefined, path)
  }

  function updateSourceIdentity(fileName: string, handle?: FileSystemFileHandle, path?: string) {
    setSourceHandle(handle ?? null)
    setSourcePath(path ?? null)
    setSourceFileName(fileName)
  }

  function clearSourceIdentity() {
    setSourceHandle(null)
    setSourcePath(null)
    setSourceFileName(null)
  }

  function startWatchingCurrentFile() {
    void startWatchingFile()
  }

  function disposeDocumentIO() {
    stopWatchingFile()
    autosave.disposeAutosave()
    recovery.disposeRecovery()
  }

  return {
    setDocumentSource,
    setStorageDocumentSource,
    setPlannedFilePath,
    updateSourceIdentity,
    clearSourceIdentity,
    startWatchingCurrentFile,
    disposeDocumentIO,
    saveFigFile,
    saveFigFileAs,
    getStorageBinding,
    getRecoveryId: () => recovery.getRecoveryId(),
    adoptRecoverySnapshot: (id: string, version: number) =>
      recovery.adoptRecoverySnapshot(id, version),
    persistRecoveryNow: () => recovery.persistNow(),
    discardRecovery: () => recovery.discardRecovery()
  }
}
