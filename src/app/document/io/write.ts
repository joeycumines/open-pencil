import type { EditorState } from '@open-pencil/core/editor'

import { isTauri } from '@/app/tauri/env'

type WriteDocumentState = EditorState

type DocumentWriteTarget =
  | { kind: 'path'; path: string }
  | { kind: 'handle'; handle: FileSystemFileHandle }

type DocumentWriterOptions = {
  state: WriteDocumentState
  getFilePath: () => string | null
  getFileHandle: () => FileSystemFileHandle | null
  setSavedVersion: (version: number) => void
  setLastWriteTime: (time: number) => void
}

export function createDocumentWriter({
  state,
  getFilePath,
  getFileHandle,
  setSavedVersion,
  setLastWriteTime
}: DocumentWriterOptions) {
  return async function writeFile(data: Uint8Array, target?: DocumentWriteTarget) {
    setLastWriteTime(Date.now())
    let filePath = getFilePath()
    let fileHandle = getFileHandle()
    if (target) {
      filePath = target.kind === 'path' ? target.path : null
      fileHandle = target.kind === 'handle' ? target.handle : null
    }
    if (filePath && isTauri()) {
      const { writeFile: tauriWrite } = await import('@tauri-apps/plugin-fs')
      await tauriWrite(filePath, data)
      setSavedVersion(state.sceneVersion)
      return
    }
    if (fileHandle) {
      const writable = await fileHandle.createWritable()
      await writable.write(new Uint8Array(data))
      await writable.close()
      setSavedVersion(state.sceneVersion)
    }
  }
}
