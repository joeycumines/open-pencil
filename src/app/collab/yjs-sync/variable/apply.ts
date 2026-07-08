import type * as Y from 'yjs'

import type {
  GraphSyncState,
  SceneGraph,
  Variable,
  VariableCollection
} from '@open-pencil/scene-graph'

import type { YCollections, YVariables } from '../constants'
import { findStableIdForYMap } from '../mapping'
import { releasePendingVariableAliases, releasePendingVariableBindings } from '../pending-variables'
import {
  fallbackRemoteCollectionModes,
  parseRemoteBooleanValue,
  parseRemoteCollectionModes,
  parseRemoteStableId,
  parseRemoteStableIdValue,
  parseRemoteOptionalString,
  parseRemoteSourceFormat,
  parseRemoteSourceFormatValue,
  parseRemoteStringValue,
  parseRemoteStringArray,
  parseRemoteVariableType
} from './payload'
import {
  activeModeIdForCollection,
  clearPendingVariableAliasesForVariable,
  deleteCollectionMapping,
  deleteVariableMapping,
  mapRemoteModesToLocal,
  pruneModeMappingsForCollection,
  registerCollectionImportedSources,
  registerModeImportedSources,
  remoteSourceMetadata,
  replaceImportedSource,
  stableIdForCollection,
  stableIdForMode,
  stableIdForVariable,
  toCollectionRuntimeId,
  toModeRuntimeId,
  toVariableRuntimeId,
  unregisterModeImportedSources
} from './sync'
import { parseValuesByMode } from './values-by-mode'
import type { PendingParsedVariableAlias } from './values-by-mode'

function resolveVariableIds(
  graph: SceneGraph,
  state: GraphSyncState,
  variableStableIds: string[],
  collectionStableId: string,
  collectionId: string
): string[] {
  const localVariableIds: string[] = []
  for (const vStableId of variableStableIds) {
    const localVid = toVariableRuntimeId(graph, state, vStableId)
    if (localVid !== undefined) {
      const variable = graph.variables.get(localVid)
      if (variable?.collectionId === collectionId) localVariableIds.push(localVid)
    } else {
      queuePendingVariable(state, collectionStableId, vStableId)
    }
  }
  return localVariableIds
}

function findVariableByStableId(
  graph: SceneGraph,
  state: GraphSyncState,
  stableId: string
): Variable | undefined {
  const localId = state.variableToLocal.get(stableId)
  if (localId !== undefined) return graph.variables.get(localId)
  for (const variable of graph.variables.values()) {
    if (stableIdForVariable(variable) === stableId) {
      state.variableToLocal.set(stableId, variable.id)
      state.localToVariable.set(variable.id, stableId)
      return variable
    }
  }
  return undefined
}

function findCollectionByStableId(
  graph: SceneGraph,
  state: GraphSyncState,
  stableId: string
): VariableCollection | undefined {
  const localId = state.collectionToLocal.get(stableId)
  if (localId !== undefined) return graph.variableCollections.get(localId)
  for (const collection of graph.variableCollections.values()) {
    if (stableIdForCollection(collection) === stableId) {
      state.collectionToLocal.set(stableId, collection.id)
      state.localToCollection.set(collection.id, stableId)
      return collection
    }
  }
  return undefined
}

function queuePendingVariable(
  state: GraphSyncState,
  collectionStableId: string,
  variableStableId: string
): void {
  if (collectionStableId.length === 0 || variableStableId.length === 0) return
  let set = state.pendingVariableCollections.get(collectionStableId)
  if (set === undefined) {
    set = new Set()
    state.pendingVariableCollections.set(collectionStableId, set)
  }
  set.add(variableStableId)
}

function clearPendingVariableForCollection(
  state: GraphSyncState,
  collectionStableId: string,
  variableStableId: string
): void {
  const pendingVariableIds = state.pendingVariableCollections.get(collectionStableId)
  if (pendingVariableIds === undefined) return
  pendingVariableIds.delete(variableStableId)
  if (pendingVariableIds.size === 0) state.pendingVariableCollections.delete(collectionStableId)
}

function stableIdForLocalCollection(
  graph: SceneGraph,
  state: GraphSyncState,
  collectionId: string
): string | undefined {
  const mapped = state.localToCollection.get(collectionId)
  if (mapped !== undefined) return mapped
  const collection = graph.variableCollections.get(collectionId)
  return collection === undefined ? undefined : stableIdForCollection(collection)
}

