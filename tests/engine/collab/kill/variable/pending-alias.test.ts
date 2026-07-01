import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { applyCollectionToGraph, applyVariableToGraph } from '@/app/collab/yjs-sync'

import {
  createRemoteCollectionMap,
  createRemoteVariableMap,
  createTestStore
} from '#tests/engine/collab/helpers'

describe('remote variable pending alias payload validation', () => {
  test('deferred existing variable updates preserve pending alias release for existing values', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:deferred-alias'
    const modeStableId = 'mode:deferred-alias'
    const missingModeStableId = 'mode:deferred-missing'
    const aliasVariableStableId = 'variable:deferred-alias-source'
    const targetVariableStableId = 'variable:deferred-alias-target'
    const ycol = createRemoteCollectionMap(collectionStableId, modeStableId, [
      aliasVariableStableId,
      targetVariableStableId
    ])
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const aliasYvar = createRemoteVariableMap(aliasVariableStableId, collectionStableId, {
      [modeStableId]: { aliasId: targetVariableStableId }
    })
    yvariables.set(aliasVariableStableId, aliasYvar)
    applyVariableToGraph(graph, state, yvariables, aliasVariableStableId, aliasYvar)

    const aliasLocalId = state.variableToLocal.get(aliasVariableStableId)
    expect(aliasLocalId).toBeDefined()
    if (aliasLocalId === undefined) return
    const aliasVariable = graph.variables.get(aliasLocalId)
    expect(aliasVariable).toBeDefined()
    if (aliasVariable === undefined) return
    const localModeId = state.modeToLocal.get(collectionStableId)?.get(modeStableId)
    expect(localModeId).toBeDefined()
    if (localModeId === undefined) return
    expect(aliasVariable.valuesByMode[localModeId]).toEqual({ aliasId: targetVariableStableId })
    expect(state.pendingVariableAliases.get(targetVariableStableId)?.size).toBe(1)

    aliasYvar.set(
      'valuesByMode',
      JSON.stringify({
        [modeStableId]: { aliasId: targetVariableStableId },
        [missingModeStableId]: 8
      })
    )
    applyVariableToGraph(graph, state, yvariables, aliasVariableStableId, aliasYvar)

    expect(aliasVariable.valuesByMode[localModeId]).toEqual({ aliasId: targetVariableStableId })
    expect(state.pendingVariableAliases.get(targetVariableStableId)?.size).toBe(1)
    expect(
      state.pendingVariableCollections.get(collectionStableId)?.has(aliasVariableStableId)
    ).toBe(true)

    const targetYvar = createRemoteVariableMap(targetVariableStableId, collectionStableId, {
      [modeStableId]: 7
    })
    yvariables.set(targetVariableStableId, targetYvar)
    applyVariableToGraph(graph, state, yvariables, targetVariableStableId, targetYvar)

    const targetLocalId = state.variableToLocal.get(targetVariableStableId)
    expect(targetLocalId).toBeDefined()
    expect(aliasVariable.valuesByMode[localModeId]).toEqual({ aliasId: targetLocalId })
    expect(state.pendingVariableAliases.has(targetVariableStableId)).toBe(false)
  })
})
