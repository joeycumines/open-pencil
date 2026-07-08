import type {
  GraphSyncState,
  SceneGraph,
  SceneNode,
  Variable,
  VariableValue
} from '@open-pencil/scene-graph'

import {
  applyInstanceOverrideValuesToChildren,
  findInstanceDescendantByStableId,
  findInstanceDescendantByStablePath,
  resolveInstanceOverrideChildId
} from './instance-descendants'
import { findNodeByStableId } from './mapping'
import { mergeNestedInstanceOverridePath } from './nested-overrides'
import { toModeRuntimeId, toVariableRuntimeId } from './variable/sync'

type PendingVariableBinding =
  GraphSyncState['pendingVariableBindings'] extends Map<string, Set<infer Entry>> ? Entry : never
type PendingVariableAlias =
  GraphSyncState['pendingVariableAliases'] extends Map<string, Set<infer Entry>> ? Entry : never

export function releasePendingVariableAliases(
  state: GraphSyncState,
  graph: SceneGraph,
  aliasTargetStableId: string
): void {
  const entries = state.pendingVariableAliases.get(aliasTargetStableId)
  if (entries === undefined) return
  const aliasLocalId = toVariableRuntimeId(graph, state, aliasTargetStableId)
  if (aliasLocalId === undefined) return
  const aliasVariable = graph.variables.get(aliasLocalId)
  if (aliasVariable === undefined) return

  const unresolved = new Set<PendingVariableAlias>()
  for (const entry of entries) {
    const localVariableId = toVariableRuntimeId(graph, state, entry.variableStableId)
    const variable =
      localVariableId === undefined ? undefined : graph.variables.get(localVariableId)
    if (variable === undefined) {
      unresolved.add(entry)
      continue
    }
    const localModeId = toModeRuntimeId(graph, state, entry.modeStableId, variable.collectionId)
    if (localModeId === undefined) {
      unresolved.add(entry)
      continue
    }
    if (variable.type !== aliasVariable.type) {
      removeIncompatibleAliasValue(variable, localModeId, aliasTargetStableId, aliasLocalId)
      continue
    }
    const value = variable.valuesByMode[localModeId]
    if (value && typeof value === 'object' && 'aliasId' in value) {
      if (value.aliasId === aliasTargetStableId) {
        variable.valuesByMode = {
          ...variable.valuesByMode,
          [localModeId]: { aliasId: aliasLocalId }
        }
      }
      continue
    }
  }

  if (unresolved.size > 0) {
    state.pendingVariableAliases.set(aliasTargetStableId, unresolved)
  } else {
    state.pendingVariableAliases.delete(aliasTargetStableId)
  }
}

function removeIncompatibleAliasValue(
  variable: Variable,
  localModeId: string,
  aliasTargetStableId: string,
  aliasLocalId: string
): void {
  const value = variable.valuesByMode[localModeId]
  if (!value || typeof value !== 'object' || !('aliasId' in value)) return
  const aliasId = (value as { aliasId?: unknown }).aliasId
  if (aliasId !== aliasTargetStableId && aliasId !== aliasLocalId) return
  const nextValues: Record<string, VariableValue> = {}
  for (const [modeId, modeValue] of Object.entries(variable.valuesByMode)) {
    if (modeId !== localModeId) nextValues[modeId] = modeValue
  }
  variable.valuesByMode = nextValues
}

export function releasePendingVariableBindings(
  state: GraphSyncState,
  graph: SceneGraph,
  variableStableId: string
): void {
  const entries = state.pendingVariableBindings.get(variableStableId)
  if (entries === undefined) return
  const localVariableId = toVariableRuntimeId(graph, state, variableStableId)
  if (localVariableId === undefined) {
    state.pendingVariableBindings.delete(variableStableId)
    return
  }

  const unresolved = new Set<PendingVariableBinding>()
  for (const entry of entries) {
    if (entry.instanceStableId !== undefined) {
      const applied = releasePendingInstanceDescendantVariableBinding(
        state,
        graph,
        entry.instanceStableId,
        entry.nestedInstanceStablePath,
        entry.nodeStableId,
        entry.field,
        localVariableId
      )
      if (!applied) unresolved.add(entry)
      continue
    }

    const node = findNodeByStableId(graph, entry.nodeStableId)
    if (node === undefined) {
      unresolved.add(entry)
      continue
    }
    graph.updateNode(node.id, {
      boundVariables: { ...node.boundVariables, [entry.field]: localVariableId }
    })
  }
  if (unresolved.size > 0) {
    state.pendingVariableBindings.set(variableStableId, unresolved)
  } else {
    state.pendingVariableBindings.delete(variableStableId)
  }
}

function releasePendingInstanceDescendantVariableBinding(
  state: GraphSyncState,
  graph: SceneGraph,
  instanceStableId: string,
  nestedInstanceStablePath: readonly string[] | undefined,
  childStableId: string,
  field: string,
  localVariableId: string
): boolean {
  const instanceId = state.remoteToLocal.get(instanceStableId)
  const instance = instanceId === undefined ? undefined : graph.getNode(instanceId)
  if (instance?.type !== 'INSTANCE') return false

  const child = resolvePendingBindingTarget(
    graph,
    state,
    instance,
    instanceStableId,
    nestedInstanceStablePath,
    childStableId
  )
  if (child === undefined) return false

  const nextOverrides = mergeNestedInstanceOverridePath(
    graph,
    instance,
    instance.overrides,
    nestedInstanceStablePath,
    childStableId,
    'boundVariables',
    { ...child.boundVariables, [field]: localVariableId }
  )
  if (nextOverrides === undefined) return false
  graph.updateNode(instance.id, { overrides: nextOverrides })
  const updatedInstance = graph.getNode(instance.id)
  if (updatedInstance !== undefined) applyInstanceOverrideValuesToChildren(graph, updatedInstance)
  return true
}

function resolvePendingBindingTarget(
  graph: SceneGraph,
  state: GraphSyncState,
  instance: SceneNode,
  instanceStableId: string,
  nestedInstanceStablePath: readonly string[] | undefined,
  childStableId: string
): SceneNode | undefined {
  if (nestedInstanceStablePath === undefined || nestedInstanceStablePath.length === 0) {
    const childId = resolveInstanceOverrideChildId(graph, state, instanceStableId, childStableId)
    return childId === undefined ? undefined : graph.getNode(childId)
  }

  const nestedInstance = findInstanceDescendantByStablePath(
    graph,
    instance,
    nestedInstanceStablePath
  )
  if (nestedInstance?.type !== 'INSTANCE') return undefined
  return findInstanceDescendantByStableId(graph, nestedInstance, childStableId)
}
