import type * as Y from 'yjs'

import type { GraphSyncState, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  applyOrQueueRemoteChildOrder,
  releasePendingChildOrders,
  removePendingChildOrderReferences
} from './child-order'
import { YJS_ORIGINAL_SOURCE_ID_KEY, type NodeProps, type YNodes } from './constants'
import {
  applyInstanceOverrideValuesToChildren,
  canStoreInstanceDescendantOverrideProp,
  findInstanceDescendantByStableId,
  findInstanceDescendantByStablePath,
  resolveInstanceOverrideChildId
} from './instance-descendants'
import { findNodeByStableId, stableIdForNode, toRuntimeId } from './mapping'
import { mergeNestedInstanceOverridePath } from './nested-overrides'
import { resolveRemoteParentId } from './parent-routing'
import { INVALID_YJS_NODE_VALUE, validateYNodePropertyValue } from './payload-validation'
import { isMalformedRemoteNodeKey, rawStableIdFromRemoteNodeKey } from './remote-node-key'
import {
  asString,
  buildCreateProps,
  buildUpdateProps,
  isRecord,
  isSceneNodeType,
  remapOverridesToLocal,
  yNodeToProps
} from './serialize'
import { remapBoundVariablesToLocal } from './variable/sync'

function queuePending<K extends string, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key)
  if (set === undefined) {
    set = new Set()
    map.set(key, set)
  }
  set.add(value)
}

type PendingOverrideEntry =
  GraphSyncState['pendingOverrideKeys'] extends Map<string, Set<infer Entry>> ? Entry : never

function releasePendingOverrideKeys(
  state: GraphSyncState,
  graph: SceneGraph,
  childStableId: string
): void {
  const entries = state.pendingOverrideKeys.get(childStableId)
  if (entries === undefined) return
  // Group pending entries by the instance that owns them so each instance gets a
  // single merged update. Applying entries one at a time would replace
  // `node.overrides` on every call (graph.updateNode assigns the field rather than
  // merging per-key), clobbering both other pending entries for the same instance
  // and any overrides that were already resolved on it.
  const byInstance = new Map<string, PendingOverrideEntry[]>()
  for (const entry of entries) {
    let list = byInstance.get(entry.remoteStableId)
    if (list === undefined) {
      list = []
      byInstance.set(entry.remoteStableId, list)
    }
    list.push(entry)
  }

  const unresolved = new Set<PendingOverrideEntry>()
  for (const [instanceStableId, list] of byInstance) {
    const localId = state.remoteToLocal.get(instanceStableId)
    const existing = localId === undefined ? undefined : graph.getNode(localId)
    if (existing === undefined) {
      for (const entry of list) unresolved.add(entry)
      continue
    }
    // Keys are already in LOCAL child-id form, so merge directly into the
    // existing overrides map instead of routing through buildUpdateProps /
    // remapOverridesToLocal (which expect remote-stable child ids and would
    // re-queue the already-local keys as pending).
    let merged: Record<string, unknown> = { ...existing.overrides }
    let changed = false
    for (const { nestedInstanceStablePath, prop, value } of list) {
      if (hasNestedInstanceStablePath(nestedInstanceStablePath)) {
        const mergedNested = mergeNestedPendingOverride(
          graph,
          state,
          merged,
          existing,
          instanceStableId,
          nestedInstanceStablePath,
          childStableId,
          prop,
          value
        )
        if (mergedNested !== undefined) {
          merged = mergedNested
          changed = true
        } else {
          unresolved.add({
            remoteStableId: instanceStableId,
            nestedInstanceStablePath,
            prop,
            value
          })
        }
        continue
      }
      const localChildId = resolveInstanceOverrideChildId(
        graph,
        state,
        instanceStableId,
        childStableId
      )
      if (localChildId === undefined) {
        unresolved.add({ remoteStableId: instanceStableId, prop, value })
        continue
      }
      const localChildStableId = resolvedOverrideChildStableId(graph, localChildId, childStableId)
      const remappedValue = remapPendingOverrideValue(
        graph,
        state,
        instanceStableId,
        localChildStableId,
        prop,
        value
      )
      if (remappedValue === INVALID_YJS_NODE_VALUE) continue
      merged[`${localChildStableId}:${prop}`] = remappedValue
      changed = true
    }
    if (!changed) continue
    graph.updateNode(existing.id, { overrides: merged })
    const updated = graph.getNode(existing.id)
    if (updated !== undefined) applyInstanceOverrideValuesToChildren(graph, updated)
  }
  if (unresolved.size === 0) {
    state.pendingOverrideKeys.delete(childStableId)
  } else {
    state.pendingOverrideKeys.set(childStableId, unresolved)
  }
}

