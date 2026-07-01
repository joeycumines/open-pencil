import {
  joinOverrideKey,
  splitOverrideKey,
  type GraphSyncState,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/core/scene-graph'

import { YJS_NODE_PROPERTY_KEYS } from './constants'
import { ensureRemoteMapping, stableIdForNode, stableIdForRuntimeId, toRuntimeId } from './mapping'
import {
  INVALID_YJS_NODE_VALUE,
  isPlainRecord,
  validateYNodeBareOverrideValue,
  validateYNodePropertyValue
} from './payload-validation'
import {
  appendRemoteNodeKeySegment,
  originalStableIdFromRemoteNodeKey,
  rawStableIdFromRemoteNodeKey,
  remoteNodeKeyForStableId
} from './remote-node-key'

const INSTANCE_DESCENDANT_STRUCTURAL_KEYS = new Set<string>([
  'id',
  'type',
  'parentId',
  'childIds',
  'componentId',
  'source',
  'sourceId',
  'sourceFormat',
  'sourceFig',
  'overrides'
])

export function canSyncInstanceDescendantOverrideProp(prop: string): prop is keyof SceneNode {
  return YJS_NODE_PROPERTY_KEYS.has(prop) && !INSTANCE_DESCENDANT_STRUCTURAL_KEYS.has(prop)
}

export function canStoreInstanceDescendantOverrideProp(prop: string): prop is keyof SceneNode {
  return prop === 'overrides' || canSyncInstanceDescendantOverrideProp(prop)
}

function canSyncOverridePropForNode(prop: string, node: SceneNode): prop is keyof SceneNode {
  if (prop === 'overrides') return node.type === 'INSTANCE'
  return canSyncInstanceDescendantOverrideProp(prop)
}

function cloneOverrideValue(value: unknown): unknown {
  return typeof value === 'object' && value !== null ? structuredClone(value) : value
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => valuesEqual(item, b[index]))
  }

  if (!isPlainRecord(a) || !isPlainRecord(b)) return false
  const aRecord = a
  const bRecord = b
  const aKeys = Object.keys(aRecord)
  const bKeys = Object.keys(bRecord)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(
    (key) => Object.hasOwn(bRecord, key) && valuesEqual(aRecord[key], bRecord[key])
  )
}

export function findOwningInstance(
  graph: SceneGraph,
  nodeId: string
): { instance: SceneNode; descendant: SceneNode } | null {
  const descendant = graph.getNode(nodeId)
  if (descendant === undefined) return null

  let current: SceneNode | undefined = descendant
  while (current.parentId !== null) {
    const parent = graph.getNode(current.parentId)
    if (parent === undefined) return null
    if (parent.type === 'INSTANCE') {
      return { instance: parent, descendant }
    }
    current = parent
  }

  return null
}

export function isInstanceDescendant(graph: SceneGraph, nodeId: string): boolean {
  return findOwningInstance(graph, nodeId) !== null
}

export function findOwningComponentBackedInstance(
  graph: SceneGraph,
  nodeId: string
): { instance: SceneNode; descendant: SceneNode } | null {
  const context = findOwningInstance(graph, nodeId)
  if (context?.descendant.componentId == null) return null
  const componentSource = graph.getNode(context.descendant.componentId)
  if (componentSource === undefined) return null
  if (!isDescendantOf(graph, componentSource.id, context.instance.componentId)) return null
  return context
}

function isDescendantOf(graph: SceneGraph, nodeId: string, ancestorId: string | null): boolean {
  if (ancestorId === null) return false
  let currentId: string | null = nodeId
  while (currentId !== null) {
    if (currentId === ancestorId) return true
    const current = graph.getNode(currentId)
    if (current === undefined) return false
    currentId = current.parentId
  }
  return false
}

export function isComponentBackedInstanceDescendant(graph: SceneGraph, nodeId: string): boolean {
  return findOwningComponentBackedInstance(graph, nodeId) !== null
}

export function orphanedInstanceDescendantSubtreeIdsForDeletedComponentNode(
  graph: SceneGraph,
  deletedComponentNodeId: string
): string[] {
  const affectedIds = new Set<string>()

  function addSubtree(node: SceneNode): void {
    if (affectedIds.has(node.id)) return
    affectedIds.add(node.id)
    for (const childId of node.childIds) {
      const child = graph.getNode(childId)
      if (child !== undefined) addSubtree(child)
    }
  }

  for (const node of graph.getAllNodes()) {
    if (node.componentId !== deletedComponentNodeId) continue
    if (scopedInstanceDescendantStableId(graph, node) === null) continue
    addSubtree(node)
  }

  return [...affectedIds]
}

function orphanedInstanceDescendantContext(
  graph: SceneGraph,
  node: SceneNode
): { instance: SceneNode; descendant: SceneNode } | null {
  const context = findOwningInstance(graph, node.id)
  if (context?.descendant.componentId == null) return null
  const componentSource = graph.getNode(context.descendant.componentId)
  if (
    componentSource !== undefined &&
    isDescendantOf(graph, componentSource.id, context.instance.componentId)
  ) {
    return null
  }
  return context
}

