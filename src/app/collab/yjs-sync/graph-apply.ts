import type * as Y from 'yjs'

import type { GraphSyncState, SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

import type { NodeProps, YNodes } from './constants'
import { findNodeByStableId, toRuntimeId } from './mapping'
import {
  asString,
  buildCreateProps,
  buildUpdateProps,
  isRecord,
  isSceneNodeType,
  remapOverridesToLocal,
  yNodeToProps
} from './serialize'

function queuePending<K extends string, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key)
  if (set === undefined) {
    set = new Set()
    map.set(key, set)
  }
  set.add(value)
}

function releasePendingOverrideKeys(
  state: GraphSyncState,
  graph: SceneGraph,
  childStableId: string
): void {
  const entries = state.pendingOverrideKeys.get(childStableId)
  if (entries === undefined) return
  const localChildId = toRuntimeId(graph, state, childStableId)
  if (localChildId === undefined) {
    state.pendingOverrideKeys.delete(childStableId)
    return
  }

  // Group pending entries by the instance that owns them so each instance gets a
  // single merged update. Applying entries one at a time would replace
  // `node.overrides` on every call (graph.updateNode assigns the field rather than
  // merging per-key), clobbering both other pending entries for the same instance
  // and any overrides that were already resolved on it.
  const byInstance = new Map<string, Array<{ prop: string; value: unknown }>>()
  for (const entry of entries) {
    let list = byInstance.get(entry.remoteStableId)
    if (list === undefined) {
      list = []
      byInstance.set(entry.remoteStableId, list)
    }
    list.push({ prop: entry.prop, value: entry.value })
  }

  for (const [instanceStableId, list] of byInstance) {
    const localId = state.remoteToLocal.get(instanceStableId)
    const existing = localId === undefined ? undefined : graph.getNode(localId)
    if (existing === undefined) continue
    // Keys are already in LOCAL child-id form, so merge directly into the
    // existing overrides map instead of routing through buildUpdateProps /
    // remapOverridesToLocal (which expect remote-stable child ids and would
    // re-queue the already-local keys as pending).
    const merged: Record<string, unknown> = { ...existing.overrides }
    for (const { prop, value } of list) {
      merged[`${localChildId}:${prop}`] = value
    }
    graph.updateNode(existing.id, { overrides: merged })
  }
  state.pendingOverrideKeys.delete(childStableId)
}

function releasePendingNode(
  state: GraphSyncState,
  graph: SceneGraph,
  ynodes: YNodes,
  remoteStableId: string
): void {
  const waitingChildren = state.pendingParents.get(remoteStableId)
  if (waitingChildren !== undefined) {
    for (const childStableId of waitingChildren) {
      const childYnode = ynodes.get(childStableId)
      if (childYnode !== undefined) {
        applyYnodeToGraph(graph, state, ynodes, childStableId, childYnode)
      }
    }
    state.pendingParents.delete(remoteStableId)
  }

  const waitingInstances = state.pendingComponents.get(remoteStableId)
  if (waitingInstances !== undefined) {
    for (const instStableId of waitingInstances) {
      const instYnode = ynodes.get(instStableId)
      if (instYnode !== undefined) {
        applyYnodeToGraph(graph, state, ynodes, instStableId, instYnode)
      }
    }
    state.pendingComponents.delete(remoteStableId)
  }

  releasePendingOverrideKeys(state, graph, remoteStableId)
}

export function applyYnodeToGraph(
  graph: SceneGraph,
  state: GraphSyncState,
  ynodes: YNodes,
  remoteStableId: string,
  ynode: Y.Map<unknown>
): void {
  const props = yNodeToProps(ynode)

  if (!state.rootMapped && remoteStableId !== state.remoteRootStableId) {
    state.pendingUntilRoot.add(remoteStableId)
    return
  }

  const parentStableId = asString(props.parentId)
  if (parentStableId !== undefined) {
    const parentId = toRuntimeId(graph, state, parentStableId)
    if (parentId === undefined) {
      queuePending(state.pendingParents, parentStableId, remoteStableId)
      return
    }
  }

  const componentStableId = asString(props.componentId)
  if (componentStableId !== undefined) {
    const componentId = toRuntimeId(graph, state, componentStableId)
    if (componentId === undefined) {
      queuePending(state.pendingComponents, componentStableId, remoteStableId)
      return
    }
  }

  const existing = findExistingLocalNode(graph, state, remoteStableId)
  if (existing !== undefined) {
    applyExistingNodeUpdate(graph, state, props, existing)
  } else {
    applyNewNodeCreate(graph, state, props, remoteStableId)
  }

  releasePendingNode(state, graph, ynodes, remoteStableId)
}

