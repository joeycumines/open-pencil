import * as Y from 'yjs'

import { createDefaultSource } from '@open-pencil/core/scene-graph'
import type {
  GraphSyncState,
  SceneGraph,
  SourceMetadata,
  Variable,
  VariableCollection,
  VariableCollectionMode,
  VariableValue
} from '@open-pencil/core/scene-graph'

import type { YCollections, YVariables } from '../constants'

export interface RemoteVariableCollectionModePayload {
  modeId: string
  name: string
  sourceId: string
  sourceFormat: 'fig' | null
}

// ---------------------------------------------------------------------------
// Stable ID helpers
// ---------------------------------------------------------------------------

export function stableIdForVariable(variable: Variable): string {
  return variable.source?.id ?? variable.id
}

export function stableIdForCollection(collection: VariableCollection): string {
  return collection.source?.id ?? collection.id
}

export function stableIdForMode(mode: VariableCollectionMode): string {
  return mode.source?.id ?? mode.modeId
}

export function remoteSourceMetadata(sourceId: string, sourceFormat: 'fig' | null): SourceMetadata {
  return {
    ...createDefaultSource(),
    id: sourceId,
    format: sourceFormat === 'fig' ? 'fig' : null
  }
}

export function replaceImportedSource(
  graph: SceneGraph,
  current: SourceMetadata | undefined,
  next: SourceMetadata
): SourceMetadata {
  graph.identity.unregisterImportedSource(current)
  graph.identity.registerImportedSource(next)
  return next
}

export function registerCollectionImportedSources(
  graph: SceneGraph,
  collection: VariableCollection
): void {
  graph.identity.registerImportedSource(collection.source)
  for (const mode of collection.modes) graph.identity.registerImportedSource(mode.source)
}

export function registerModeImportedSources(
  graph: SceneGraph,
  collection: VariableCollection
): void {
  for (const mode of collection.modes) graph.identity.registerImportedSource(mode.source)
}

export function unregisterModeImportedSources(
  graph: SceneGraph,
  collection: VariableCollection
): void {
  for (const mode of collection.modes) graph.identity.unregisterImportedSource(mode.source)
}

function stableIdForCollectionId(
  graph: SceneGraph,
  state: GraphSyncState,
  collectionId: string | undefined
): string | undefined {
  if (collectionId === undefined) return undefined
  const mapped = state.localToCollection.get(collectionId)
  if (mapped !== undefined) return mapped
  const collection = graph.variableCollections.get(collectionId)
  return collection === undefined ? undefined : stableIdForCollection(collection)
}

// ---------------------------------------------------------------------------
// Mapping helpers (analogous to ensureRemoteMapping / toRuntimeId for nodes)
// ---------------------------------------------------------------------------

export function ensureVariableMapping(state: GraphSyncState, variable: Variable): string {
  const existing = state.localToVariable.get(variable.id)
  if (existing !== undefined) return existing
  const stableId = stableIdForVariable(variable)
  state.localToVariable.set(variable.id, stableId)
  if (!state.variableToLocal.has(stableId)) {
    state.variableToLocal.set(stableId, variable.id)
  }
  return stableId
}

export function ensureCollectionMapping(
  state: GraphSyncState,
  collection: VariableCollection
): string {
  const existing = state.localToCollection.get(collection.id)
  if (existing !== undefined) return existing
  const stableId = stableIdForCollection(collection)
  state.localToCollection.set(collection.id, stableId)
  if (!state.collectionToLocal.has(stableId)) {
    state.collectionToLocal.set(stableId, collection.id)
  }
  return stableId
}

export function toVariableRuntimeId(
  _graph: SceneGraph,
  state: GraphSyncState,
  stableId: string | null | undefined
): string | undefined {
  if (stableId === null || stableId === undefined) return undefined
  return state.variableToLocal.get(stableId)
}

export function toCollectionRuntimeId(
  _graph: SceneGraph,
  state: GraphSyncState,
  stableId: string | null | undefined
): string | undefined {
  if (stableId === null || stableId === undefined) return undefined
  return state.collectionToLocal.get(stableId)
}

export function toModeRuntimeId(
  graph: SceneGraph,
  state: GraphSyncState,
  stableId: string | null | undefined,
  collectionId: string | undefined
): string | undefined {
  if (stableId === null || stableId === undefined) return undefined
  const collectionStableId = stableIdForCollectionId(graph, state, collectionId)
  const existing =
    collectionStableId === undefined
      ? undefined
      : state.modeToLocal.get(collectionStableId)?.get(stableId)
  if (existing !== undefined) return existing
  if (collectionId !== undefined) {
    const collection = graph.variableCollections.get(collectionId)
    if (collection) {
      for (const mode of collection.modes) {
        if (stableIdForMode(mode) === stableId) {
          if (collectionStableId !== undefined) {
            ensureModeMapping(state, collectionStableId, stableId, mode.modeId)
          }
          return mode.modeId
        }
      }
    }
  }
  return undefined
}

