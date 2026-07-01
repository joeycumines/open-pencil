import * as Y from 'yjs'

import { createDefaultSource, splitOverrideKey } from '@open-pencil/core/scene-graph'
import type {
  GraphSyncState,
  SceneGraph,
  SceneNode,
  SourceMetadata
} from '@open-pencil/core/scene-graph'

import {
  EXCLUDED_SYNC_KEYS,
  JSON_PROPERTY_KEYS,
  YJS_ORIGINAL_SOURCE_ID_KEY,
  YJS_PARENT_INSTANCE_ID_KEY,
  YJS_PARENT_INSTANCE_PATH_KEY,
  YJS_NODE_PROPERTY_KEYS,
  type NodeProps,
  type YNodes
} from './constants'
import {
  canStoreInstanceDescendantOverrideProp,
  ensureRemoteMappingForNode,
  findInstanceDescendantByStableId,
  findInstanceDescendantByStablePath,
  originalStableIdForScopedInstanceDescendant,
  remoteStableIdForRuntimeId,
  resolveInstanceOverrideChildId
} from './instance-descendants'
import { findNodeByStableId, stableIdForNode, toRuntimeId } from './mapping'
import { parentInstanceBranchForRemoteParent, resolveRemoteParentId } from './parent-routing'
import {
  INVALID_YJS_NODE_VALUE,
  isPlainRecord,
  validateYNodeBareOverrideValue,
  validateYNodePropertyValue
} from './payload-validation'
import { isMalformedRemoteNodeKey, rawStableIdFromRemoteNodeKey } from './remote-node-key'
import { tryParseSourceFig } from './source-fig'
import { remapBoundVariablesToLocal, remapBoundVariablesToRemote } from './variable/sync'

export { isPlainRecord as isRecord, isSceneNodeType } from './payload-validation'

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isPlainRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

export function yNodeToProps(ynode: Y.Map<unknown>): NodeProps {
  const props: NodeProps = {}

  function parseValue(key: string, value: unknown): unknown {
    if (typeof value !== 'string' || key === 'sourceFig') return value
    if (!JSON_PROPERTY_KEYS.has(key)) return value
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  for (const [key, value] of ynode.entries()) {
    if (EXCLUDED_SYNC_KEYS.has(key)) continue
    if (YJS_NODE_PROPERTY_KEYS.has(key)) {
      const parsed = parseValue(key, value)
      const validated = validateYNodePropertyValue(key, parsed)
      if (validated !== INVALID_YJS_NODE_VALUE) {
        props[key] = validated
      }
    }
  }

  return props
}

function stringifyIfObject(value: unknown): unknown {
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value)
  }
  return value
}

/**
 * Only write to the Yjs map if the serialized value differs from the current
 * value. This avoids unnecessary Yjs operations during high-frequency updates
 * (e.g., 60fps drag) where most properties don't change between frames.
 */
function setIfChanged(ynode: Y.Map<unknown>, key: string, value: unknown): void {
  if (ynode.get(key) !== value) {
    ynode.set(key, value)
  }
}

function setRecordIfChanged(
  ynode: Y.Map<unknown>,
  key: string,
  value: Record<string, unknown>
): void {
  const current = ynode.get(key)
  if (!isPlainRecord(current) || JSON.stringify(current) !== JSON.stringify(value)) {
    ynode.set(key, value)
  }
}

function setStringArrayIfChanged(
  ynode: Y.Map<unknown>,
  key: string,
  value: readonly string[]
): void {
  const current = ynode.get(key)
  if (
    !Array.isArray(current) ||
    current.length !== value.length ||
    current.some((item, index) => item !== value[index])
  ) {
    ynode.set(key, [...value])
  }
}

