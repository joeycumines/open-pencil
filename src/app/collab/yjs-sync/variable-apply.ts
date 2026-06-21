import type * as Y from 'yjs'

import { createDefaultSource } from '@open-pencil/core/scene-graph'
import type {
  GraphSyncState,
  SceneGraph,
  Variable,
  VariableCollection,
  VariableCollectionMode,
  VariableValue
} from '@open-pencil/core/scene-graph'

import type { YCollections, YVariables } from './constants'
import { findNodeByStableId } from './mapping'
import {
  stableIdForCollection,
  stableIdForVariable,
  toCollectionRuntimeId,
  toModeRuntimeId,
  toVariableRuntimeId
} from './variables'

// ---------------------------------------------------------------------------
// Inbound helpers
// ---------------------------------------------------------------------------

function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return Array.isArray(raw) ? (raw as T) : fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function mapRemoteModesToLocal(
  graph: SceneGraph,
  state: GraphSyncState,
  modes: Array<{ modeId: string; name: string; sourceId: string; sourceFormat: string | null }>,
  collectionId: string | undefined
): VariableCollectionMode[] {
  return modes.map((m) => {
    const localModeId =
      (collectionId !== undefined
        ? toModeRuntimeId(graph, state, m.modeId, collectionId)
        : undefined) ?? graph.generateNodeId()
    state.modeToLocal.set(m.modeId, localModeId)
    return {
      modeId: localModeId,
      name: m.name,
      source: {
        ...createDefaultSource(),
        id: m.sourceId,
        format: m.sourceFormat === 'fig' ? ('fig' as const) : null
      }
    }
  })
}

function resolveVariableIds(
  graph: SceneGraph,
  state: GraphSyncState,
  variableStableIds: string[],
  collectionStableId: string
): string[] {
  const localVariableIds: string[] = []
  for (const vStableId of variableStableIds) {
    const localVid = toVariableRuntimeId(graph, state, vStableId)
    if (localVid !== undefined) {
      localVariableIds.push(localVid)
    } else {
      queuePendingVariable(state, collectionStableId, vStableId)
    }
  }
  return localVariableIds
}

function parseValuesByMode(
  graph: SceneGraph,
  state: GraphSyncState,
  raw: unknown,
  collectionId: string
): Record<string, VariableValue> {
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, VariableValue>
    const result: Record<string, VariableValue> = {}
    for (const [modeStableId, value] of Object.entries(parsed)) {
      const localModeId = toModeRuntimeId(graph, state, modeStableId, collectionId)
      if (localModeId === undefined) continue
      if (value && typeof value === 'object' && 'aliasId' in value) {
        const aliasLocalId = toVariableRuntimeId(
          graph,
          state,
          (value as { aliasId: string }).aliasId
        )
        result[localModeId] = aliasLocalId ? { aliasId: aliasLocalId } : (value as VariableValue)
      } else {
        result[localModeId] = value
      }
    }
    return result
  } catch {
    return {}
  }
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
  let set = state.pendingVariableCollections.get(collectionStableId)
  if (set === undefined) {
    set = new Set()
    state.pendingVariableCollections.set(collectionStableId, set)
  }
  set.add(variableStableId)
}

// ---------------------------------------------------------------------------
// Inbound apply: Yjs -> local graph
// ---------------------------------------------------------------------------

export function applyCollectionToGraph(
  graph: SceneGraph,
  state: GraphSyncState,
  _ycollections: YCollections,
  remoteStableId: string,
  ycol: Y.Map<unknown>
): void {
  const name = (ycol.get('name') ?? 'Collection') as string
  const defaultModeStableId = (ycol.get('defaultModeId') ?? '') as string
  const sourceId = (ycol.get('sourceId') ?? remoteStableId) as string
  const sourceFormat = (ycol.get('sourceFormat') ?? null) as string | null
  const modes = parseJsonField<
    Array<{ modeId: string; name: string; sourceId: string; sourceFormat: string | null }>
  >(ycol.get('modes'), [])
  const variableStableIds = parseJsonField<string[]>(ycol.get('variableIds'), [])
  const existing = findCollectionByStableId(graph, state, remoteStableId)

  if (existing !== undefined) {
    existing.name = name
    existing.modes = mapRemoteModesToLocal(graph, state, modes, existing.id)
    const localDefaultModeId = toModeRuntimeId(graph, state, defaultModeStableId, existing.id)
    if (localDefaultModeId !== undefined) existing.defaultModeId = localDefaultModeId
    existing.variableIds = resolveVariableIds(graph, state, variableStableIds, remoteStableId)
    graph.emitter.emit('collection:updated', existing)
    return
  }

  const collectionId = graph.generateNodeId()
  const localModes = mapRemoteModesToLocal(graph, state, modes, undefined)
  const localDefaultModeId =
    toModeRuntimeId(graph, state, defaultModeStableId, collectionId) ??
    (localModes.length > 0 ? localModes[0].modeId : '')
  const collection: VariableCollection = {
    id: collectionId,
    name,
    modes: localModes,
    defaultModeId: localDefaultModeId,
    variableIds: [],
    source: {
      ...createDefaultSource(),
      id: sourceId,
      format: sourceFormat === 'fig' ? 'fig' : null
    }
  }
  state.collectionToLocal.set(remoteStableId, collectionId)
  state.localToCollection.set(collectionId, remoteStableId)
  graph.variableCollections.set(collectionId, collection)
  if (!graph.activeMode.has(collectionId)) {
    graph.activeMode.set(collectionId, localDefaultModeId)
  }
  resolveVariableIds(graph, state, variableStableIds, remoteStableId)
}