function queuePendingVariableAlias(
  state: GraphSyncState,
  aliasTargetStableId: string,
  variableStableId: string,
  modeStableId: string
): void {
  let set = state.pendingVariableAliases.get(aliasTargetStableId)
  if (set === undefined) {
    set = new Set()
    state.pendingVariableAliases.set(aliasTargetStableId, set)
  }
  for (const entry of set) {
    if (entry.variableStableId === variableStableId && entry.modeStableId === modeStableId) return
  }
  set.add({ variableStableId, modeStableId })
}

function commitPendingVariableAliasesForVariable(
  state: GraphSyncState,
  variableStableId: string,
  pendingAliases: PendingParsedVariableAlias[]
): void {
  clearPendingVariableAliasesForVariable(state, variableStableId)
  for (const entry of pendingAliases) {
    queuePendingVariableAlias(
      state,
      entry.aliasTargetStableId,
      entry.variableStableId,
      entry.modeStableId
    )
  }
}

function drainPendingVariablesForCollection(
  graph: SceneGraph,
  state: GraphSyncState,
  yvariables: YVariables,
  collectionStableId: string
): void {
  const pendingVariableIds = state.pendingVariableCollections.get(collectionStableId)
  if (pendingVariableIds === undefined) return
  state.pendingVariableCollections.delete(collectionStableId)

  for (const variableStableId of pendingVariableIds) {
    const yvar = yvariables.get(variableStableId)
    if (yvar !== undefined) {
      applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)
    }
  }
}

function parseRemoteVariablePayload(yvar: Y.Map<unknown>, remoteStableId: string) {
  const parsedName = parseRemoteStringValue(yvar.get('name'))
  const parsedDescription = parseRemoteStringValue(yvar.get('description'))
  const parsedHiddenFromPublishing = parseRemoteBooleanValue(yvar.get('hiddenFromPublishing'))
  const parsedCollectionStableId = parseRemoteStableIdValue(yvar.get('collectionId'))
  const parsedSourceId = parseRemoteStableIdValue(yvar.get('sourceId'))
  const parsedSourceFormat = parseRemoteSourceFormatValue(yvar.get('sourceFormat'))
  return {
    parsedName,
    name: parsedName.ok ? parsedName.value : 'Variable',
    type: parseRemoteVariableType(yvar.get('type')),
    parsedDescription,
    description: parsedDescription.ok ? parsedDescription.value : '',
    parsedHiddenFromPublishing,
    hiddenFromPublishing: parsedHiddenFromPublishing.ok ? parsedHiddenFromPublishing.value : false,
    collectionStableId: parsedCollectionStableId.ok ? parsedCollectionStableId.value : undefined,
    parsedSourceId,
    sourceId: parsedSourceId.ok ? parsedSourceId.value : remoteStableId,
    parsedSourceFormat,
    sourceFormat: parsedSourceFormat.ok ? parsedSourceFormat.value : null,
    key: parseRemoteOptionalString(yvar.get('key')),
    version: parseRemoteOptionalString(yvar.get('version'))
  }
}

function fallbackModeStableId(remoteStableId: string): string {
  return `${remoteStableId}:default-mode`
}

function stableIdForExistingDefaultMode(collection: VariableCollection): string | undefined {
  const defaultMode = collection.modes.find((mode) => mode.modeId === collection.defaultModeId)
  return defaultMode === undefined ? undefined : stableIdForMode(defaultMode)
}

function replacementDefaultModeStableId(
  existing: VariableCollection,
  parsedDefaultModeStableId: ReturnType<typeof parseRemoteStableIdValue>,
  defaultModeStableId: string,
  remoteModeStableIds: ReadonlySet<string>
): string | undefined {
  if (parsedDefaultModeStableId.ok) {
    return remoteModeStableIds.has(defaultModeStableId) ? defaultModeStableId : undefined
  }
  const existingDefaultStableId = stableIdForExistingDefaultMode(existing)
  if (existingDefaultStableId === undefined) return undefined
  return remoteModeStableIds.has(existingDefaultStableId) ? existingDefaultStableId : undefined
}