export function scopedInstanceDescendantStableId(
  graph: SceneGraph,
  node: SceneNode
): string | null {
  const context = orphanedInstanceDescendantContext(graph, node)
  if (context === null) return null
  return appendRemoteNodeKeySegment(
    scopedOrphanOwnerStableId(graph, context.instance),
    'orphan',
    stableIdForNode(context.descendant)
  )
}

function scopedOrphanOwnerStableId(graph: SceneGraph, instance: SceneNode): string {
  return (
    scopedInstanceDescendantStableId(graph, instance) ??
    branchScopedInstanceStableId(graph, instance)
  )
}

function branchScopedInstanceStableId(graph: SceneGraph, instance: SceneNode): string {
  const context = findOwningInstance(graph, instance.id)
  if (context === null) return remoteNodeKeyForStableId(stableIdForNode(instance))
  return appendRemoteNodeKeySegment(
    scopedOrphanOwnerStableId(graph, context.instance),
    'branch',
    stableIdForNode(instance)
  )
}

function existingScopedInstanceDescendantStableId(
  state: GraphSyncState,
  node: SceneNode
): string | null {
  const existingRemoteStableId = state.localToRemote.get(node.id)
  if (existingRemoteStableId === undefined) return null
  return originalStableIdFromRemoteNodeKey(existingRemoteStableId) === null
    ? null
    : existingRemoteStableId
}

export function originalStableIdForScopedInstanceDescendant(
  graph: SceneGraph,
  state: GraphSyncState,
  node: SceneNode
): string | null {
  if (scopedInstanceDescendantStableId(graph, node) !== null) return stableIdForNode(node)
  const existingScopedStableId = existingScopedInstanceDescendantStableId(state, node)
  return existingScopedStableId === null
    ? null
    : originalStableIdFromRemoteNodeKey(existingScopedStableId)
}

export function ensureRemoteMappingForNode(
  graph: SceneGraph,
  state: GraphSyncState,
  node: SceneNode
): string {
  const scopedStableId =
    scopedInstanceDescendantStableId(graph, node) ??
    existingScopedInstanceDescendantStableId(state, node)
  return ensureRemoteMapping(state, node, scopedStableId ?? undefined)
}

export function remoteStableIdForRuntimeId(
  graph: SceneGraph,
  state: GraphSyncState,
  runtimeId: string | null | undefined
): string | null {
  const node = typeof runtimeId === 'string' ? graph.getNode(runtimeId) : undefined
  const scopedStableId =
    node === undefined
      ? null
      : (scopedInstanceDescendantStableId(graph, node) ??
        existingScopedInstanceDescendantStableId(state, node))
  return scopedStableId ?? stableIdForRuntimeId(graph, state, runtimeId)
}

export function findInstanceDescendantByStableId(
  graph: SceneGraph,
  instance: SceneNode,
  stableId: string
): SceneNode | undefined {
  const rawStableId = rawStableIdFromRemoteNodeKey(stableId) ?? stableId
  return findInstanceDescendantMatching(graph, instance, (child) => {
    if (stableIdForNode(child) === rawStableId) return child

    const componentChild = child.componentId === null ? undefined : graph.getNode(child.componentId)
    if (componentChild !== undefined && stableIdForNode(componentChild) === rawStableId) {
      return child
    }
    return undefined
  })
}

export function findInstanceDescendantByStablePath(
  graph: SceneGraph,
  instance: SceneNode,
  stablePath: readonly string[]
): SceneNode | undefined {
  let current: SceneNode | undefined = instance
  for (const stableId of stablePath) {
    if (current === undefined) return undefined
    current = findInstanceDescendantByStableId(graph, current, stableId)
  }
  return current
}

export function resolveInstanceOverrideChildId(
  graph: SceneGraph,
  state: GraphSyncState,
  instanceRemoteStableId: string,
  childStableId: string
): string | undefined {
  const instanceId = toRuntimeId(graph, state, instanceRemoteStableId)
  const instance = instanceId === undefined ? undefined : graph.getNode(instanceId)
  if (instance?.type === 'INSTANCE') {
    const instanceChild = findInstanceDescendantByStableId(graph, instance, childStableId)
    if (instanceChild !== undefined) return instanceChild.id
    const scopedOrphan = findScopedInstanceDescendantByOriginalStableId(
      graph,
      state,
      instance,
      childStableId
    )
    if (scopedOrphan !== undefined) return scopedOrphan.id
  }
  return toRuntimeId(graph, state, childStableId)
}

function findScopedInstanceDescendantByOriginalStableId(
  graph: SceneGraph,
  state: GraphSyncState,
  instance: SceneNode,
  originalStableId: string
): SceneNode | undefined {
  return findInstanceDescendantMatching(graph, instance, (child) => {
    const remoteStableId = state.localToRemote.get(child.id)
    return remoteStableId !== undefined &&
      originalStableIdFromRemoteNodeKey(remoteStableId) === originalStableId
      ? child
      : undefined
  })
}

