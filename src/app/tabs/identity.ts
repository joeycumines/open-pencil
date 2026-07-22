import { isTauri } from '@/app/tauri/env'

import type { Tab } from './index'

type OptionalGlobal = {
  process?: { platform?: string }
  navigator?: { platform?: string }
}

const optionalGlobal = globalThis as OptionalGlobal

function isWindowsLike(): boolean {
  const nodePlatform = optionalGlobal.process?.platform
  if (nodePlatform) return nodePlatform === 'win32'
  return optionalGlobal.navigator?.platform?.startsWith('Win') ?? false
}

function normalizeURL(path: string): string | null {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(path) && !path.startsWith('blob:')) return null
  try {
    const url = new URL(path)
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

/**
 * Normalize a file path for identity comparison.
 *
 * - On Windows-like platforms, backslash is a separator and a leading `\\`
 *   (UNC) prefix is preserved after slash conversion so `//server/share` is
 *   not collapsed to `/server/share`.
 * - Windows extended-length path prefixes (`\\\\?\\` and `\\\\?\\UNC\\`) are
 *   preserved as a distinct namespace. Ordinary and extended spellings can
 *   have different segment semantics, so only the native identity oracle may
 *   prove that they refer to the same file.
 * - On POSIX platforms, backslash is a legal filename character and is left
 *   untouched.
 * - Trailing slashes are removed on all platforms.
 * - Lexical paths preserve case because the client cannot prove whether the
 *   backing volume or directory is case-sensitive. Existing Tauri paths use a
 *   native physical-file comparison when their lexical forms differ.
 * - Absolute URLs use URL semantics: host casing and fragments are normalized,
 *   while case-sensitive path bytes are preserved.
 */
export function normalizeFilePath(path: string): string {
  const isWindowsDrivePath = isWindowsLike() && /^[a-z]:[\\/]/i.test(path)
  const normalizedURL = isWindowsDrivePath ? null : normalizeURL(path)
  if (normalizedURL) return normalizedURL

  let normalized: string

  if (isWindowsLike()) {
    let body = path
    let prefixMode: 'extended' | 'extended-unc' | 'none' | 'unc' = 'none'

    if (body.startsWith('\\\\?\\UNC\\')) {
      body = body.slice(8)
      prefixMode = 'extended-unc'
    } else if (body.startsWith('\\\\?\\')) {
      body = body.slice(4)
      prefixMode = 'extended'
    } else if (body.startsWith('\\\\') || body.startsWith('//')) {
      body = body.slice(2)
      prefixMode = 'unc'
    }

    normalized = body.split('\\').join('/').replace(/\/+/g, '/')
    normalized = normalized.replace(/\/$/, '')

    if (prefixMode === 'unc') normalized = `//${normalized}`
    if (prefixMode === 'extended') normalized = `//?/${normalized}`
    if (prefixMode === 'extended-unc') normalized = `//?/UNC/${normalized}`
  } else {
    normalized = path.replace(/\/+/g, '/').replace(/\/$/, '')
  }

  return normalized
}

async function nativePathsReferToSameFile(firstPath: string, secondPath: string): Promise<boolean> {
  if (!isTauri()) return false
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return (
      (await invoke<boolean | null>('is_same_existing_native_file', {
        firstPath,
        secondPath
      })) === true
    )
  } catch {
    return false
  }
}

async function pathsReferToSameFile(firstPath: string, secondPath: string): Promise<boolean> {
  if (normalizeFilePath(firstPath) === normalizeFilePath(secondPath)) return true
  return nativePathsReferToSameFile(firstPath, secondPath)
}

async function identitiesMatch(
  handle: FileSystemFileHandle | undefined,
  path: string | undefined,
  storedHandle: FileSystemFileHandle | null,
  storedPath: string | null
): Promise<boolean> {
  if (path && storedPath && (await pathsReferToSameFile(path, storedPath))) return true
  if (!handle || !storedHandle) return false
  if (handle === storedHandle) return true
  try {
    return await handle.isSameEntry(storedHandle)
  } catch {
    return false
  }
}

/**
 * Search existing tabs for one that identifies as the same file as the
 * incoming open request.
 *
 * A stable identity requires either a canonical path or a
 * FileSystemFileHandle. When neither is provided we cannot prove that two
 * files are the same, so we deliberately return null and let the caller open
 * a new tab. File names alone are not identities.
 *
 * Path identity is checked first because it is synchronous and unambiguous.
 * If no tab matches the path (or no path was provided) we fall back to
 * FileSystemFileHandle.isSameEntry. This handles the common case where the
 * frontend receives both a path and a handle but an existing tab was opened
 * via the File System Access API and only stores a handle.
 */
export async function findExistingTab(
  tabs: readonly Tab[],
  handle: FileSystemFileHandle | undefined,
  path?: string
): Promise<Tab | null> {
  for (const tab of tabs) {
    const storedHandle = tab.store.getSourceHandle()
    const storedPath = tab.store.getSourcePath()
    if (await identitiesMatch(handle, path, storedHandle, storedPath)) return tab
  }
  return null
}

async function findLiveExistingTab(
  getTabs: () => readonly Tab[],
  handle: FileSystemFileHandle | undefined,
  path: string | undefined
): Promise<Tab | null> {
  for (const candidate of getTabs()) {
    const storedHandle = candidate.store.getSourceHandle()
    const storedPath = candidate.store.getSourcePath()
    if (!(await identitiesMatch(handle, path, storedHandle, storedPath))) continue

    const live = getTabs().find((tab) => tab.id === candidate.id && tab.store === candidate.store)
    if (!live) continue
    const currentHandle = live.store.getSourceHandle()
    const currentPath = live.store.getSourcePath()
    if (currentHandle === storedHandle && currentPath === storedPath) return live
  }
  return null
}

type LockEntry = {
  done: Promise<void>
}

/**
 * Create a global serialization lock for file-open operations.
 *
 * The lock is intentionally global (one key) rather than keyed by file
 * identity. This guarantees:
 *   - The second open of the same file always observes the first tab's
 *     stored identity and switches instead of creating a duplicate.
 *   - The "reuse untouched tab" decision can never race between two
 *     concurrent opens of different files.
 *   - The active tab is captured after lock acquisition, so the file loads
 *     into the tab the user actually sees.
 *
 * `getTabs` is consulted when the operation callback runs so identity is
 * checked against the up-to-date tab list.
 */
export function createFileOpenLock(getTabs: () => readonly Tab[]) {
  const GLOBAL_KEY = 'global'
  const inFlight = new Map<string, LockEntry>()

  return {
    run<T>(
      handle: FileSystemFileHandle | undefined,
      path: string | undefined,
      operation: (existingTab: Tab | null) => Promise<T>
    ): Promise<T> {
      const previous = inFlight.get(GLOBAL_KEY)

      let resolveDone: (() => void) | undefined
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve
      })
      const entry: LockEntry = { done }

      // Register our entry before awaiting the previous one so any request that
      // starts while we wait chains behind us rather than racing us.
      inFlight.set(GLOBAL_KEY, entry)

      const execute = async (): Promise<T> => {
        if (previous) {
          await previous.done
        }
        const existingTab = await findLiveExistingTab(getTabs, handle, path)
        return operation(existingTab)
      }

      return execute().finally(() => {
        // Only remove the map entry if it still points to us; a later request
        // for the same key may have already replaced it.
        if (inFlight.get(GLOBAL_KEY) === entry) {
          inFlight.delete(GLOBAL_KEY)
        }
        resolveDone?.()
      })
    }
  }
}
