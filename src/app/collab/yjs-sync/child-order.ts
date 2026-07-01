import type { GraphSyncState, SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

import type { NodeProps } from './constants'
import { toRuntimeId } from './mapping'

type OrderApplyResult = 'waiting' | 'settled'

function remoteChildIdsFromProps(props: NodeProps): string[] | null {
  if (!Array.isArray(props.childIds)) return null
  const childIds: string[] = []
  for (const childId of props.childIds) {
    if (typeof childId !== 'string') return null
    childIds.push(childId)
  }
  return childIds
}

function applyChildOrder(
  graph: SceneGraph,
  state: GraphSyncState,
  parent: SceneNode,
  childStableIds: readonly string[]
): OrderApplyResult {
  const targetOrder: string[] = []
  for (const childStableId of childStableIds) {
    const childId = toRuntimeId(graph, state, childStableId)
    if (childId === undefined) return 'waiting'
    targetOrder.push(childId)
  }

  if (targetOrder.length !== parent.childIds.length) return 'waiting'
  const localChildren = new Set(parent.childIds)
  if (!targetOrder.every((childId) => localChildren.has(childId))) return 'waiting'

  for (let index = 0; index < targetOrder.length; index++) {
    if (parent.childIds[index] !== targetOrder[index]) {
      graph.reorderChild(targetOrder[index], parent.id, index)
    }
  }
  return 'settled'
}

export function applyOrQueueRemoteChildOrder(
  graph: SceneGraph,
  state: GraphSyncState,
  parent: SceneNode,
  parentStableId: string,
  props: NodeProps
): void {
  const childStableIds = remoteChildIdsFromProps(props)
  if (childStableIds === null) return
  const result = applyChildOrder(graph, state, parent, childStableIds)
  if (result === 'waiting') {
    state.pendingChildOrders.set(parentStableId, childStableIds)
  } else {
    state.pendingChildOrders.delete(parentStableId)
  }
}

export function releasePendingChildOrders(graph: SceneGraph, state: GraphSyncState): void {
  for (const [parentStableId, childStableIds] of state.pendingChildOrders) {
    const parentId = toRuntimeId(graph, state, parentStableId)
    const parent = parentId === undefined ? undefined : graph.getNode(parentId)
    if (parent === undefined) continue
    if (applyChildOrder(graph, state, parent, childStableIds) === 'settled') {
      state.pendingChildOrders.delete(parentStableId)
    }
  }
}

export function removePendingChildOrderReferences(
  state: GraphSyncState,
  remoteStableId: string
): void {
  state.pendingChildOrders.delete(remoteStableId)
  for (const [parentStableId, childStableIds] of state.pendingChildOrders) {
    if (childStableIds.includes(remoteStableId)) {
      state.pendingChildOrders.delete(parentStableId)
    }
  }
}
