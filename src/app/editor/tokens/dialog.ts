import { shallowRef, type ShallowRef } from 'vue'

import type { EditorStore } from '@/app/editor/active-store'

export function openVariablesDialog(store: EditorStore): void {
  store.state.variablesOpen = true
}

const pendingImports = new WeakMap<EditorStore, ShallowRef<File[] | null>>()

/** Token files a document's variables dialog has yet to read into an import. */
export function pendingTokenImport(store: EditorStore): ShallowRef<File[] | null> {
  let pending = pendingImports.get(store)
  if (!pending) {
    pending = shallowRef<File[] | null>(null)
    pendingImports.set(store, pending)
  }
  return pending
}

/** Opens the variables dialog on an import of these token files, as its Import button does. */
export function importTokenFiles(store: EditorStore, files: File[]): void {
  pendingTokenImport(store).value = files
  openVariablesDialog(store)
}