function resolveVariableCollectionContext(
  graph: SceneGraph,
  state: GraphSyncState,
  existing: Variable | undefined,
  collectionStableId: string | undefined,
  variableStableId: string
): { collectionId: string; pendingCollectionStableId: string | undefined } | undefined {
  const existingCollectionStableId =
    existing === undefined
      ? undefined
      : stableIdForLocalCollection(graph, state, existing.collectionId)
  if (
    existing !== undefined &&
    collectionStableId !== undefined &&
    existingCollectionStableId !== undefined &&
    collectionStableId !== existingCollectionStableId
  ) {
    return undefined
  }
  const collectionId =
    collectionStableId === undefined
      ? existing?.collectionId
      : toCollectionRuntimeId(graph, state, collectionStableId)
  if (collectionId === undefined) {
    if (collectionStableId !== undefined)
      queuePendingVariable(state, collectionStableId, variableStableId)
    return undefined
  }
  return {
    collectionId,
    pendingCollectionStableId: collectionStableId ?? existingCollectionStableId
  }
}

function applyExistingVariableUpdate(
  graph: SceneGraph,
  state: GraphSyncState,
  existing: Variable,
  remoteStableId: string,
  payload: ReturnType<typeof parseRemoteVariablePayload>,
  parsedValues: ReturnType<typeof parseValuesByMode>,
  pendingCollectionStableId: string | undefined
): void {
  if (payload.parsedName.ok) existing.name = payload.parsedName.value
  if (payload.parsedDescription.ok) existing.description = payload.parsedDescription.value
  if (payload.parsedHiddenFromPublishing.ok) {
    existing.hiddenFromPublishing = payload.parsedHiddenFromPublishing.value
  }
  if (parsedValues.ok) {
    if (pendingCollectionStableId !== undefined) {
      clearPendingVariableForCollection(state, pendingCollectionStableId, remoteStableId)
    }
    commitPendingVariableAliasesForVariable(state, remoteStableId, parsedValues.pendingAliases)
    existing.valuesByMode = parsedValues.valuesByMode
  }
  if (payload.key) existing.key = payload.key
  if (payload.version) existing.version = payload.version
  if (payload.parsedSourceId.ok && payload.parsedSourceFormat.ok) {
    existing.source = replaceImportedSource(
      graph,
      existing.source,
      remoteSourceMetadata(payload.sourceId, payload.sourceFormat)
    )
  }
}

function createRemoteVariable(
  graph: SceneGraph,
  state: GraphSyncState,
  remoteStableId: string,
  payload: ReturnType<typeof parseRemoteVariablePayload>,
  collectionId: string,
  parsedValues: ReturnType<typeof parseValuesByMode>
): void {
  const variableId = graph.generateNodeId()
  const variable: Variable = {
    id: variableId,
    name: payload.name,
    type: payload.type,
    collectionId,
    valuesByMode: parsedValues.ok ? parsedValues.valuesByMode : {},
    description: payload.description,
    hiddenFromPublishing: payload.hiddenFromPublishing,
    ...(payload.key ? { key: payload.key } : {}),
    ...(payload.version ? { version: payload.version } : {}),
    source: remoteSourceMetadata(payload.sourceId, payload.sourceFormat)
  }

  state.variableToLocal.set(remoteStableId, variableId)
  state.localToVariable.set(variableId, remoteStableId)
  commitPendingVariableAliasesForVariable(state, remoteStableId, parsedValues.pendingAliases)
  if (payload.collectionStableId !== undefined) {
    clearPendingVariableForCollection(state, payload.collectionStableId, remoteStableId)
  }
  graph.variables.set(variableId, variable)
  const collection = graph.variableCollections.get(collectionId)
  if (collection && !collection.variableIds.includes(variableId))
    collection.variableIds.push(variableId)
  graph.identity.registerImportedSource(variable.source)
}

