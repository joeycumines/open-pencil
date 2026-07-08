import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { EditorContext } from '#core/editor/types'
import { computeAllLayouts } from '#core/layout'

import { remapRestoredSnapshotReferences } from './restore-references'

export type PageSnapshot = Map<string, SceneNode>

export function snapshotPage(graph: SceneGraph, pageId: string): PageSnapshot {
  const snapshot: PageSnapshot = new Map()
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    snapshot.set(id, structuredClone(node))
    for (const childId of node.childIds) walk(childId)
  }
  walk(pageId)
  return snapshot
}

export function restorePageFromSnapshot(ctx: EditorContext, snapshot: PageSnapshot): void {
  const pageId = ctx.state.currentPageId
  const page = ctx.graph.getNode(pageId)
  const pageSnap = snapshot.get(pageId)
  if (!page || !pageSnap) return

  for (const childId of page.childIds.slice()) {
    ctx.graph.deleteNode(childId, { permanent: false })
  }
  const oldToNew = new Map<string, string>()
  restoreChildren(ctx.graph, snapshot, pageId, pageSnap.childIds, oldToNew)
  remapRestoredSnapshotReferences(ctx.graph, snapshot.values(), oldToNew)

  ctx.graph.clearAbsPosCache()
  computeAllLayouts(ctx.graph, pageId)
  ctx.setSelectedIds(new Set())
  ctx.state.hoveredNodeId = null
  ctx.requestRender()
}

function restoreChildren(
  graph: SceneGraph,
  snapshot: PageSnapshot,
  parentId: string,
  childIds: string[],
  oldToNew: Map<string, string>
): void {
  for (let index = 0; index < childIds.length; index++) {
    const childId = childIds[index]
    const snap = snapshot.get(childId)
    if (!snap) continue
    const { parentId: _snapParentId, childIds: snapChildIds, ...rest } = snap
    const restored = graph.createNode(
      snap.type,
      parentId,
      { ...rest, childIds: [] },
      { mode: 'restore' }
    )
    oldToNew.set(snap.id, restored.id)
    graph.reorderChild(restored.id, parentId, index)
    restoreChildren(graph, snapshot, restored.id, snapChildIds, oldToNew)
  }
}
