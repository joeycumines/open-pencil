import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '#tests/engine/collab/helpers'

describe('variables not synced over Yjs', () => {
  test('local variable does not appear in remote graph or ynodes', () => {
    const hostStore = createTestStore()
    const collection = hostStore.graph.createCollection('Tokens')
    hostStore.graph.createVariable('Primary', 'COLOR', collection.id, {
      r: 1,
      g: 0,
      b: 0,
      a: 1
    })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    expect(joinerStore.graph.variables.size).toBe(0)
    expect(joinerStore.graph.variableCollections.size).toBe(0)

    for (const [key] of joinerSync.ynodes.entries()) {
      expect(key).not.toContain(collection.id)
    }
  })
})
