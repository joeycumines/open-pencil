import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  applyYjsCollectionsToGraph,
  applyCollectionToGraph,
  applyVariableToGraph,
  syncCollectionToYjs,
  syncVariableToYjs
} from '@/app/collab/yjs-sync'

import {
  createRemoteCollectionMap,
  createRemoteVariableMap,
  createTestStore
} from '#tests/engine/collab/helpers'

describe('remote variable payload review-1g regressions', () => {
  test('remote collection variableIds cannot steal variables from another collection', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionAStableId = 'collection:membership-a'
    const collectionBStableId = 'collection:membership-b'
    const modeAStableId = 'mode:membership-a'
    const modeBStableId = 'mode:membership-b'
    const variableStableId = 'variable:membership-victim'

    const ycolA = createRemoteCollectionMap(collectionAStableId, modeAStableId, [variableStableId])
    const ycolB = createRemoteCollectionMap(collectionBStableId, modeBStableId)
    ycollections.set(collectionAStableId, ycolA)
    ycollections.set(collectionBStableId, ycolB)
    applyCollectionToGraph(graph, state, yvariables, collectionAStableId, ycolA)
    applyCollectionToGraph(graph, state, yvariables, collectionBStableId, ycolB)
    const yvar = createRemoteVariableMap(variableStableId, collectionAStableId, {
      [modeAStableId]: 12
    })
    yvariables.set(variableStableId, yvar)
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    const variableId = state.variableToLocal.get(variableStableId)
    const collectionAId = state.collectionToLocal.get(collectionAStableId)
    const collectionBId = state.collectionToLocal.get(collectionBStableId)
    expect(variableId).toBeDefined()
    expect(collectionAId).toBeDefined()
    expect(collectionBId).toBeDefined()
    if (variableId === undefined || collectionAId === undefined || collectionBId === undefined)
      return

    ycolB.set('variableIds', JSON.stringify([variableStableId]))
    applyCollectionToGraph(graph, state, yvariables, collectionBStableId, ycolB)

    const collectionA = graph.variableCollections.get(collectionAId)
    const collectionB = graph.variableCollections.get(collectionBId)
    expect(collectionA).toBeDefined()
    expect(collectionB).toBeDefined()
    if (collectionA === undefined || collectionB === undefined) return
    expect(collectionA?.variableIds).toEqual([variableId])
    expect(collectionB?.variableIds).toEqual([])
    syncCollectionToYjs(graph, state, ycollections, collectionB)
    expect(ycollections.get(collectionBStableId)?.get('variableIds')).toBe('[]')

    ycollections.observeDeep((nextEvents) => {
      applyYjsCollectionsToGraph(graph, state, ycollections, yvariables, nextEvents)
    })
    ycollections.delete(collectionBStableId)

    expect(graph.variables.has(variableId)).toBe(true)
    expect(graph.variableCollections.get(collectionAId)?.variableIds).toEqual([variableId])
  })

  test('remote valuesByMode values must match the variable type before storage', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:type-validation'
    const modeStableId = 'mode:type-validation'
    const variableStableId = 'variable:type-validation'
    const colorValue = { r: 1, g: 0, b: 0, a: 1 }
    const ycol = createRemoteCollectionMap(collectionStableId, modeStableId, [variableStableId])
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const yvar = createRemoteVariableMap(variableStableId, collectionStableId, {
      [modeStableId]: colorValue
    })
    yvar.set('type', 'FLOAT')
    yvariables.set(variableStableId, yvar)
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    const variableId = state.variableToLocal.get(variableStableId)
    expect(variableId).toBeDefined()
    if (variableId === undefined) return
    const variable = graph.variables.get(variableId)
    expect(variable).toBeDefined()
    if (variable === undefined) return
    expect(variable.type).toBe('FLOAT')
    expect(variable.valuesByMode).toEqual({})
    syncVariableToYjs(graph, state, yvariables, variable)
    expect(yvariables.get(variableStableId)?.get('valuesByMode')).toBe('{}')

    yvar.set('valuesByMode', JSON.stringify({ [modeStableId]: 8 }))
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)
    const localModeId = state.modeToLocal.get(collectionStableId)?.get(modeStableId)
    expect(localModeId).toBeDefined()
    if (localModeId === undefined) return
    expect(variable.valuesByMode[localModeId]).toBe(8)

    yvar.set('valuesByMode', JSON.stringify({ [modeStableId]: colorValue }))
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)
    expect(variable.valuesByMode[localModeId]).toBe(8)
    syncVariableToYjs(graph, state, yvariables, variable)
    expect(yvariables.get(variableStableId)?.get('valuesByMode')).toBe(
      JSON.stringify({ [modeStableId]: 8 })
    )
  })

  test('remote aliases must target variables with the same declared type', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:alias-type-validation'
    const modeStableId = 'mode:alias-type-validation'
    const sourceStableId = 'variable:float-alias-source'
    const targetStableId = 'variable:color-alias-target'
    const ycol = createRemoteCollectionMap(collectionStableId, modeStableId, [
      sourceStableId,
      targetStableId
    ])
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const target = createRemoteVariableMap(targetStableId, collectionStableId, {
      [modeStableId]: { r: 0, g: 0, b: 1, a: 1 }
    })
    target.set('type', 'COLOR')
    yvariables.set(targetStableId, target)
    applyVariableToGraph(graph, state, yvariables, targetStableId, target)

    const source = createRemoteVariableMap(sourceStableId, collectionStableId, {
      [modeStableId]: { aliasId: targetStableId }
    })
    source.set('type', 'FLOAT')
    yvariables.set(sourceStableId, source)
    applyVariableToGraph(graph, state, yvariables, sourceStableId, source)

    const sourceId = state.variableToLocal.get(sourceStableId)
    expect(sourceId).toBeDefined()
    if (sourceId === undefined) return
    expect(graph.variables.get(sourceId)?.valuesByMode).toEqual({})
    expect(state.pendingVariableAliases.size).toBe(0)
  })
})