function findInstanceDescendantMatching(
  graph: SceneGraph,
  instance: SceneNode,
  predicate: (child: SceneNode) => SceneNode | undefined
): SceneNode | undefined {
  const stack = [...instance.childIds]
  while (stack.length > 0) {
    const childId = stack.pop()
    if (childId === undefined) continue
    const child = graph.getNode(childId)
    if (child === undefined) continue
    const match = predicate(child)
    if (match !== undefined) return match
    stack.push(...child.childIds)
  }
  return undefined
}

function changedOverrideKeys(node: SceneNode, changes: Partial<SceneNode> | undefined): string[] {
  if (changes !== undefined) return Object.keys(changes)

  const keys: string[] = []
  for (const key of Object.keys(node)) {
    if (canSyncOverridePropForNode(key, node)) keys.push(key)
  }
  return keys
}

export function mergeInstanceDescendantOverridesForYjs(
  graph: SceneGraph,
  state: GraphSyncState,
  nodeId: string,
  changes?: Partial<SceneNode>
): SceneNode | null {
  const context = findOwningComponentBackedInstance(graph, nodeId)
  if (context === null) return null

  state.localToRemote.delete(nodeId)

  const componentSource =
    context.descendant.componentId === null
      ? undefined
      : graph.getNode(context.descendant.componentId)
  const descendantStableId = stableIdForNode(context.descendant)
  let nextOverrides: Record<string, unknown> = { ...context.instance.overrides }

  for (const prop of changedOverrideKeys(context.descendant, changes)) {
    if (!canSyncOverridePropForNode(prop, context.descendant)) continue
    const overrideKey = joinOverrideKey(descendantStableId, prop)
    const localValue = context.descendant[prop]

    if (
      prop === 'boundVariables' &&
      Object.hasOwn(nextOverrides, overrideKey) &&
      isPlainRecord(nextOverrides[overrideKey])
    ) {
      nextOverrides[overrideKey] = cloneOverrideValue(localValue)
      continue
    }

    if (componentSource !== undefined && valuesEqual(localValue, componentSource[prop])) {
      nextOverrides = Object.fromEntries(
        Object.entries(nextOverrides).filter(([key]) => key !== overrideKey)
      )
      continue
    }

    nextOverrides[overrideKey] = cloneOverrideValue(localValue)
  }

  context.instance.overrides = nextOverrides
  return context.instance
}

function sanitizeOverrideValueForApply(prop: string, value: unknown): unknown {
  if (!canStoreInstanceDescendantOverrideProp(prop)) return INVALID_YJS_NODE_VALUE
  if (prop === 'overrides') return sanitizeOverridesForApply(value)
  return validateYNodePropertyValue(prop, value)
}

function sanitizeOverridesForApply(value: unknown): unknown {
  if (!isPlainRecord(value)) return INVALID_YJS_NODE_VALUE
  const sanitized: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const { childId, prop } = splitOverrideKey(key)
    if (childId === '') {
      const sanitizedEntry = validateYNodeBareOverrideValue(key, prop, entry)
      if (sanitizedEntry !== INVALID_YJS_NODE_VALUE) sanitized[key] = sanitizedEntry
      continue
    }
    const sanitizedEntry = sanitizeOverrideValueForApply(prop, entry)
    if (sanitizedEntry !== INVALID_YJS_NODE_VALUE) {
      sanitized[key] = sanitizedEntry
    }
  }
  return sanitized
}

function assignSceneNodeProp<K extends keyof SceneNode>(
  target: Partial<SceneNode>,
  key: K,
  value: SceneNode[K]
): void {
  target[key] = value
}

export function applyInstanceOverrideValuesToChildren(
  graph: SceneGraph,
  instance: SceneNode
): void {
  if (instance.type !== 'INSTANCE') return

  for (const [overrideKey, value] of Object.entries(instance.overrides)) {
    const { childId, prop } = splitOverrideKey(overrideKey)
    if (childId === '') continue
    const sanitizedValue = sanitizeOverrideValueForApply(prop, value)
    if (sanitizedValue === INVALID_YJS_NODE_VALUE) continue

    const target =
      findInstanceDescendantByStableId(graph, instance, childId) ?? graph.getNode(childId)
    if (target === undefined || !isInstanceDescendant(graph, target.id)) continue
    if (!canSyncOverridePropForNode(prop, target)) continue
    if (!(prop in target)) continue

    const nextValue = cloneOverrideValue(sanitizedValue) as SceneNode[typeof prop]
    if (valuesEqual(target[prop], nextValue)) continue

    const update: Partial<SceneNode> = {}
    assignSceneNodeProp(update, prop, nextValue)
    graph.updateNode(target.id, update)
    const updatedTarget = graph.getNode(target.id)
    if (prop === 'overrides' && updatedTarget?.type === 'INSTANCE') {
      applyInstanceOverrideValuesToChildren(graph, updatedTarget)
    }
  }
}
