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

describe('KC-001 collaborative merge does not collapse distinct nodes', () => {
  test('peers with disjoint runtime ids keep separate nodes', () => {
    // Host graph.
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const hostA = hostStore.graph.createNode('RECTANGLE', hostPage, { name: 'A' })
    const hostAStable = hostA.source.id
    const hostARuntime = hostA.id

    // Joiner graph with a node whose numeric local id happens to equal hostA's.
    const joinerStore = createTestStore()
    const joinerPage = firstPageId(joinerStore.graph)
    const joinerB = joinerStore.graph.createNode('RECTANGLE', joinerPage, { name: 'B' })
    const joinerBStable = joinerB.source.id
    const joinerBRuntime = joinerB.id

    if (joinerBRuntime !== hostARuntime) {
      joinerStore.graph.nodes.delete(joinerBRuntime)
      joinerB.id = hostARuntime
      joinerStore.graph.nodes.set(hostARuntime, joinerB)
    }

    expect(joinerB.id).toBe(hostA.id)
    expect(joinerBStable).not.toBe(hostAStable)

    // Host shares.
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    // Joiner receives.
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    // Joiner must not have reused hostA's runtime id for B.
    const joinerState = joinerStore.graph.getSyncState()
    expect(joinerState.remoteToLocal.get(hostAStable)).toBeDefined()
    const mappedA = joinerState.remoteToLocal.get(hostAStable)
    expect(mappedA === joinerBRuntime || mappedA === joinerB.id).toBe(false)

    // Joiner's original B still exists.
    expect(joinerStore.graph.getNode(joinerB.id)).toBeDefined()
    expect(joinerStore.graph.getNode(joinerB.id).name).toBe('B')

    hostStore.graph.deleteNode(hostA.id, { permanent: true })
    hostSync.ynodes.delete(hostAStable)
    encodeAndApply(hostYdoc, joinerYdoc)

    expect(joinerStore.graph.getNode(joinerB.id)).toBeDefined()
    expect(joinerStore.graph.getNode(joinerB.id).name).toBe('B')
    expect(joinerStore.graph.getNode(mappedA)).toBeUndefined()
  })
})
