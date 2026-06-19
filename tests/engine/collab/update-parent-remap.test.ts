import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '#tests/engine/collab/helpers'
import { firstPageId } from '#tests/helpers/scene'

describe('update parent remap', () => {
  test('received parent id maps to local parent', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const hostA = hostStore.graph.createNode('FRAME', hostPage, { name: 'A' })
    const hostB = hostStore.graph.createNode('RECTANGLE', hostPage, { name: 'B' })
    const aStable = hostA.source.id
    const bStable = hostB.source.id

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    // Reparent B under A on the host and sync.
    hostStore.graph.reparentNode(hostB.id, hostA.id)
    hostSync.syncAllNodesToYjs()

    encodeAndApply(hostYdoc, joinerYdoc)

    const joinerState = joinerStore.graph.getSyncState()
    const localA = joinerState.remoteToLocal.get(aStable)
    expect(localA).toBeDefined()
    expect(joinerStore.graph.getNode(bStable).parentId).toBe(localA)
  })
})
