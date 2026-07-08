import type { SceneGraph } from '../'

/**
 * Moves a node from its current parent to a new parent, adjusting x/y so
 * the node stays in the same visual position.
 *
 * Guards against:
 *  - reparenting the root node
 *  - reparenting into a descendant (would create a cycle)
 *  - reparenting to the same parent (no-op)
 *  - reparenting to a non-existent parent
 *
 * Emits `node:reparented` with old and new parent ids after the move.
 */
export function reparentNode(graph: SceneGraph, nodeId: string, newParentId: string): void {
  const node = graph.nodes.get(nodeId)
  if (!node || nodeId === graph.rootId) return
  if (graph.isDescendant(newParentId, nodeId)) return

  const oldParent = node.parentId ? graph.nodes.get(node.parentId) : undefined
  const newParent = graph.nodes.get(newParentId)
  if (!newParent) return
  if (node.parentId === newParentId) return

  const oldParentId = node.parentId
  graph.clearAbsPosCache()

  // Convert absolute position
  const absPos = graph.getAbsolutePosition(nodeId)
  const newParentNode = graph.nodes.get(newParentId)
  const newParentAbs =
    newParentId === graph.rootId || newParentNode?.type === 'CANVAS'
      ? { x: 0, y: 0 }
      : graph.getAbsolutePosition(newParentId)

  // Remove from old parent
  if (oldParent) {
    oldParent.childIds = oldParent.childIds.filter((cid) => cid !== nodeId)
  }

  // Add to new parent
  node.parentId = newParentId
  newParent.childIds.push(nodeId)

  // Adjust position so node stays in same visual place
  node.x = absPos.x - newParentAbs.x
  node.y = absPos.y - newParentAbs.y

  graph.emitter.emit('node:reparented', nodeId, oldParentId, newParentId)
}
