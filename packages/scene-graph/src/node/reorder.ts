import type { SceneGraph } from '../'

/**
 * Moves a node to a specific index within a parent's childIds array.
 *
 * Handles cross-parent moves (removes from old parent first) and same-parent
 * reordering. The index is clamped to the child array length (after removal)
 * to prevent out-of-bounds splicing. Emits `node:reordered` with the final
 * insert index.
 */
export function reorderChild(
  graph: SceneGraph,
  nodeId: string,
  parentId: string,
  insertIndex: number
): void {
  const node = graph.nodes.get(nodeId)
  if (!node) return

  const oldParent = node.parentId ? graph.nodes.get(node.parentId) : undefined
  const newParent = graph.nodes.get(parentId)
  if (!newParent) return

  // Remove from old parent (also handles same-parent: the item is taken out
  // before re-inserting at the target index).
  if (oldParent) {
    oldParent.childIds = oldParent.childIds.filter((cid) => cid !== nodeId)
  }

  node.parentId = parentId
  const idx = Math.min(insertIndex, newParent.childIds.length)
  newParent.childIds.splice(idx, 0, nodeId)

  // M-03: Clear absPosCache on cross-parent moves — the node's absolute
  // position changes when it moves to a different parent. Same-parent
  // reorders don't affect position, but clearing is cheap and consistent
  // with insertChildAt.
  if (oldParent?.id !== parentId) {
    graph.clearAbsPosCache()
  }

  graph.emitter.emit('node:reordered', nodeId, parentId, idx)
}