export function isRuntimeNamespaceOccupied(graph: SceneGraph, id: string): boolean {
  return graph.nodes.has(id) || graph.variables.has(id) || graph.variableCollections.has(id)
}

export function pruneModeMappingsForCollection(
  state: GraphSyncState,
  collectionStableId: string,
  remoteModeStableIds: ReadonlySet<string>
): void {
  const mappedModes = state.modeToLocal.get(collectionStableId)
  if (mappedModes === undefined) return
  for (const remoteModeStableId of mappedModes.keys()) {
    if (!remoteModeStableIds.has(remoteModeStableId)) mappedModes.delete(remoteModeStableId)
  }
  if (mappedModes.size === 0) state.modeToLocal.delete(collectionStableId)
}

export function activeModeIdForCollection(
  graph: SceneGraph,
  collectionId: string,
  localDefaultModeId: string,
  modes: VariableCollectionMode[]
): string {
  const activeModeId = graph.activeMode.get(collectionId)
  if (activeModeId !== undefined && modes.some((mode) => mode.modeId === activeModeId)) {
    return activeModeId
  }
  return localDefaultModeId
}

export function mapRemoteModesToLocal(
  graph: SceneGraph,
  state: GraphSyncState,
  modes: RemoteVariableCollectionModePayload[],
  collectionStableId: string,
  collectionId: string | undefined
): VariableCollectionMode[] {
  return modes.map((mode) => {
    const mappedModeId =
      collectionId === undefined
        ? undefined
        : toModeRuntimeId(graph, state, mode.modeId, collectionId)
    const localModeId =
      mappedModeId !== undefined && !isRuntimeNamespaceOccupied(graph, mappedModeId)
        ? mappedModeId
        : graph.generateNodeId()
    ensureModeMapping(state, collectionStableId, mode.modeId, localModeId)
    return {
      modeId: localModeId,
      name: mode.name,
      source: remoteSourceMetadata(mode.sourceId, mode.sourceFormat)
    }
  })
}

export function ensureModeMapping(
  state: GraphSyncState,
  collectionStableId: string,
  modeStableId: string,
  localModeId: string
): void {
  let collectionModes = state.modeToLocal.get(collectionStableId)
  if (collectionModes === undefined) {
    collectionModes = new Map()
    state.modeToLocal.set(collectionStableId, collectionModes)
  }
  collectionModes.set(modeStableId, localModeId)
}

export function deleteVariableMapping(
  state: GraphSyncState,
  localVariableId: string | undefined,
  remoteStableId = localVariableId === undefined
    ? undefined
    : state.localToVariable.get(localVariableId)
): void {
  if (localVariableId !== undefined) state.localToVariable.delete(localVariableId)
  if (remoteStableId === undefined) return
  state.variableToLocal.delete(remoteStableId)
  deletePendingVariableReferences(state, remoteStableId)
}

export function clearPendingVariableAliasesForVariable(
  state: GraphSyncState,
  remoteStableId: string
): void {
  for (const [aliasTargetStableId, entries] of state.pendingVariableAliases) {
    const remaining = [...entries].filter((entry) => entry.variableStableId !== remoteStableId)
    if (remaining.length === entries.size) continue
    if (remaining.length === 0) {
      state.pendingVariableAliases.delete(aliasTargetStableId)
    } else {
      state.pendingVariableAliases.set(aliasTargetStableId, new Set(remaining))
    }
  }
}

function deletePendingVariableReferences(state: GraphSyncState, remoteStableId: string): void {
  state.pendingVariableBindings.delete(remoteStableId)
  state.pendingVariableAliases.delete(remoteStableId)
  for (const [collectionStableId, pendingVariableIds] of state.pendingVariableCollections) {
    if (!pendingVariableIds.delete(remoteStableId)) continue
    if (pendingVariableIds.size === 0) state.pendingVariableCollections.delete(collectionStableId)
  }
  clearPendingVariableAliasesForVariable(state, remoteStableId)
}

export function deleteCollectionMapping(
  state: GraphSyncState,
  localCollectionId: string | undefined,
  remoteStableId = localCollectionId === undefined
    ? undefined
    : state.localToCollection.get(localCollectionId)
): void {
  if (localCollectionId !== undefined) state.localToCollection.delete(localCollectionId)
  if (remoteStableId === undefined) return
  state.collectionToLocal.delete(remoteStableId)
  const pendingVariableIds = [...(state.pendingVariableCollections.get(remoteStableId) ?? [])]
  state.pendingVariableCollections.delete(remoteStableId)
  for (const variableStableId of pendingVariableIds) {
    deletePendingVariableReferences(state, variableStableId)
  }
  state.modeToLocal.delete(remoteStableId)
}

// ---------------------------------------------------------------------------
// Outbound sync: local graph -> Yjs
// ---------------------------------------------------------------------------

