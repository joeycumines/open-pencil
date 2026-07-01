import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  createRemoteCollectionMap,
  createRemoteVariableMap,
  createTestStore,
  createTestYjsSync,
  observeTargetDoc
} from '#tests/engine/collab/helpers'

describe('pending variable sync cleanup', () => {
  test('remote pending variable deletion clears pending variable queues', () => {
    const store = createTestStore()
    const ydoc = new Y.Doc()
    const sync = createTestYjsSync(store, ydoc)
    observeTargetDoc(store, ydoc, sync.applyYjsToGraph, sync.reconcileRoot)
    const state = store.graph.getSyncState()
    const variableStableId = 'var:pending-delete'
    const collectionStableId = 'collection:missing'
    state.pendingVariableBindings.set(
      variableStableId,
      new Set([{ nodeStableId: 'node:uses-pending-variable', field: 'fills' }])
    )

    sync.yvariables.set(
      variableStableId,
      createRemoteVariableMap(variableStableId, collectionStableId, { 'mode:missing': 1 })
    )
    expect(state.pendingVariableCollections.get(collectionStableId)?.has(variableStableId)).toBe(
      true
    )
    expect(state.pendingVariableBindings.has(variableStableId)).toBe(true)

    sync.yvariables.delete(variableStableId)

    expect(state.pendingVariableCollections.has(collectionStableId)).toBe(false)
    expect(state.pendingVariableBindings.has(variableStableId)).toBe(false)
    expect(state.variableToLocal.has(variableStableId)).toBe(false)
    expect(store.graph.variables.size).toBe(0)
  })

  test('remote collection deletion clears queued variable binding entries', () => {
    const store = createTestStore()
    const ydoc = new Y.Doc()
    const sync = createTestYjsSync(store, ydoc)
    observeTargetDoc(store, ydoc, sync.applyYjsToGraph, sync.reconcileRoot)
    const state = store.graph.getSyncState()
    const collectionStableId = 'collection:pending-delete'
    const modeStableId = 'mode:default'
    const variableStableId = 'variable:queued-by-collection'
    sync.ycollections.set(
      collectionStableId,
      createRemoteCollectionMap(collectionStableId, modeStableId)
    )
    const localCollectionId = state.collectionToLocal.get(collectionStableId)
    expect(localCollectionId).toBeDefined()
    state.pendingVariableCollections.set(collectionStableId, new Set([variableStableId]))
    state.pendingVariableBindings.set(
      variableStableId,
      new Set([{ nodeStableId: 'node:uses-queued-variable', field: 'fills' }])
    )

    sync.ycollections.delete(collectionStableId)

    expect(state.collectionToLocal.has(collectionStableId)).toBe(false)
    if (localCollectionId !== undefined) {
      expect(state.localToCollection.has(localCollectionId)).toBe(false)
    }
    expect(state.pendingVariableCollections.has(collectionStableId)).toBe(false)
    expect(state.pendingVariableBindings.has(variableStableId)).toBe(false)
    expect(store.graph.variableCollections.size).toBe(0)
  })
})
