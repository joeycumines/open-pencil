import type { GraphSyncState, SceneGraph, Variable, VariableValue } from '@open-pencil/scene-graph'

import { parseRemoteValuesByMode } from './payload'
import { toModeRuntimeId, toVariableRuntimeId } from './sync'

export interface PendingParsedVariableAlias {
  aliasTargetStableId: string
  variableStableId: string
  modeStableId: string
}

export function parseValuesByMode(
  graph: SceneGraph,
  state: GraphSyncState,
  raw: unknown,
  collectionId: string,
  variableType: Variable['type'],
  variableStableId: string
): {
  ok: boolean
  valuesByMode: Record<string, VariableValue>
  missingModeStableIds: string[]
  pendingAliases: PendingParsedVariableAlias[]
} {
  const parsed = parseRemoteValuesByMode(raw, variableType)
  if (!parsed.ok) {
    return { ok: false, valuesByMode: {}, missingModeStableIds: [], pendingAliases: [] }
  }
  const result: Record<string, VariableValue> = {}
  const missingModeStableIds: string[] = []
  const pendingAliases: PendingParsedVariableAlias[] = []
  for (const [modeStableId, value] of Object.entries(parsed.value)) {
    const localModeId = toModeRuntimeId(graph, state, modeStableId, collectionId)
    if (localModeId === undefined) {
      missingModeStableIds.push(modeStableId)
      continue
    }
    if (value && typeof value === 'object' && 'aliasId' in value) {
      const alias = parseAliasValue(graph, state, value.aliasId, variableType)
      if (alias === 'invalid') {
        return { ok: false, valuesByMode: {}, missingModeStableIds: [], pendingAliases: [] }
      }
      result[localModeId] = { aliasId: alias.aliasId }
      if (alias.pending) {
        pendingAliases.push({
          aliasTargetStableId: value.aliasId,
          variableStableId,
          modeStableId
        })
      }
      continue
    }
    result[localModeId] = value
  }
  return { ok: true, valuesByMode: result, missingModeStableIds, pendingAliases }
}

function parseAliasValue(
  graph: SceneGraph,
  state: GraphSyncState,
  aliasStableId: string,
  variableType: Variable['type']
): { aliasId: string; pending: boolean } | 'invalid' {
  const aliasLocalId = toVariableRuntimeId(graph, state, aliasStableId)
  if (aliasLocalId === undefined) return { aliasId: aliasStableId, pending: true }
  const aliasVariable = graph.variables.get(aliasLocalId)
  if (aliasVariable?.type !== variableType) return 'invalid'
  return { aliasId: aliasLocalId, pending: false }
}