function resolvedOverrideChildStableId(
  graph: SceneGraph,
  localChildId: string,
  remoteChildStableId: string
): string {
  const localChild = graph.getNode(localChildId)
  if (localChild !== undefined) return stableIdForNode(localChild)
  return rawStableIdFromRemoteNodeKey(remoteChildStableId) ?? remoteChildStableId
}

function mergeNestedPendingOverride(
  graph: SceneGraph,
  state: GraphSyncState,
  merged: Record<string, unknown>,
  ownerInstance: SceneNode,
  ownerInstanceStableId: string,
  nestedInstanceStablePath: readonly string[],
  childStableId: string,
  prop: string,
  value: unknown
): Record<string, unknown> | undefined {
  const nestedInstance = findInstanceDescendantByStablePath(
    graph,
    ownerInstance,
    nestedInstanceStablePath
  )
  if (nestedInstance?.type !== 'INSTANCE') return undefined
  const nestedChild = findInstanceDescendantByStableId(graph, nestedInstance, childStableId)
  if (nestedChild === undefined) return undefined
  const remappedValue = remapPendingOverrideValue(
    graph,
    state,
    ownerInstanceStableId,
    childStableId,
    prop,
    value,
    nestedInstanceStablePath
  )
  if (remappedValue === INVALID_YJS_NODE_VALUE) return undefined

  return mergeNestedInstanceOverridePath(
    graph,
    ownerInstance,
    merged,
    nestedInstanceStablePath,
    childStableId,
    prop,
    remappedValue
  )
}

function hasNestedInstanceStablePath(
  nestedInstanceStablePath: readonly string[] | undefined
): nestedInstanceStablePath is readonly string[] {
  return nestedInstanceStablePath !== undefined && nestedInstanceStablePath.length > 0
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

function remapPendingOverrideValue(
  graph: SceneGraph,
  state: GraphSyncState,
  instanceStableId: string,
  childStableId: string,
  prop: string,
  value: unknown,
  nestedInstanceStablePath?: readonly string[]
): unknown {
  if (!canStoreInstanceDescendantOverrideProp(prop)) return INVALID_YJS_NODE_VALUE
  if (prop === 'boundVariables' && isStringRecord(value)) {
    return remapBoundVariablesToLocal(
      graph,
      state,
      value,
      childStableId,
      instanceStableId,
      nestedInstanceStablePath
    )
  }
  if (prop === 'overrides' && isRecord(value)) {
    return remapOverridesToLocal(graph, state, value, instanceStableId, [
      ...(nestedInstanceStablePath ?? []),
      childStableId
    ])
  }
  return validateYNodePropertyValue(prop, value)
}

function findComponentAncestor(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current: SceneNode | undefined = node
  while (current !== undefined && current.parentId !== null) {
    const parent = graph.getNode(current.parentId)
    if (parent?.type === 'COMPONENT') return parent
    current = parent
  }
  return undefined
}

function syncInstancesForComponentAncestor(
  state: GraphSyncState,
  graph: SceneGraph,
  remoteStableId: string
): void {
  const localId = state.remoteToLocal.get(remoteStableId)
  const node = localId === undefined ? undefined : graph.getNode(localId)
  if (node === undefined) return
  const component = node.type === 'COMPONENT' ? node : findComponentAncestor(graph, node)
  if (component === undefined) return
  syncComponentAndContainingComponentInstances(graph, component.id)
}

function syncComponentAndContainingComponentInstances(
  graph: SceneGraph,
  componentId: string
): void {
  const pending = [componentId]
  const syncedEdges = new Set<string>()

  for (const currentComponentId of pending) {
    graph.syncInstances(currentComponentId)
    for (const ancestorId of componentAncestorsContainingInstancesOf(graph, currentComponentId)) {
      if (ancestorId === currentComponentId) continue
      const edgeKey = `${currentComponentId}\u0000${ancestorId}`
      if (syncedEdges.has(edgeKey)) continue
      syncedEdges.add(edgeKey)
      pending.push(ancestorId)
    }
  }
}

function componentAncestorsContainingInstancesOf(graph: SceneGraph, componentId: string): string[] {
  const ancestors = new Set<string>()
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'INSTANCE' || node.componentId !== componentId) continue
    let parentId = node.parentId
    while (parentId !== null) {
      const parent = graph.getNode(parentId)
      if (parent === undefined) break
      if (parent.type === 'COMPONENT') ancestors.add(parent.id)
      parentId = parent.parentId
    }
  }
  return [...ancestors]
}