function serializeValuesByMode(
  graph: SceneGraph,
  state: GraphSyncState,
  variable: Variable
): Record<string, VariableValue> {
  const result: Record<string, VariableValue> = {}
  for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
    const collection = graph.variableCollections.get(variable.collectionId)
    const mode = collection?.modes.find((m) => m.modeId === modeId)
    const modeStableId = mode ? stableIdForMode(mode) : modeId
    if (value && typeof value === 'object' && 'aliasId' in value) {
      const aliasedVar = graph.variables.get((value as { aliasId: string }).aliasId)
      const aliasStableId = aliasedVar
        ? ensureVariableMapping(state, aliasedVar)
        : (value as { aliasId: string }).aliasId
      result[modeStableId] = { aliasId: aliasStableId }
    } else {
      result[modeStableId] = value
    }
  }
  return result
}

export function syncVariableToYjs(
  graph: SceneGraph,
  state: GraphSyncState,
  yvariables: YVariables,
  variable: Variable
): void {
  const stableId = ensureVariableMapping(state, variable)
  let yvar = yvariables.get(stableId)
  if (yvar === undefined) {
    yvar = new Y.Map<unknown>()
    yvariables.set(stableId, yvar)
  }

  yvar.set('id', stableId)
  yvar.set('name', variable.name)
  yvar.set('type', variable.type)
  yvar.set('description', variable.description)
  yvar.set('hiddenFromPublishing', variable.hiddenFromPublishing)

  const collection = graph.variableCollections.get(variable.collectionId)
  const collectionStableId = collection
    ? ensureCollectionMapping(state, collection)
    : variable.collectionId
  yvar.set('collectionId', collectionStableId)

  if (variable.key) yvar.set('key', variable.key)
  if (variable.version) yvar.set('version', variable.version)

  yvar.set('sourceId', variable.source?.id ?? variable.id)
  yvar.set('sourceFormat', variable.source?.format ?? null)

  yvar.set('valuesByMode', JSON.stringify(serializeValuesByMode(graph, state, variable)))
}

export function syncCollectionToYjs(
  graph: SceneGraph,
  state: GraphSyncState,
  ycollections: YCollections,
  collection: VariableCollection
): void {
  const stableId = ensureCollectionMapping(state, collection)
  let ycol = ycollections.get(stableId)
  if (ycol === undefined) {
    ycol = new Y.Map<unknown>()
    ycollections.set(stableId, ycol)
  }

  ycol.set('id', stableId)
  ycol.set('name', collection.name)
  const defaultMode =
    collection.modes.find((m) => m.modeId === collection.defaultModeId) ?? collection.modes[0]
  ycol.set('defaultModeId', stableIdForMode(defaultMode))

  const modes = collection.modes.map((mode) => ({
    modeId: stableIdForMode(mode),
    name: mode.name,
    sourceId: mode.source?.id ?? mode.modeId,
    sourceFormat: mode.source?.format ?? null
  }))
  ycol.set('modes', JSON.stringify(modes))

  const variableStableIds = collection.variableIds
    .map((vid) => {
      const v = graph.variables.get(vid)
      return v ? stableIdForVariable(v) : null
    })
    .filter((id): id is string => id !== null)
  ycol.set('variableIds', JSON.stringify(variableStableIds))

  ycol.set('sourceId', collection.source?.id ?? collection.id)
  ycol.set('sourceFormat', collection.source?.format ?? null)
}

export function syncAllVariablesToYjs(
  graph: SceneGraph,
  state: GraphSyncState,
  yvariables: YVariables,
  ycollections: YCollections
): void {
  for (const collection of graph.variableCollections.values()) {
    syncCollectionToYjs(graph, state, ycollections, collection)
  }
  for (const variable of graph.variables.values()) {
    syncVariableToYjs(graph, state, yvariables, variable)
  }
}

// ---------------------------------------------------------------------------
// BoundVariables remapping (called from serialize.ts)
// ---------------------------------------------------------------------------

export function remapBoundVariablesToRemote(
  graph: SceneGraph,
  state: GraphSyncState,
  boundVariables: Record<string, string>
): Record<string, string> {
  const remapped: Record<string, string> = {}
  for (const [field, varId] of Object.entries(boundVariables)) {
    const variable = graph.variables.get(varId)
    const stableId = variable ? ensureVariableMapping(state, variable) : varId
    remapped[field] = stableId
  }
  return remapped
}

export function remapBoundVariablesToLocal(
  graph: SceneGraph,
  state: GraphSyncState,
  boundVariables: Record<string, string> | undefined,
  nodeStableId: string,
  instanceStableId?: string,
  nestedInstanceStablePath?: readonly string[]
): Record<string, string> {
  if (boundVariables === undefined) return {}
  const remapped: Record<string, string> = {}
  for (const [field, stableId] of Object.entries(boundVariables)) {
    const localId = toVariableRuntimeId(graph, state, stableId)
    if (localId !== undefined) {
      remapped[field] = localId
    } else {
      let set = state.pendingVariableBindings.get(stableId)
      if (set === undefined) {
        set = new Set()
        state.pendingVariableBindings.set(stableId, set)
      }
      set.add({
        nodeStableId,
        instanceStableId,
        nestedInstanceStablePath:
          nestedInstanceStablePath === undefined ? undefined : [...nestedInstanceStablePath],
        field
      })
    }
  }
  return remapped
}
