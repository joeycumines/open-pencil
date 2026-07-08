import type { GraphSyncState, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  YJS_PARENT_INSTANCE_ID_KEY,
  YJS_PARENT_INSTANCE_PATH_KEY,
  type NodeProps
} from './constants'
import {
  findInstanceDescendantByStableId,
  findOwningComponentBackedInstance
} from './instance-descendants'
import { stableIdForNode, toRuntimeId } from './mapping'
import {
  isMalformedRemoteNodeKey,
  rawStableIdFromRemoteNodeKey,
  remoteNodeKeyForStableId
} from './remote-node-key'

export type RemoteParentResolution = {
  parentId: string | undefined
  pendingStableId: string | undefined
  invalid?: boolean
}

export type ParentInstanceBranch = {
  ownerStableId: string
  nestedStablePath: string[]
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.every((entry) => typeof entry === 'string') ? value : undefined
}

function instanceAncestorChain(graph: SceneGraph, nodeId: string): SceneNode[] {
  const instances: SceneNode[] = []
  let current = graph.getNode(nodeId)
  while (current !== undefined) {
    if (current.type === 'INSTANCE') instances.push(current)
    if (current.parentId === null) break
    current = graph.getNode(current.parentId)
  }
  return instances.reverse()
}

export function parentInstanceBranchForRemoteParent(
  graph: SceneGraph,
  state: GraphSyncState,
  node: SceneNode
): ParentInstanceBranch | null {
  if (node.parentId === null) return null
  if (findOwningComponentBackedInstance(graph, node.parentId) === null) return null

  const instancePath = instanceAncestorChain(graph, node.parentId)
  if (instancePath.length === 0) return null
  const [ownerInstance, ...nestedInstances] = instancePath

  const ownerStableId = toRemoteStableId(state, ownerInstance)
  if (ownerStableId === null) return null

  const nestedStablePath: string[] = []
  for (const nestedInstance of nestedInstances) {
    const stableId = toRemoteStableId(state, nestedInstance)
    if (stableId === null) return null
    nestedStablePath.push(stableId)
  }

  return { ownerStableId, nestedStablePath }
}

function toRemoteStableId(state: GraphSyncState, node: SceneNode): string | null {
  return state.localToRemote.get(node.id) ?? remoteNodeKeyForStableId(stableIdForNode(node))
}

export function resolveRemoteParentId(
  graph: SceneGraph,
  state: GraphSyncState,
  props: NodeProps
): RemoteParentResolution {
  const parentStableId = asString(props.parentId)
  if (parentStableId === undefined) {
    return { parentId: graph.rootId, pendingStableId: undefined }
  }
  if (isMalformedRemoteNodeKey(parentStableId)) {
    return { parentId: undefined, pendingStableId: undefined, invalid: true }
  }

  const parentInstanceStableId = asString(props[YJS_PARENT_INSTANCE_ID_KEY])
  if (parentInstanceStableId === undefined) {
    return {
      parentId: toRuntimeId(graph, state, parentStableId),
      pendingStableId: parentStableId
    }
  }
  if (isMalformedRemoteNodeKey(parentInstanceStableId)) {
    return { parentId: undefined, pendingStableId: undefined, invalid: true }
  }

  const instanceId = toRuntimeId(graph, state, parentInstanceStableId)
  const instance = instanceId === undefined ? undefined : graph.getNode(instanceId)
  if (instance?.type !== 'INSTANCE') {
    return { parentId: undefined, pendingStableId: parentInstanceStableId }
  }

  const rawPath = props[YJS_PARENT_INSTANCE_PATH_KEY]
  const nestedStablePath = rawPath === undefined ? [] : asStringArray(rawPath)
  if (nestedStablePath === undefined) {
    return { parentId: undefined, pendingStableId: undefined, invalid: true }
  }
  if (nestedStablePath.some(isMalformedRemoteNodeKey)) {
    return { parentId: undefined, pendingStableId: undefined, invalid: true }
  }

  const branch = resolveInstanceBranch(graph, instance, nestedStablePath)
  if (branch.instance === undefined) {
    return { parentId: undefined, pendingStableId: branch.pendingStableId }
  }

  if (stableIdForNode(branch.instance) === rawStableIdFromRemoteNodeKey(parentStableId)) {
    return { parentId: branch.instance.id, pendingStableId: undefined }
  }

  const instanceParent = findInstanceDescendantByStableId(graph, branch.instance, parentStableId)
  if (instanceParent !== undefined) {
    return { parentId: instanceParent.id, pendingStableId: undefined }
  }

  return { parentId: undefined, pendingStableId: parentStableId }
}

function resolveInstanceBranch(
  graph: SceneGraph,
  ownerInstance: SceneNode,
  nestedStablePath: readonly string[]
): { instance: SceneNode | undefined; pendingStableId: string | undefined } {
  let current = ownerInstance
  for (const nestedStableId of nestedStablePath) {
    if (isMalformedRemoteNodeKey(nestedStableId)) {
      return { instance: undefined, pendingStableId: undefined }
    }
    const next = findInstanceDescendantByStableId(graph, current, nestedStableId)
    if (next?.type !== 'INSTANCE') {
      return { instance: undefined, pendingStableId: nestedStableId }
    }
    current = next
  }
  return { instance: current, pendingStableId: undefined }
}