export function syncNodePropsToYMap(
  node: SceneNode,
  ynode: Y.Map<unknown>,
  graph: SceneGraph,
  state: GraphSyncState
): void {
  const scopedOriginalSourceId = originalStableIdForScopedInstanceDescendant(graph, state, node)
  const remoteStableId =
    node.id === graph.rootId
      ? stableIdForNode(node)
      : ensureRemoteMappingForNode(graph, state, node)
  setIfChanged(ynode, 'id', remoteStableId)

  const parentStableId =
    node.id === graph.rootId
      ? state.remoteRootStableId
      : remoteStableIdForRuntimeId(graph, state, node.parentId)
  setIfChanged(ynode, 'parentId', parentStableId)

  const parentInstanceBranch = parentInstanceBranchForRemoteParent(graph, state, node)
  if (parentInstanceBranch === null) {
    ynode.delete(YJS_PARENT_INSTANCE_ID_KEY)
    ynode.delete(YJS_PARENT_INSTANCE_PATH_KEY)
  } else {
    setIfChanged(ynode, YJS_PARENT_INSTANCE_ID_KEY, parentInstanceBranch.ownerStableId)
    if (parentInstanceBranch.nestedStablePath.length === 0) {
      ynode.delete(YJS_PARENT_INSTANCE_PATH_KEY)
    } else {
      setStringArrayIfChanged(
        ynode,
        YJS_PARENT_INSTANCE_PATH_KEY,
        parentInstanceBranch.nestedStablePath
      )
    }
  }

  const componentStableId = remoteStableIdForRuntimeId(graph, state, node.componentId)
  setIfChanged(ynode, 'componentId', componentStableId)

  if (node.type === 'INSTANCE') {
    const remapped = remapOverridesToRemote(graph, state, node.overrides)
    setRecordIfChanged(ynode, 'overrides', remapped)
  } else {
    ynode.delete('overrides')
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' || key === 'parentId' || key === 'componentId' || key === 'overrides') continue
    if (key === 'source') {
      setIfChanged(
        ynode,
        'sourceId',
        scopedOriginalSourceId === null ? node.source.id : remoteStableId
      )
      if (scopedOriginalSourceId === null) {
        ynode.delete(YJS_ORIGINAL_SOURCE_ID_KEY)
      } else {
        setIfChanged(ynode, YJS_ORIGINAL_SOURCE_ID_KEY, scopedOriginalSourceId)
      }
      setIfChanged(ynode, 'sourceFormat', node.source.format)
      setIfChanged(ynode, 'sourceFig', JSON.stringify(node.source.fig))
      continue
    }
    if (key === 'childIds') {
      const childStableIds = (value as string[])
        .map((id) => {
          const child = graph.getNode(id)
          return child ? remoteStableIdForRuntimeId(graph, state, child.id) : null
        })
        .filter((id): id is string => id !== null)
      setIfChanged(ynode, 'childIds', JSON.stringify(childStableIds))
      continue
    }
    if (key === 'boundVariables') {
      const remapped = remapBoundVariablesToRemote(graph, state, value as Record<string, string>)
      setIfChanged(ynode, 'boundVariables', JSON.stringify(remapped))
      continue
    }
    if (EXCLUDED_SYNC_KEYS.has(key)) continue
    if (!YJS_NODE_PROPERTY_KEYS.has(key)) continue
    setIfChanged(ynode, key, stringifyIfObject(value))
  }

  // Allow-list keys that are absent on this node are intentionally left as-is;
  // deleting them would erase shared state for properties a peer does not set.
}

export function syncLocalRootToYjs(graph: SceneGraph, state: GraphSyncState, ynodes: YNodes): void {
  if (state.remoteRootStableId === null) return
  const root = graph.getNode(graph.rootId)
  if (root === undefined) return
  let ynode = ynodes.get(state.remoteRootStableId)
  if (ynode === undefined) {
    ynode = new Y.Map<unknown>()
    ynodes.set(state.remoteRootStableId, ynode)
  }
  syncNodePropsToYMap(root, ynode, graph, state)
}

function remapOverridesToRemote(
  graph: SceneGraph,
  state: GraphSyncState,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const remapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(overrides)) {
    const { childId, prop } = splitOverrideKey(key)
    if (copyBareOverride(remapped, key, value, childId, prop)) continue
    const stableId = stableOverrideChildIdForRemote(graph, state, childId)
    if (stableId === null) continue
    const remappedValue = remapOverrideValueToRemote(graph, state, prop, value)
    if (remappedValue !== INVALID_YJS_NODE_VALUE) remapped[`${stableId}:${prop}`] = remappedValue
  }
  return remapped
}

function remapOverrideValueToRemote(
  graph: SceneGraph,
  state: GraphSyncState,
  prop: string,
  value: unknown
): unknown {
  if (!canStoreInstanceDescendantOverrideProp(prop)) return INVALID_YJS_NODE_VALUE
  if (prop === 'boundVariables' && isStringRecord(value)) {
    return remapBoundVariablesToRemote(graph, state, value)
  }
  if (prop === 'overrides' && isPlainRecord(value)) {
    return remapOverridesToRemote(graph, state, value)
  }
  return validateYNodePropertyValue(prop, value)
}

function copyBareOverride(
  remapped: Record<string, unknown>,
  key: string,
  value: unknown,
  childId: string,
  prop: string
): boolean {
  if (childId !== '') return false
  const validated = validateYNodeBareOverrideValue(key, prop, value)
  if (validated !== INVALID_YJS_NODE_VALUE) remapped[key] = validated
  return true
}