export function applyCollectionToGraph(
  graph: SceneGraph,
  state: GraphSyncState,
  yvariables: YVariables,
  remoteStableId: string,
  ycol: Y.Map<unknown>
): void {
  if (remoteStableId.length === 0) return
  const parsedName = parseRemoteStringValue(ycol.get('name'))
  const name = parsedName.ok ? parsedName.value : 'Collection'
  const parsedDefaultModeStableId = parseRemoteStableIdValue(ycol.get('defaultModeId'))
  const defaultModeStableId = parsedDefaultModeStableId.ok
    ? parsedDefaultModeStableId.value
    : fallbackModeStableId(remoteStableId)
  const sourceId = parseRemoteStableId(ycol.get('sourceId'), remoteStableId)
  const sourceFormat = parseRemoteSourceFormat(ycol.get('sourceFormat'))
  const parsedSourceId = parseRemoteStableIdValue(ycol.get('sourceId'))
  const parsedSourceFormat = parseRemoteSourceFormatValue(ycol.get('sourceFormat'))
  const parsedModes = parseRemoteCollectionModes(ycol.get('modes'), defaultModeStableId)
  const modes = parsedModes.ok
    ? parsedModes.value
    : fallbackRemoteCollectionModes(defaultModeStableId)
  const remoteModeStableIds = new Set(modes.map((mode) => mode.modeId))
  const parsedVariableStableIds = parseRemoteStringArray(ycol.get('variableIds'))
  const variableStableIds = parsedVariableStableIds.ok ? parsedVariableStableIds.value : []
  const existing = findCollectionByStableId(graph, state, remoteStableId)

  if (existing !== undefined) {
    if (parsedName.ok) existing.name = parsedName.value
    if (parsedSourceId.ok && parsedSourceFormat.ok) {
      existing.source = replaceImportedSource(
        graph,
        existing.source,
        remoteSourceMetadata(sourceId, sourceFormat)
      )
    }
    if (parsedModes.ok && !parsedModes.sanitized) {
      const replacementDefaultStableId = replacementDefaultModeStableId(
        existing,
        parsedDefaultModeStableId,
        defaultModeStableId,
        remoteModeStableIds
      )
      if (replacementDefaultStableId !== undefined) {
        pruneModeMappingsForCollection(state, remoteStableId, remoteModeStableIds)
        const localModes = mapRemoteModesToLocal(graph, state, modes, remoteStableId, existing.id)
        unregisterModeImportedSources(graph, existing)
        graph.identity.unregisterCollectionModes(existing)
        existing.modes = localModes
        const localDefaultModeId = toModeRuntimeId(
          graph,
          state,
          replacementDefaultStableId,
          existing.id
        )
        if (localDefaultModeId !== undefined) existing.defaultModeId = localDefaultModeId
        graph.activeMode.set(
          existing.id,
          activeModeIdForCollection(graph, existing.id, existing.defaultModeId, localModes)
        )
        graph.identity.registerCollectionModes(existing)
        registerModeImportedSources(graph, existing)
      }
    }
    if (parsedVariableStableIds.ok) {
      existing.variableIds = resolveVariableIds(
        graph,
        state,
        variableStableIds,
        remoteStableId,
        existing.id
      )
    }
    graph.emitter.emit('collection:updated', existing)
    drainPendingVariablesForCollection(graph, state, yvariables, remoteStableId)
    return
  }

  const collectionId = graph.generateNodeId()
  state.collectionToLocal.set(remoteStableId, collectionId)
  state.localToCollection.set(collectionId, remoteStableId)
  pruneModeMappingsForCollection(state, remoteStableId, remoteModeStableIds)
  const localModes = mapRemoteModesToLocal(graph, state, modes, remoteStableId, collectionId)
  const localDefaultModeId =
    toModeRuntimeId(graph, state, defaultModeStableId, collectionId) ??
    (localModes.length > 0 ? localModes[0].modeId : '')
  const collection: VariableCollection = {
    id: collectionId,
    name,
    modes: localModes,
    defaultModeId: localDefaultModeId,
    variableIds: [],
    source: remoteSourceMetadata(sourceId, sourceFormat)
  }
  graph.variableCollections.set(collectionId, collection)
  graph.identity.registerCollectionModes(collection)
  registerCollectionImportedSources(graph, collection)
  graph.activeMode.set(collectionId, localDefaultModeId)
  collection.variableIds = resolveVariableIds(
    graph,
    state,
    variableStableIds,
    remoteStableId,
    collection.id
  )
  drainPendingVariablesForCollection(graph, state, yvariables, remoteStableId)
}

