import type { SceneGraph } from '#core/scene-graph'

export function deleteNode(graph: SceneGraph, id: string, options?: { permanent?: boolean }): void {
  const node = graph.nodes.get(id)
  if (!node || id === graph.rootId) return

  if (node.parentId) {
    const parent = graph.nodes.get(node.parentId)
    if (parent) {
      parent.childIds = parent.childIds.filter((cid) => cid !== id)
    }
  }

  for (const childId of Array.from(node.childIds)) {
    deleteNode(graph, childId, options)
  }

  if (node.type === 'INSTANCE' && node.componentId) {
    graph.instanceIndex.get(node.componentId)?.delete(id)
  }

  graph.identity.maybeUnreserveImportedId(node, options)

  graph.nodes.delete(id)
  graph.emitter.emit('node:deleted', id)
}

export function deleteNodes(
  graph: SceneGraph,
  ids: Iterable<string>,
  options?: { permanent?: boolean }
): void {
  for (const id of ids) {
    deleteNode(graph, id, options)
  }
}