function stableOverrideChildIdForRemote(
  graph: SceneGraph,
  state: GraphSyncState,
  childId: string
): string | null {
  const runtimeStableId = remoteStableIdForRuntimeId(graph, state, childId)
  if (runtimeStableId !== null) return runtimeStableId
  if (state.remoteToLocal.has(childId) || findNodeByStableId(graph, childId) !== undefined) {
    return childId
  }
  return null
}

function filterProps(props: NodeProps, exclude: readonly string[]): NodeProps {
  const result: NodeProps = {}
  for (const key of Object.keys(props)) {
    if (!exclude.includes(key)) {
      result[key] = props[key]
    }
  }
  return result
}

const CREATE_EXCLUDED_KEYS = [
  'id',
  'parentId',
  YJS_PARENT_INSTANCE_ID_KEY,
  YJS_PARENT_INSTANCE_PATH_KEY,
  YJS_ORIGINAL_SOURCE_ID_KEY,
  'componentId',
  'sourceFormat',
  'sourceFig',
  'sourceId',
  'childIds'
]

export function buildCreateProps(
  graph: SceneGraph,
  state: GraphSyncState,
  props: NodeProps,
  remoteStableId: string
): Partial<SceneNode> {
  const parentResolution = resolveRemoteParentId(graph, state, props)
  const parentId = parentResolution.parentId ?? graph.rootId

  let componentId: string | null = null
  if ('componentId' in props) {
    const raw = props.componentId
    componentId = raw === null ? null : (toRuntimeId(graph, state, asString(raw)) ?? null)
  }

  const sourceFormat = asString(props.sourceFormat)
  const sourceFig = tryParseSourceFig(props.sourceFig)

  const createProps = structuredClone(filterProps(props, [...CREATE_EXCLUDED_KEYS, 'overrides']))

  const remoteSourceId = asString(props.sourceId) ?? asString(props.id) ?? remoteStableId
  const source: SourceMetadata = {
    ...createDefaultSource(),
    id: remoteSourceId,
    format: sourceFormat === 'fig' ? 'fig' : null,
    fig: sourceFig ?? createDefaultSource().fig
  }

  // Remap boundVariables variable IDs from stable IDs to local runtime IDs.
  // Unresolved bindings (variable not yet arrived) are queued as pending
  // and resolved when the variable arrives via yvariables sync.
  if (createProps.boundVariables && typeof createProps.boundVariables === 'object') {
    createProps.boundVariables = remapBoundVariablesToLocal(
      graph,
      state,
      createProps.boundVariables as Record<string, string>,
      remoteStableId
    )
  }

  return {
    ...createProps,
    id: undefined,
    parentId,
    componentId,
    source
  } as Partial<SceneNode>
}

export function buildUpdateProps(
  graph: SceneGraph,
  state: GraphSyncState,
  props: NodeProps,
  existing: SceneNode,
  remoteStableId: string
): Partial<SceneNode> {
  const exclude: string[] = ['type', 'childIds']
  let parentId: string | undefined
  let componentId: string | null | undefined

  if ('parentId' in props) {
    const parentResolution = resolveRemoteParentId(graph, state, props)
    parentId = parentResolution.parentId
    if (parentId === undefined) {
      exclude.push('parentId')
    }
  }

  if ('componentId' in props) {
    const raw = props.componentId
    if (raw === null) {
      componentId = null
    } else if (typeof raw === 'string') {
      componentId = toRuntimeId(graph, state, raw)
      if (componentId === undefined) {
        exclude.push('componentId')
      }
    }
  }

  const update = structuredClone(filterProps(props, [...CREATE_EXCLUDED_KEYS, ...exclude]))
  if (parentId !== undefined) {
    update.parentId = parentId
  }
  if (componentId !== undefined) {
    update.componentId = componentId
  }

  const overridesValue = update.overrides
  if (overridesValue !== undefined && isPlainRecord(overridesValue)) {
    update.overrides = remapOverridesToLocal(graph, state, overridesValue, remoteStableId)
  }

  // Remap boundVariables variable IDs from stable IDs to local runtime IDs.
  // Unresolved bindings (variable not yet arrived) are queued as pending
  // and resolved when the variable arrives via yvariables sync.
  if (update.boundVariables && typeof update.boundVariables === 'object') {
    update.boundVariables = remapBoundVariablesToLocal(
      graph,
      state,
      update.boundVariables as Record<string, string>,
      remoteStableId
    )
  }

  return { ...update, id: existing.id } as Partial<SceneNode>
}