function releasePendingNode(
  state: GraphSyncState,
  graph: SceneGraph,
  ynodes: YNodes,
  remoteStableId: string
): void {
  syncInstancesForComponentAncestor(state, graph, remoteStableId)

  const waitingChildren = state.pendingParents.get(remoteStableId)
  if (waitingChildren !== undefined) {
    state.pendingParents.delete(remoteStableId)
    for (const childStableId of waitingChildren) {
      const childYnode = ynodes.get(childStableId)
      if (childYnode !== undefined) {
        applyYnodeToGraph(graph, state, ynodes, childStableId, childYnode)
      }
    }
  }

  const waitingInstances = state.pendingComponents.get(remoteStableId)
  if (waitingInstances !== undefined) {
    state.pendingComponents.delete(remoteStableId)
    for (const instStableId of waitingInstances) {
      const instYnode = ynodes.get(instStableId)
      if (instYnode !== undefined) {
        applyYnodeToGraph(graph, state, ynodes, instStableId, instYnode)
      }
    }
  }

  releasePendingOverrideKeys(state, graph, remoteStableId)
  releasePendingChildOrders(graph, state)
}

function isUnderAbandonedRoot(
  state: GraphSyncState,
  ynodes: YNodes,
  remoteStableId: string
): boolean {
  if (state.remoteRootStableId === null) return false
  const visited = new Set<string>()
  let currentStableId = remoteStableId

  while (!visited.has(currentStableId)) {
    visited.add(currentStableId)
    const ynode = ynodes.get(currentStableId)
    if (ynode === undefined) return false
    const parentStableId = asString(ynode.get('parentId'))
    if (parentStableId === undefined) return false
    if (parentStableId === currentStableId) {
      return currentStableId !== state.remoteRootStableId
    }
    currentStableId = parentStableId
  }

  return false
}

export function applyYnodeToGraph(
  graph: SceneGraph,
  state: GraphSyncState,
  ynodes: YNodes,
  remoteStableId: string,
  ynode: Y.Map<unknown>
): void {
  if (isMalformedRemoteNodeKey(remoteStableId)) return

  const props = yNodeToProps(ynode)

  if (!state.rootMapped && remoteStableId !== state.remoteRootStableId) {
    state.pendingUntilRoot.add(remoteStableId)
    return
  }

  if (state.rootMapped && isUnderAbandonedRoot(state, ynodes, remoteStableId)) {
    removeFromPendingQueues(state, remoteStableId)
    return
  }

  const parentStableId = asString(props.parentId)
  if (parentStableId !== undefined) {
    const parentResolution = resolveRemoteParentId(graph, state, props)
    if (parentResolution.parentId === undefined) {
      if (parentResolution.invalid) return
      queuePending(
        state.pendingParents,
        parentResolution.pendingStableId ?? parentStableId,
        remoteStableId
      )
      return
    }
  }

  const componentStableId = asString(props.componentId)
  if (componentStableId !== undefined) {
    if (isMalformedRemoteNodeKey(componentStableId)) return
    const componentId = toRuntimeId(graph, state, componentStableId)
    if (componentId === undefined) {
      queuePending(state.pendingComponents, componentStableId, remoteStableId)
      return
    }
  }

  const existing = findExistingLocalNode(graph, state, remoteStableId, props)
  if (existing !== undefined) {
    applyExistingNodeUpdate(graph, state, props, existing, remoteStableId)
  } else {
    applyNewNodeCreate(graph, state, props, remoteStableId)
  }

  releasePendingNode(state, graph, ynodes, remoteStableId)
  const originalSourceId = asString(props[YJS_ORIGINAL_SOURCE_ID_KEY])
  if (originalSourceId !== undefined) {
    releasePendingOverrideKeys(state, graph, originalSourceId)
  }
}

