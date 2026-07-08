import type { NodeChange, GUID } from '@open-pencil/kiwi/fig/codec'

interface IndexedNodeChange {
  nc: NodeChange
  index: number
  id: string | null
  parentId: string | null
}

interface EntryIndexes {
  firstEntryById: Map<string, IndexedNodeChange>
  entriesById: Map<string, IndexedNodeChange[]>
  uniqueEntryById: Map<string, IndexedNodeChange>
}

type IndexedGuidEntry = IndexedNodeChange & { id: string }

function guidToString(guid: GUID): string {
  return `${guid.sessionID}:${guid.localID}`
}

function parentGuidString(nc: NodeChange): string | null {
  return nc.parentIndex?.guid ? guidToString(nc.parentIndex.guid) : null
}

function siblingOrderKey(nc: NodeChange): string {
  return nc.parentIndex?.position ?? ''
}

function isLiveGuidEntry(entry: IndexedNodeChange): entry is IndexedGuidEntry {
  return entry.id !== null && entry.nc.phase !== 'REMOVED'
}

function countLiveGuids(entries: IndexedNodeChange[]): Map<string, number> {
  const idCounts = new Map<string, number>()
  for (const entry of entries) {
    if (!isLiveGuidEntry(entry)) continue
    idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1)
  }
  return idCounts
}

function hasDuplicateGuid(idCounts: Map<string, number>): boolean {
  for (const count of idCounts.values()) {
    if (count > 1) return true
  }
  return false
}

function buildEntryIndexes(
  entries: IndexedNodeChange[],
  idCounts: Map<string, number>
): EntryIndexes {
  const firstEntryById = new Map<string, IndexedNodeChange>()
  const entriesById = new Map<string, IndexedNodeChange[]>()
  const uniqueEntryById = new Map<string, IndexedNodeChange>()

  for (const entry of entries) {
    if (!isLiveGuidEntry(entry)) continue
    if (!firstEntryById.has(entry.id)) firstEntryById.set(entry.id, entry)
    const idEntries = entriesById.get(entry.id) ?? []
    idEntries.push(entry)
    entriesById.set(entry.id, idEntries)
    if (idCounts.get(entry.id) === 1) uniqueEntryById.set(entry.id, entry)
  }

  return { firstEntryById, entriesById, uniqueEntryById }
}

function nextParentIndex(
  entriesById: Map<string, IndexedNodeChange[]>,
  parentId: string,
  parentIndex: number
): number {
  const next = (entriesById.get(parentId) ?? []).find((parent) => parent.index > parentIndex)
  return next?.index ?? Number.POSITIVE_INFINITY
}

function followingSegmentChildren(
  entries: IndexedNodeChange[],
  entriesById: Map<string, IndexedNodeChange[]>,
  parentId: string,
  parentIndex: number
): IndexedNodeChange[] {
  const nextIndex = nextParentIndex(entriesById, parentId, parentIndex)
  return entries.filter(
    (candidate) =>
      candidate.nc.phase !== 'REMOVED' &&
      candidate.parentId === parentId &&
      candidate.index > parentIndex &&
      candidate.index < nextIndex
  )
}

function shouldPreferFollowingTie(
  entries: IndexedNodeChange[],
  entriesById: Map<string, IndexedNodeChange[]>,
  parentId: string,
  entry: IndexedNodeChange,
  followingParent: IndexedNodeChange
): boolean {
  const entryPosition = siblingOrderKey(entry.nc)
  for (const laterChild of followingSegmentChildren(
    entries,
    entriesById,
    parentId,
    followingParent.index
  )) {
    if (entryPosition >= siblingOrderKey(laterChild.nc)) return false
  }
  return true
}

function nearestParentOccurrence(
  entries: IndexedNodeChange[],
  indexes: EntryIndexes,
  parentId: string,
  entry: IndexedNodeChange
): IndexedNodeChange | undefined {
  const parents = indexes.entriesById.get(parentId) ?? []
  let nearest: IndexedNodeChange | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const parent of parents) {
    if (parent.index === entry.index) continue
    const distance = Math.abs(parent.index - entry.index)
    const prefersFollowingTie =
      distance === nearestDistance &&
      parent.index > entry.index &&
      parent.index === entry.index + 1 &&
      nearest !== undefined &&
      nearest.index < entry.index &&
      shouldPreferFollowingTie(entries, indexes.entriesById, parentId, entry, parent)
    if (distance < nearestDistance || prefersFollowingTie) {
      nearest = parent
      nearestDistance = distance
    }
  }
  return nearest ?? indexes.firstEntryById.get(parentId)
}

function attachChild(
  childrenByParentIndex: Map<number, IndexedNodeChange[]>,
  attached: Set<number>,
  parent: IndexedNodeChange,
  entry: IndexedNodeChange
): void {
  const children = childrenByParentIndex.get(parent.index) ?? []
  children.push(entry)
  childrenByParentIndex.set(parent.index, children)
  attached.add(entry.index)
}

function sortChildrenBySiblingPosition(
  childrenByParentIndex: Map<number, IndexedNodeChange[]>
): void {
  for (const siblings of childrenByParentIndex.values()) {
    siblings.sort((a, b) => {
      const aPos = siblingOrderKey(a.nc)
      const bPos = siblingOrderKey(b.nc)
      if (aPos < bPos) return -1
      if (aPos > bPos) return 1
      return a.index - b.index
    })
  }
}

function emitOrderedEntries(
  entries: IndexedNodeChange[],
  childrenByParentIndex: Map<number, IndexedNodeChange[]>,
  attached: Set<number>
): NodeChange[] {
  const ordered: NodeChange[] = []
  const emitted = new Set<number>()
  function emit(entry: IndexedNodeChange): void {
    if (emitted.has(entry.index)) return
    emitted.add(entry.index)
    ordered.push(entry.nc)
    if (!entry.id) return
    for (const child of childrenByParentIndex.get(entry.index) ?? []) emit(child)
  }

  for (const entry of entries) {
    if (attached.has(entry.index)) continue
    emit(entry)
  }

  return ordered
}

export function orderNodeChangesBySiblingPosition(nodeChanges: NodeChange[]): NodeChange[] {
  const entries = nodeChanges.map((nc, index): IndexedNodeChange => {
    const id = nc.guid ? guidToString(nc.guid) : null
    return { nc, index, id, parentId: parentGuidString(nc) }
  })

  const idCounts = countLiveGuids(entries)
  if (!hasDuplicateGuid(idCounts)) return nodeChanges

  const indexes = buildEntryIndexes(entries, idCounts)

  const childrenByParentIndex = new Map<number, IndexedNodeChange[]>()
  const attached = new Set<number>()

  for (const entry of entries) {
    if (entry.parentId) {
      const uniqueParent = indexes.uniqueEntryById.get(entry.parentId)
      const parent =
        uniqueParent ?? nearestParentOccurrence(entries, indexes, entry.parentId, entry)
      if (parent) attachChild(childrenByParentIndex, attached, parent, entry)
    }
  }

  sortChildrenBySiblingPosition(childrenByParentIndex)
  return emitOrderedEntries(entries, childrenByParentIndex, attached)
}
