import type { SceneNode } from '@open-pencil/scene-graph'
import { copyFills, copyStrokes } from '@open-pencil/scene-graph/copy'
import { computeAbsoluteBounds } from '@open-pencil/scene-graph/geometry'

import { canMakeBooleanSourceNode } from '#core/canvas/boolean'
import { restoreSubtreeEntries, snapshotSubtree } from '#core/editor/clipboard/subtree-history'
import type { EditorContext } from '#core/editor/types'

import { selectedNodesInSharedParent } from './selection'

export type BooleanOperation = 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE'

export function booleanOperationSelected(
  ctx: EditorContext,
  isTopLevel: (parentId: string | null) => boolean,
  selectedNodes: SceneNode[],
  operation: BooleanOperation
) {
  const selection = selectedNodesInSharedParent(ctx, selectedNodes)
  if (!selection || selection.topLevel.length < 2) return null
  const { topLevel, parentId, parent } = selection
  if (topLevel.some((node) => !canMakeBooleanSourceNode(node, ctx.graph))) return null

  const prevSelection = new Set(ctx.state.selectedIds)
  const childIds = topLevel.map((node) => node.id)
  const childSnapshots = childIds.map((id) => ({ id, subtree: snapshotSubtree(ctx.graph, id) }))
  const origPositions = topLevel.map((node) => ({ id: node.id, x: node.x, y: node.y }))
  const firstIndex = Math.min(...childIds.map((id) => parent.childIds.indexOf(id)))
  const parentAbs = isTopLevel(parentId) ? { x: 0, y: 0 } : ctx.graph.getAbsolutePosition(parentId)
  const bounds = computeAbsoluteBounds(topLevel, (id) => ctx.graph.getAbsolutePosition(id))

  const booleanNode = ctx.graph.createNode('BOOLEAN_OPERATION', parentId, {
    name: operationLabel(operation),
    x: bounds.x - parentAbs.x,
    y: bounds.y - parentAbs.y,
    width: bounds.width,
    height: bounds.height,
    fills: copyFills(topLevel[0].fills),
    strokes: copyStrokes(topLevel[0].strokes),
    booleanOperation: operation
  })
  const booleanId = booleanNode.id
  ctx.graph.insertChildAt(booleanId, parentId, firstIndex)
  for (const id of childIds) ctx.graph.reparentNode(id, booleanId)
  ctx.setSelectedIds(new Set([booleanId]))
  let currentBooleanId = booleanId
  let currentChildIds = [...childIds]

  ctx.undo.push({
    label: operationLabel(operation),
    forward: () => {
      // M-17: Use structuredClone to deep-copy the boolean node snapshot,
      // preventing shared mutable references with the original node.
      // M-07: Use mode: 'restore' so the undo can reuse the same runtime ID.
      const restored = ctx.graph.createNode(
        'BOOLEAN_OPERATION',
        parentId,
        structuredClone({ ...booleanNode, childIds: [], id: booleanId }),
        { mode: 'restore' }
      )
      currentBooleanId = restored.id
      ctx.graph.insertChildAt(restored.id, parentId, firstIndex)
      for (const id of currentChildIds) ctx.graph.reparentNode(id, restored.id)
      ctx.setSelectedIds(new Set([restored.id]))
    },
    inverse: () => {
      const { rootIds: restoredChildIds, oldToNew: restoredSelection } = restoreSubtreeEntries(
        ctx.graph,
        parentId,
        childSnapshots
      )
      for (let i = 0; i < childIds.length; i++) {
        const id = restoredChildIds[i]
        const pos = origPositions[i]
        if (!id) continue
        ctx.graph.insertChildAt(id, parentId, firstIndex + i)
        ctx.graph.updateNode(id, { x: pos.x, y: pos.y })
      }
      currentChildIds = restoredChildIds
      ctx.graph.deleteNode(currentBooleanId, { permanent: true })
      ctx.setSelectedIds(new Set([...prevSelection].map((id) => restoredSelection.get(id) ?? id)))
    }
  })

  return booleanId
}

function operationLabel(operation: BooleanOperation) {
  switch (operation) {
    case 'UNION':
      return 'Union'
    case 'SUBTRACT':
      return 'Subtract'
    case 'INTERSECT':
      return 'Intersect'
    case 'EXCLUDE':
      return 'Exclude'
    default: {
      const exhaustive: never = operation
      return exhaustive
    }
  }
}
