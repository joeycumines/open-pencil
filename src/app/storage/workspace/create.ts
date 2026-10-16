import type { StorageLocation } from '@/app/integrations/storage'
import { rememberRecentStorageDocument } from '@/app/recent-files'
import { createDocumentInCurrentTab } from '@/app/tabs'

/** Starts a design that lives in a Cloud workspace or the storage bucket from its first edit. */
export async function createStoredDocument(location: StorageLocation): Promise<void> {
  const { store } = createDocumentInCurrentTab()
  if (!(await store.saveFigFileToStorage(location))) return
  const binding = store.getStorageBinding()
  if (binding) rememberRecentStorageDocument(binding, store.state.documentName)
}
