import type { SceneGraph } from '#core/scene-graph'

export function deleteNode(graph: SceneGraph, id: string, options?: { permanent?: boolean }): void {
  const node = graph.nodes.get(id)
  if (!node || id === graph.rootId) return

  if (node.parentId) {
    const parent = graph.nodes.get(node.parentId)
    if (parent) {
      const index = parent.childIds.indexOf(id)
      if (index !== -1) {
        parent.childIds.splice(index, 1)
        while (parent.childIds[index] === id) parent.childIds.splice(index, 1)
      }
    }
  }

  for (const childId of Array.from(node.childIds)) {
    deleteNode(graph, childId, options)
  }

  if (node.type === 'INSTANCE' && node.componentId) {
    graph.instanceIndex.get(node.componentId)?.delete(id)
  }

  graph.identity.maybeUnreserveImportedId(node, options)
  graph.identity.unregisterStableId(id, node.source.id)

  graph.nodes.delete(id)
  graph.clearAbsPosCache()
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
