import type { GraphSyncState, SceneGraph } from '@open-pencil/core/scene-graph'

import { removeFromPendingQueues } from './graph-apply'

function removeSyncMappingForLocalNode(state: GraphSyncState, localNodeId: string): void {
  const remoteStableId = state.localToRemote.get(localNodeId)
  state.localToRemote.delete(localNodeId)
  if (remoteStableId === undefined) return
  removeFromPendingQueues(state, remoteStableId)
}

function collectSubtreeIds(graph: SceneGraph, nodeId: string, result: string[]): void {
  const node = graph.getNode(nodeId)
  if (node === undefined) return
  result.push(nodeId)
  for (const childId of node.childIds) collectSubtreeIds(graph, childId, result)
}

export function removeLocalRootChildrenForRemoteAdoption(
  graph: SceneGraph,
  state: GraphSyncState
): void {
  const root = graph.getNode(graph.rootId)
  if (root === undefined) return
  const childIds = [...root.childIds]
  const subtreeIds: string[] = []
  for (const childId of childIds) collectSubtreeIds(graph, childId, subtreeIds)
  for (const nodeId of subtreeIds) removeSyncMappingForLocalNode(state, nodeId)
  for (const childId of childIds) graph.deleteNode(childId, { permanent: false })
}

export function fallbackRootPageId(graph: SceneGraph, currentPageId: string): string | null {
  const currentPage = graph.getNode(currentPageId)
  if (currentPage?.type === 'CANVAS' && currentPage.parentId === graph.rootId) return null
  const pages = graph.getPages()
  if (pages.length === 0) return null
  return pages[0].id
}
