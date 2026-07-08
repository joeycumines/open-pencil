import type { SceneNode } from '@open-pencil/scene-graph'
import { computeAbsoluteBounds } from '@open-pencil/scene-graph/geometry'

import type { EditorContext } from '#core/editor/types'
import { computeAllLayouts } from '#core/layout'

import { deleteIds, type DeletedEntry, recreateSnapshots, restoreDeletedEntries } from './history'
import { collectSubtrees, snapshotSubtree } from './subtree-history'

type CenterNodesAt = (nodeIds: string[], cx: number, cy: number) => void

export function selectedReplacementTargets(ctx: EditorContext) {
  const selected = [...ctx.state.selectedIds]
    .map((id) => ctx.graph.getNode(id))
    .filter((node): node is SceneNode => node != null && !node.locked)
  const selectedSet = new Set(selected.map((node) => node.id))
  return selected.filter((node) => !node.parentId || !selectedSet.has(node.parentId))
}

function reorderCreatedAtReplacementIndex(
  ctx: EditorContext,
  created: string[],
  deleted: DeletedEntry[]
) {
  const insertParentId = deleted[0]?.parentId
  if (!insertParentId) return
  const insertIndex = deleted[0]?.index ?? 0
  for (let i = 0; i < created.length; i++) {
    ctx.graph.reorderChild(created[i], insertParentId, insertIndex + i)
  }
}

function remappedExistingRootIds(ctx: EditorContext, ids: string[], idMap: Map<string, string>) {
  const remapped: string[] = []
  for (const id of ids) {
    const remappedId = idMap.get(id)
    if (remappedId && ctx.graph.getNode(remappedId)) remapped.push(remappedId)
  }
  return remapped
}

function deletedSnapshotIds(entries: DeletedEntry[]) {
  const ids = new Set<string>()
  for (const entry of entries) {
    for (const id of entry.subtree.keys()) ids.add(id)
  }
  return ids
}

function remapSelectionAfterDeletedRestore(
  ctx: EditorContext,
  selection: Set<string>,
  restoredIds: Map<string, string>,
  deletedIds: Set<string>
) {
  const remapped = new Set<string>()
  for (const id of selection) {
    if (deletedIds.has(id)) {
      const restoredId = restoredIds.get(id)
      if (restoredId && ctx.graph.getNode(restoredId)) remapped.add(restoredId)
      continue
    }
    if (ctx.graph.getNode(id)) remapped.add(id)
  }
  return remapped
}

function pushPasteReplaceUndo(
  ctx: EditorContext,
  created: string[],
  deleted: DeletedEntry[],
  prevSelection: Set<string>
) {
  const createdSnapshots = collectSubtrees(ctx.graph, created)
  const pageId = ctx.state.currentPageId
  const deletedIds = deletedSnapshotIds(deleted)
  let currentCreated = [...created]
  let currentDeleted: string[] = []
  ctx.undo.push({
    label: 'Paste to replace',
    forward: () => {
      deleteIds(ctx, currentDeleted)
      currentDeleted = []
      const restoredCreatedIds = recreateSnapshots(ctx, createdSnapshots, pageId)
      currentCreated = remappedExistingRootIds(ctx, created, restoredCreatedIds)
      reorderCreatedAtReplacementIndex(ctx, currentCreated, deleted)
      computeAllLayouts(ctx.graph, pageId)
      ctx.setSelectedIds(new Set(currentCreated))
    },
    inverse: () => {
      deleteIds(ctx, currentCreated)
      currentCreated = []
      const restoredDeletedIds = restoreDeletedEntries(ctx, deleted)
      currentDeleted = remappedExistingRootIds(
        ctx,
        deleted.map((entry) => entry.id),
        restoredDeletedIds
      )
      computeAllLayouts(ctx.graph, pageId)
      ctx.setSelectedIds(
        remapSelectionAfterDeletedRestore(ctx, prevSelection, restoredDeletedIds, deletedIds)
      )
    }
  })
}

export function replaceTargetsWithCreated(
  ctx: EditorContext,
  centerNodesAt: CenterNodesAt,
  created: string[],
  targets: SceneNode[],
  prevSelection: Set<string>
) {
  if (created.length === 0 || targets.length === 0) return false
  const deleted = targets.map((node) => {
    const parentId = node.parentId ?? ctx.state.currentPageId
    const parent = ctx.graph.getNode(parentId)
    return {
      id: node.id,
      parentId,
      index: parent?.childIds.indexOf(node.id) ?? -1,
      subtree: snapshotSubtree(ctx.graph, node.id)
    }
  })

  const targetBounds = computeAbsoluteBounds(targets, (id) => ctx.graph.getAbsolutePosition(id))
  centerNodesAt(
    created,
    targetBounds.x + targetBounds.width / 2,
    targetBounds.y + targetBounds.height / 2
  )
  reorderCreatedAtReplacementIndex(ctx, created, deleted)
  for (const { id } of deleted) ctx.graph.deleteNode(id, { permanent: true })
  computeAllLayouts(ctx.graph, ctx.state.currentPageId)
  ctx.setSelectedIds(new Set(created))
  pushPasteReplaceUndo(ctx, created, deleted, prevSelection)
  return true
}