export function remapOverridesToLocal(
  graph: SceneGraph,
  state: GraphSyncState,
  overrides: Record<string, unknown> | undefined,
  instanceRemoteStableId: string,
  nestedInstanceStablePath?: readonly string[]
): Record<string, unknown> {
  if (overrides === undefined) return {}
  const remapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(overrides)) {
    const { childId, prop } = splitOverrideKey(key)
    if (copyBareOverride(remapped, key, value, childId, prop)) continue
    const validatedValue = validateRemoteOverrideValue(prop, value)
    if (validatedValue === INVALID_YJS_NODE_VALUE) continue
    if (isMalformedRemoteNodeKey(childId)) continue
    const localChildId = resolveInstanceOverrideChildIdForPath(
      graph,
      state,
      instanceRemoteStableId,
      nestedInstanceStablePath,
      childId
    )
    if (localChildId !== undefined) {
      const localChildStableId = localOverrideChildStableId(graph, localChildId, childId)
      remapped[`${localChildStableId}:${prop}`] = remapOverrideValueToLocal(
        graph,
        state,
        prop,
        validatedValue,
        localChildStableId,
        instanceRemoteStableId,
        nestedInstanceStablePath
      )
      continue
    }
    let set = state.pendingOverrideKeys.get(childId)
    if (set === undefined) {
      set = new Set()
      state.pendingOverrideKeys.set(childId, set)
    }
    set.add({
      remoteStableId: instanceRemoteStableId,
      nestedInstanceStablePath: cloneNestedInstanceStablePath(nestedInstanceStablePath),
      prop,
      value: validatedValue
    })
  }
  return remapped
}

function validateRemoteOverrideValue(prop: string, value: unknown): unknown {
  if (!canStoreInstanceDescendantOverrideProp(prop)) return INVALID_YJS_NODE_VALUE
  if (prop === 'overrides') return validateRemoteOverridesRecord(value)
  return validateYNodePropertyValue(prop, value)
}

function validateRemoteOverridesRecord(value: unknown): unknown {
  if (!isPlainRecord(value)) return INVALID_YJS_NODE_VALUE
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const { childId, prop } = splitOverrideKey(key)
    if (childId === '') {
      const validated = validateYNodeBareOverrideValue(key, prop, entry)
      if (validated !== INVALID_YJS_NODE_VALUE) result[key] = validated
      continue
    }
    const validated = validateRemoteOverrideValue(prop, entry)
    if (validated !== INVALID_YJS_NODE_VALUE) result[key] = validated
  }
  return result
}

function localOverrideChildStableId(
  graph: SceneGraph,
  localChildId: string,
  remoteChildStableId: string
): string {
  const localChild = graph.getNode(localChildId)
  if (localChild !== undefined) return stableIdForNode(localChild)
  return rawStableIdFromRemoteNodeKey(remoteChildStableId) ?? remoteChildStableId
}

function resolveInstanceOverrideChildIdForPath(
  graph: SceneGraph,
  state: GraphSyncState,
  instanceRemoteStableId: string,
  nestedInstanceStablePath: readonly string[] | undefined,
  childStableId: string
): string | undefined {
  if (nestedInstanceStablePath === undefined || nestedInstanceStablePath.length === 0) {
    return resolveInstanceOverrideChildId(graph, state, instanceRemoteStableId, childStableId)
  }

  const instanceId = state.remoteToLocal.get(instanceRemoteStableId)
  const instance = instanceId === undefined ? undefined : graph.getNode(instanceId)
  if (instance?.type !== 'INSTANCE') return undefined
  const nestedInstance = findInstanceDescendantByStablePath(
    graph,
    instance,
    nestedInstanceStablePath
  )
  if (nestedInstance?.type !== 'INSTANCE') return undefined
  return findInstanceDescendantByStableId(graph, nestedInstance, childStableId)?.id
}

function remapOverrideValueToLocal(
  graph: SceneGraph,
  state: GraphSyncState,
  prop: string,
  value: unknown,
  childStableId: string,
  instanceRemoteStableId: string,
  nestedInstanceStablePath?: readonly string[]
): unknown {
  if (prop === 'boundVariables' && isStringRecord(value)) {
    return remapBoundVariablesToLocal(
      graph,
      state,
      value,
      childStableId,
      instanceRemoteStableId,
      nestedInstanceStablePath
    )
  }
  if (prop === 'overrides' && isPlainRecord(value)) {
    return remapOverridesToLocal(
      graph,
      state,
      value,
      instanceRemoteStableId,
      extendNestedInstanceStablePath(nestedInstanceStablePath, childStableId)
    )
  }
  return value
}

function cloneNestedInstanceStablePath(
  nestedInstanceStablePath: readonly string[] | undefined
): string[] | undefined {
  return nestedInstanceStablePath === undefined || nestedInstanceStablePath.length === 0
    ? undefined
    : [...nestedInstanceStablePath]
}

function extendNestedInstanceStablePath(
  nestedInstanceStablePath: readonly string[] | undefined,
  childStableId: string
): string[] {
  return [...(nestedInstanceStablePath ?? []), childStableId]
}