export function applyVariableToGraph(
  graph: SceneGraph,
  state: GraphSyncState,
  _yvariables: YVariables,
  remoteStableId: string,
  yvar: Y.Map<unknown>
): void {
  const name = (yvar.get('name') ?? 'Variable') as string
  const type = (yvar.get('type') ?? 'COLOR') as Variable['type']
  const description = (yvar.get('description') ?? '') as string
  const hiddenFromPublishing = (yvar.get('hiddenFromPublishing') ?? false) as boolean
  const collectionStableId = (yvar.get('collectionId') ?? '') as string
  const sourceId = (yvar.get('sourceId') ?? remoteStableId) as string
  const sourceFormat = (yvar.get('sourceFormat') ?? null) as string | null
  const key = yvar.get('key') as string | undefined
  const version = yvar.get('version') as string | undefined

  const collectionId = toCollectionRuntimeId(graph, state, collectionStableId)
  if (collectionId === undefined) {
    queuePendingVariable(state, collectionStableId, remoteStableId)
    return
  }

  const valuesByMode = parseValuesByMode(graph, state, yvar.get('valuesByMode'), collectionId)
  const existing = findVariableByStableId(graph, state, remoteStableId)

  if (existing !== undefined) {
    existing.name = name
    existing.description = description
    existing.hiddenFromPublishing = hiddenFromPublishing
    existing.valuesByMode = valuesByMode
    if (key) existing.key = key
    if (version) existing.version = version
    releasePendingVariableBindings(state, graph, remoteStableId)
    return
  }

  // Create new variable
  const variableId = graph.generateNodeId()
  const variable: Variable = {
    id: variableId,
    name,
    type,
    collectionId,
    valuesByMode,
    description,
    hiddenFromPublishing,
    ...(key ? { key } : {}),
    ...(version ? { version } : {}),
    source: {
      ...createDefaultSource(),
      id: sourceId,
      format: sourceFormat === 'fig' ? 'fig' : null
    }
  }

  state.variableToLocal.set(remoteStableId, variableId)
  state.localToVariable.set(variableId, remoteStableId)

  // Add variable directly (not via graph.addVariable to avoid re-emitting)
  graph.variables.set(variableId, variable)
  const collection = graph.variableCollections.get(collectionId)
  if (collection && !collection.variableIds.includes(variableId)) {
    collection.variableIds.push(variableId)
  }

  releasePendingVariableBindings(state, graph, remoteStableId)
}

// ---------------------------------------------------------------------------
// Pending binding resolution
// ---------------------------------------------------------------------------

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

  for (const entry of entries) {
    const node = findNodeByStableId(graph, entry.nodeStableId)
    if (node === undefined) continue
    const newBoundVariables = { ...node.boundVariables, [entry.field]: localVariableId }
    graph.updateNode(node.id, { boundVariables: newBoundVariables })
  }
  state.pendingVariableBindings.delete(variableStableId)
}

// ---------------------------------------------------------------------------
// Yjs event handlers
// ---------------------------------------------------------------------------

export function applyYjsVariablesToGraph(
  graph: SceneGraph,
  state: GraphSyncState,
  yvariables: YVariables,
  events: Y.YEvent<Y.Map<unknown>>[]
): void {
  for (const event of events) {
    if (event.target === yvariables) {
      for (const [remoteStableId, change] of event.changes.keys) {
        if (change.action === 'add' || change.action === 'update') {
          const yvar = yvariables.get(remoteStableId)
          if (yvar !== undefined) {
            applyVariableToGraph(graph, state, yvariables, remoteStableId, yvar)
          }
        } else {
          const localId = state.variableToLocal.get(remoteStableId)
          if (localId !== undefined) {
            graph.removeVariable(localId)
            state.variableToLocal.delete(remoteStableId)
            state.localToVariable.delete(localId)
          }
        }
      }
    }
  }
}

export function applyYjsCollectionsToGraph(
  graph: SceneGraph,
  state: GraphSyncState,
  ycollections: YCollections,
  events: Y.YEvent<Y.Map<unknown>>[]
): void {
  for (const event of events) {
    if (event.target === ycollections) {
      for (const [remoteStableId, change] of event.changes.keys) {
        if (change.action === 'add' || change.action === 'update') {
          const ycol = ycollections.get(remoteStableId)
          if (ycol !== undefined) {
            applyCollectionToGraph(graph, state, ycollections, remoteStableId, ycol)
          }
        } else {
          const localId = state.collectionToLocal.get(remoteStableId)
          if (localId !== undefined) {
            graph.removeCollection(localId)
            state.collectionToLocal.delete(remoteStableId)
            state.localToCollection.delete(localId)
          }
        }
      }
    }
  }
}
