import * as Y from 'yjs'

import type {
  GraphSyncState,
  SceneGraph,
  Variable,
  VariableCollection,
  VariableCollectionMode,
  VariableValue
} from '@open-pencil/core/scene-graph'

import type { YCollections, YVariables } from './constants'

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
  const existing = state.modeToLocal.get(stableId)
  if (existing !== undefined) return existing
  if (collectionId !== undefined) {
    const collection = graph.variableCollections.get(collectionId)
    if (collection) {
      for (const mode of collection.modes) {
        if (stableIdForMode(mode) === stableId) {
          state.modeToLocal.set(stableId, mode.modeId)
          return mode.modeId
        }
      }
    }
  }
  return undefined
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
  nodeStableId: string
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
      set.add({ nodeStableId, field })
    }
  }
  return remapped
}
