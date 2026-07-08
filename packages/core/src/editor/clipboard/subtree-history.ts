import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { remapRestoredSnapshotReferences } from '#core/editor/history/restore-references'

export interface SubtreeSnapshotEntry {
  id: string
  subtree: Map<string, SceneNode>
}

export function collectSubtrees(graph: SceneGraph, rootIds: string[]): SceneNode[] {
  const result: SceneNode[] = []
  function walk(id: string) {
    const node = graph.getNode(id)
    if (!node) return
    result.push(structuredClone(node))
    for (const childId of node.childIds) walk(childId)
  }
  for (const id of rootIds) walk(id)
  return result
}

export function snapshotSubtree(graph: SceneGraph, rootId: string): Map<string, SceneNode> {
  const index = new Map<string, SceneNode>()
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    index.set(id, structuredClone(node))
    for (const childId of node.childIds) walk(childId)
  }
  walk(rootId)
  return index
}

export function restoreSubtree(
  graph: SceneGraph,
  snapshot: SceneNode,
  parentId: string,
  index: Map<string, SceneNode>,
  oldToNew: Map<string, string> = new Map()
): { rootId: string; oldToNew: Map<string, string> } {
  const { parentId: _parentId, childIds, ...rest } = snapshot
  const restored = graph.createNode(
    snapshot.type,
    parentId,
    { ...rest, id: snapshot.id },
    { mode: 'restore' }
  )
  oldToNew.set(snapshot.id, restored.id)
  for (const childId of childIds) {
    const child = index.get(childId)
    if (child) restoreSubtree(graph, child, restored.id, index, oldToNew)
  }
  return { rootId: restored.id, oldToNew }
}

export function restoreSubtreeEntries(
  graph: SceneGraph,
  parentId: string,
  entries: SubtreeSnapshotEntry[]
): { rootIds: string[]; oldToNew: Map<string, string> } {
  const oldToNew = new Map<string, string>()
  const snapshots: SceneNode[] = []
  const rootIds: string[] = []

  for (const { id, subtree } of entries) {
    for (const snapshot of subtree.values()) snapshots.push(snapshot)
    const root = subtree.get(id)
    if (!root) continue
    const restored = restoreSubtree(graph, root, parentId, subtree, oldToNew)
    rootIds.push(restored.rootId)
  }

  remapRestoredSnapshotReferences(graph, snapshots, oldToNew)
  return { rootIds, oldToNew }
}