function findExistingLocalNode(
  graph: SceneGraph,
  state: GraphSyncState,
  remoteStableId: string,
  props: NodeProps
): SceneNode | undefined {
  const localId = state.remoteToLocal.get(remoteStableId)
  if (localId !== undefined) {
    return graph.getNode(localId) ?? findNodeByStableId(graph, remoteStableId)
  }
  const originalSourceId = asString(props[YJS_ORIGINAL_SOURCE_ID_KEY])
  if (originalSourceId !== undefined) {
    const parentResolution = resolveRemoteParentId(graph, state, props)
    const parent =
      parentResolution.parentId === undefined ? undefined : graph.getNode(parentResolution.parentId)
    const existingChild = parent?.childIds
      .map((childId) => graph.getNode(childId))
      .find((child) => child !== undefined && stableIdForNode(child) === originalSourceId)
    if (existingChild !== undefined) {
      state.remoteToLocal.set(remoteStableId, existingChild.id)
      state.localToRemote.set(existingChild.id, remoteStableId)
      return existingChild
    }
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
  existing: SceneNode,
  remoteStableId: string
): void {
  const updateProps = buildUpdateProps(graph, state, props, existing, remoteStableId)
  if (typeof updateProps.parentId === 'string' && updateProps.parentId !== existing.parentId) {
    graph.reparentNode(existing.id, updateProps.parentId)
    delete updateProps.parentId
  }
  graph.updateNode(existing.id, updateProps)

  applyOrQueueRemoteChildOrder(graph, state, existing, remoteStableId, props)

  const updatedNode = graph.getNode(existing.id)
  if (
    updatedNode?.type === 'INSTANCE' &&
    typeof updatedNode.componentId === 'string' &&
    updatedNode.childIds.length === 0
  ) {
    graph.populateInstanceChildren(updatedNode.id, updatedNode.componentId)
  }
  if (updatedNode?.type === 'INSTANCE' && typeof updatedNode.componentId === 'string') {
    if (props.overrides !== undefined) {
      graph.syncInstances(updatedNode.componentId)
    }
    const refreshedNode = graph.getNode(updatedNode.id)
    if (refreshedNode !== undefined) {
      applyInstanceOverrideValuesToChildren(graph, refreshedNode)
    }
  } else if (updatedNode?.type === 'INSTANCE') {
    applyInstanceOverrideValuesToChildren(graph, updatedNode)
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

  // Auto-populate instance children before resolving override keys. Instance
  // child override keys use the component child's stable id, which would resolve
  // to the component child itself until the local instance subtree exists.
  if (
    node.type === 'INSTANCE' &&
    typeof node.componentId === 'string' &&
    node.childIds.length === 0
  ) {
    graph.populateInstanceChildren(node.id, node.componentId)
  }

  if (props.overrides !== undefined && isRecord(props.overrides)) {
    node.overrides = remapOverridesToLocal(graph, state, props.overrides, remoteStableId)
    applyInstanceOverrideValuesToChildren(graph, node)
  }

  applyOrQueueRemoteChildOrder(graph, state, node, remoteStableId, props)
}

export function removeFromPendingQueues(state: GraphSyncState, remoteStableId: string): void {
  const localId = state.remoteToLocal.get(remoteStableId)
  state.remoteToLocal.delete(remoteStableId)
  if (localId !== undefined) {
    state.localToRemote.delete(localId)
  }
  state.pendingParents.delete(remoteStableId)
  removePendingChildOrderReferences(state, remoteStableId)
  state.pendingComponents.delete(remoteStableId)
  state.pendingOverrideKeys.delete(remoteStableId)
  state.pendingUntilRoot.delete(remoteStableId)
  // Clean up pending override entries that reference this node as the owning
  // instance. pendingOverrideKeys is keyed by CHILD stable id, but each
  // entry's remoteStableId is the INSTANCE's stable id. When an instance is
  // deleted, its pending overrides (for children that may never arrive
  // locally) would otherwise leak until session end. Map iteration is safe
  // for in-place delete/set on visited entries per the ECMAScript spec.
  for (const [childStableId, entries] of state.pendingOverrideKeys) {
    const remaining = [...entries].filter(
      (e) =>
        e.remoteStableId !== remoteStableId && !e.nestedInstanceStablePath?.includes(remoteStableId)
    )
    if (remaining.length === entries.size) continue
    if (remaining.length === 0) {
      state.pendingOverrideKeys.delete(childStableId)
    } else {
      state.pendingOverrideKeys.set(childStableId, new Set(remaining))
    }
  }
  // Clean up pending variable bindings that reference this node.
  // pendingVariableBindings is keyed by VARIABLE stable id, but each entry's
  // nodeStableId is the NODE's stable id. When a node is deleted, its pending
  // bindings would otherwise leak until session end.
  for (const [varStableId, entries] of state.pendingVariableBindings) {
    const remaining = [...entries].filter(
      (e) =>
        e.nodeStableId !== remoteStableId &&
        e.instanceStableId !== remoteStableId &&
        !e.nestedInstanceStablePath?.includes(remoteStableId)
    )
    if (remaining.length === entries.size) continue
    if (remaining.length === 0) {
      state.pendingVariableBindings.delete(varStableId)
    } else {
      state.pendingVariableBindings.set(varStableId, new Set(remaining))
    }
  }
}