export function applyVariableToGraph(
  graph: SceneGraph,
  state: GraphSyncState,
  _yvariables: YVariables,
  remoteStableId: string,
  yvar: Y.Map<unknown>
): void {
  if (remoteStableId.length === 0) return
  const payload = parseRemoteVariablePayload(yvar, remoteStableId)
  const existing = findVariableByStableId(graph, state, remoteStableId)
  const collectionContext = resolveVariableCollectionContext(
    graph,
    state,
    existing,
    payload.collectionStableId,
    remoteStableId
  )
  if (collectionContext === undefined) return

  const parsedValues = parseValuesByMode(
    graph,
    state,
    yvar.get('valuesByMode'),
    collectionContext.collectionId,
    existing?.type ?? payload.type,
    remoteStableId
  )
  if (parsedValues.missingModeStableIds.length > 0) {
    if (collectionContext.pendingCollectionStableId !== undefined) {
      queuePendingVariable(state, collectionContext.pendingCollectionStableId, remoteStableId)
    }
    return
  }

  if (existing !== undefined) {
    applyExistingVariableUpdate(
      graph,
      state,
      existing,
      remoteStableId,
      payload,
      parsedValues,
      collectionContext.pendingCollectionStableId
    )
    releasePendingVariableAliases(state, graph, remoteStableId)
    releasePendingVariableBindings(state, graph, remoteStableId)
    return
  }

  createRemoteVariable(
    graph,
    state,
    remoteStableId,
    payload,
    collectionContext.collectionId,
    parsedValues
  )
  releasePendingVariableAliases(state, graph, remoteStableId)
  releasePendingVariableBindings(state, graph, remoteStableId)
}

export function applyYjsVariablesToGraph(
  graph: SceneGraph,
  state: GraphSyncState,
  yvariables: YVariables,
  events: Y.YEvent<Y.Map<unknown>>[]
): void {
  const applied = new Set<string>()
  for (const event of events) {
    if (event.target === yvariables) {
      for (const [remoteStableId, change] of event.changes.keys) {
        if (change.action === 'add' || change.action === 'update') {
          const yvar = yvariables.get(remoteStableId)
          if (yvar !== undefined) {
            applyVariableToGraph(graph, state, yvariables, remoteStableId, yvar)
            applied.add(remoteStableId)
          }
        } else {
          const localId = state.variableToLocal.get(remoteStableId)
          if (localId !== undefined) {
            graph.removeVariable(localId)
          }
          deleteVariableMapping(state, localId, remoteStableId)
        }
      }
      continue
    }

    if (event.target.parent === yvariables) {
      const remoteStableId = findStableIdForYMap(yvariables, event.target)
      if (remoteStableId === null || applied.has(remoteStableId)) continue
      const yvar = yvariables.get(remoteStableId)
      if (yvar !== undefined) {
        applyVariableToGraph(graph, state, yvariables, remoteStableId, yvar)
        applied.add(remoteStableId)
      }
    }
  }
}

export function applyYjsCollectionsToGraph(
  graph: SceneGraph,
  state: GraphSyncState,
  ycollections: YCollections,
  yvariables: YVariables,
  events: Y.YEvent<Y.Map<unknown>>[]
): void {
  const applied = new Set<string>()
  for (const event of events) {
    if (event.target === ycollections) {
      for (const [remoteStableId, change] of event.changes.keys) {
        if (change.action === 'add' || change.action === 'update') {
          const ycol = ycollections.get(remoteStableId)
          if (ycol !== undefined) {
            applyCollectionToGraph(graph, state, yvariables, remoteStableId, ycol)
            applied.add(remoteStableId)
          }
        } else {
          const localId = state.collectionToLocal.get(remoteStableId)
          if (localId !== undefined) {
            const collection = graph.variableCollections.get(localId)
            const variableIds = collection === undefined ? [] : [...collection.variableIds]
            graph.removeCollection(localId)
            for (const variableId of variableIds) {
              const variableStableId = state.localToVariable.get(variableId)
              deleteVariableMapping(state, variableId, variableStableId)
            }
          }
          deleteCollectionMapping(state, localId, remoteStableId)
        }
      }
      continue
    }

    if (event.target.parent === ycollections) {
      const remoteStableId = findStableIdForYMap(ycollections, event.target)
      if (remoteStableId === null || applied.has(remoteStableId)) continue
      const ycol = ycollections.get(remoteStableId)
      if (ycol !== undefined) {
        applyCollectionToGraph(graph, state, yvariables, remoteStableId, ycol)
        applied.add(remoteStableId)
      }
    }
  }
}
