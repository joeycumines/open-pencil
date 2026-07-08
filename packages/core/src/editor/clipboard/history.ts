import type { SceneNode } from '@open-pencil/scene-graph'

import { remapRestoredSnapshotReferences } from '#core/editor/history/restore-references'
import type { EditorContext } from '#core/editor/types'

import { restoreSubtree } from './subtree-history'

export type DeletedEntry = {
  id: string
  parentId: string
  index: number
  subtree: Map<string, SceneNode>
}

export function recreateSnapshots(ctx: EditorContext, snapshots: SceneNode[], pageId: string) {
  const index = new Map<string, SceneNode>()
  for (const snapshot of snapshots) {
    index.set(snapshot.id, snapshot)
  }

  const originalIdToNewId = new Map<string, string>()

  function recreate(snapshot: SceneNode, resolvedParentId: string) {
    const node = ctx.graph.createNode(
      snapshot.type,
      resolvedParentId,
      { ...snapshot, childIds: [] },
      { mode: 'restore' }
    )
    originalIdToNewId.set(snapshot.id, node.id)
    for (const childId of snapshot.childIds) {
      const child = index.get(childId)
      if (child) recreate(child, node.id)
    }
  }

  for (const snapshot of snapshots) {
    if (originalIdToNewId.has(snapshot.id)) continue
    const parentId = snapshot.parentId ?? pageId
    const resolvedParentId = originalIdToNewId.get(parentId) ?? parentId
    recreate(snapshot, resolvedParentId)
  }

  remapRestoredSnapshotReferences(ctx.graph, snapshots, originalIdToNewId)

  return originalIdToNewId
}

export function deleteIds(ctx: EditorContext, ids: string[]) {
  for (const id of [...ids].reverse()) ctx.graph.deleteNode(id, { permanent: true })
}

export function restoreDeletedEntries(ctx: EditorContext, entries: DeletedEntry[]) {
  const restoredIds = new Map<string, string>()
  const snapshots: SceneNode[] = []
  for (const { id, parentId, index, subtree } of [...entries].reverse()) {
    for (const snapshot of subtree.values()) snapshots.push(snapshot)
    const rootSnap = subtree.get(id)
    if (!rootSnap) continue
    const result = restoreSubtree(ctx.graph, rootSnap, parentId, subtree, restoredIds)
    for (const [oldId, newId] of result.oldToNew) restoredIds.set(oldId, newId)
    if (index >= 0) ctx.graph.reorderChild(result.rootId, parentId, index)
  }

  remapRestoredSnapshotReferences(ctx.graph, snapshots, restoredIds)

  return restoredIds
}