function findExistingLocalNode(
  graph: SceneGraph,
  state: GraphSyncState,
  remoteStableId: string
): SceneNode | undefined {
  const localId = state.remoteToLocal.get(remoteStableId)
  if (localId !== undefined) {
    return graph.getNode(localId) ?? findNodeByStableId(graph, remoteStableId)
  }
  const found = findNodeByStableId(graph, remoteStableId)
  if (found !== undefined) {
    state.remoteToLocal.set(remoteStableId, found.id)
    state.localToRemote.set(found.id, remoteStableId)
  }
  return found
}

function applyExistingNodeUpdate(
  graph: SceneGraph,
  state: GraphSyncState,
  props: NodeProps,
  existing: SceneNode
): void {
  const updateProps = buildUpdateProps(graph, state, props, existing)
  if (typeof updateProps.parentId === 'string' && updateProps.parentId !== existing.parentId) {
    graph.reparentNode(existing.id, updateProps.parentId)
    delete updateProps.parentId
  }
  graph.updateNode(existing.id, updateProps)

  const updatedNode = graph.getNode(existing.id)
  if (
    updatedNode?.type === 'INSTANCE' &&
    typeof updatedNode.componentId === 'string' &&
    updatedNode.childIds.length === 0
  ) {
    graph.populateInstanceChildren(updatedNode.id, updatedNode.componentId)
  }
}

function applyNewNodeCreate(
  graph: SceneGraph,
  state: GraphSyncState,
  props: NodeProps,
  remoteStableId: string
): void {
  const createProps = buildCreateProps(graph, state, props, remoteStableId)
  const typeCandidate = asString(createProps.type) ?? 'FRAME'
  if (!isSceneNodeType(typeCandidate)) return

  const node = graph.createNode(typeCandidate, createProps.parentId ?? graph.rootId, createProps)
  state.remoteToLocal.set(remoteStableId, node.id)
  state.localToRemote.set(node.id, remoteStableId)

  if (props.overrides !== undefined && isRecord(props.overrides)) {
    node.overrides = remapOverridesToLocal(graph, state, props.overrides, remoteStableId)
  }
}

export function removeFromPendingQueues(state: GraphSyncState, remoteStableId: string): void {
  const localId = state.remoteToLocal.get(remoteStableId)
  state.remoteToLocal.delete(remoteStableId)
  if (localId !== undefined) {
    state.localToRemote.delete(localId)
  }
  state.pendingParents.delete(remoteStableId)
  state.pendingComponents.delete(remoteStableId)
  state.pendingOverrideKeys.delete(remoteStableId)
  state.pendingUntilRoot.delete(remoteStableId)
  // Clean up pending overrides that reference this node as the owning
  // instance. pendingOverrideKeys is keyed by CHILD stable id, but each
  // entry's remoteStableId is the INSTANCE's stable id. When an instance is
  // deleted, its pending overrides (for children that may never arrive
  // locally) would otherwise leak until session end. Map iteration is safe
  // for in-place delete/set on visited entries per the ECMAScript spec.
  for (const [childStableId, entries] of state.pendingOverrideKeys) {
    const remaining = [...entries].filter((e) => e.remoteStableId !== remoteStableId)
    if (remaining.length === entries.size) continue
    if (remaining.length === 0) {
      state.pendingOverrideKeys.delete(childStableId)
    } else {
      state.pendingOverrideKeys.set(childStableId, new Set(remaining))
    }
  }
}
