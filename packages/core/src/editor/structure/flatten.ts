import { canMakeBooleanSourceNode, hasVisibleStrokeSourceNode } from '#core/canvas/boolean'
import { flattenNodesToVectorProps, outlineStrokeNodesToVectorProps } from '#core/canvas/flatten'
import { restoreSubtreeEntries, snapshotSubtree } from '#core/editor/clipboard/subtree-history'
import type { EditorContext } from '#core/editor/types'
import type { SceneNode } from '#core/scene-graph'

import { selectedNodesInSharedParent } from './selection'

type VectorPropsFactory = typeof flattenNodesToVectorProps

type FlattenOptions = {
  label?: string
  canFlattenNode?: (node: SceneNode) => boolean
  vectorPropsFactory?: VectorPropsFactory
}

export function flattenSelected(
  ctx: EditorContext,
  selectedNodes: SceneNode[],
  options: FlattenOptions = {}
) {
  const label = options.label ?? 'Flatten'
  const canFlattenNode =
    options.canFlattenNode ?? ((node: SceneNode) => canMakeBooleanSourceNode(node, ctx.graph))
  const vectorPropsFactory = options.vectorPropsFactory ?? flattenNodesToVectorProps
  const renderer = ctx.getRenderer()
  if (!renderer) return null

  const selection = selectedNodesInSharedParent(ctx, selectedNodes)
  if (!selection) return null
  const { topLevel, parentId, parent } = selection
  if (topLevel.some((node) => !canFlattenNode(node))) return null

  const childIds = topLevel.map((node) => node.id)
  const childSnapshots = childIds.map((id) => ({ id, subtree: snapshotSubtree(ctx.graph, id) }))
  const prevSelection = new Set(ctx.state.selectedIds)
  const firstIndex = Math.min(...childIds.map((id) => parent.childIds.indexOf(id)))
  const vectorProps = vectorPropsFactory(renderer, ctx.graph, topLevel)
  if (!vectorProps) return null

  const vector = ctx.graph.createNode('VECTOR', parentId, {
    ...vectorProps,
    name: label,
    strokes: []
  })
  const vectorSnapshot = structuredClone(vector)
  ctx.graph.insertChildAt(vector.id, parentId, firstIndex)
  for (const id of childIds) ctx.graph.deleteNode(id, { permanent: true })
  ctx.setSelectedIds(new Set([vector.id]))
  let currentVectorId = vector.id
  let currentChildIds = [...childIds]

  ctx.undo.push({
    label,
    forward: () => {
      // M-07: Use mode: 'restore' so the undo can reuse the same runtime ID
      const restored = ctx.graph.createNode('VECTOR', parentId, vectorSnapshot, { mode: 'restore' })
      currentVectorId = restored.id
      ctx.graph.insertChildAt(restored.id, parentId, firstIndex)
      for (const id of currentChildIds) ctx.graph.deleteNode(id, { permanent: true })
      currentChildIds = []
      ctx.setSelectedIds(new Set([restored.id]))
    },
    inverse: () => {
      ctx.graph.deleteNode(currentVectorId, { permanent: true })
      const { rootIds: restoredChildIds, oldToNew: restoredSelection } = restoreSubtreeEntries(
        ctx.graph,
        parentId,
        childSnapshots
      )
      for (let i = 0; i < restoredChildIds.length; i++) {
        const restoredRootId = restoredChildIds[i]
        if (!restoredRootId) continue
        ctx.graph.insertChildAt(restoredRootId, parentId, firstIndex + i)
      }
      currentChildIds = restoredChildIds
      ctx.setSelectedIds(new Set([...prevSelection].map((id) => restoredSelection.get(id) ?? id)))
    }
  })

  return vector.id
}

export function outlineStrokeSelected(ctx: EditorContext, selectedNodes: SceneNode[]) {
  return flattenSelected(ctx, selectedNodes, {
    label: 'Outline stroke',
    canFlattenNode: (node) =>
      canMakeBooleanSourceNode(node, ctx.graph) && hasVisibleStrokeSourceNode(node, ctx.graph),
    vectorPropsFactory: outlineStrokeNodesToVectorProps
  })
}
