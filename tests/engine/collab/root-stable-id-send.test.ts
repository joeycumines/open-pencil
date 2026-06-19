import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '#tests/engine/collab/helpers'

describe('root stable id send', () => {
  test('host root stable id becomes canonical on joiner', () => {
    const hostStore = createTestStore()
    const hostRoot = hostStore.graph.getNode(hostStore.graph.rootId)
    expect(hostRoot).toBeDefined()
    if (hostRoot === undefined) return
    const hostRootStable = hostRoot.source.id
    expect(hostRootStable).toBeTruthy()

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    expect(hostSync.ynodes.has(hostRootStable)).toBe(true)

    const joinerStore = createTestStore()
    const joinerRoot = joinerStore.graph.getNode(joinerStore.graph.rootId)
    expect(joinerRoot).toBeDefined()
    if (joinerRoot === undefined) return

    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    const joinerState = joinerStore.graph.getSyncState()
    expect(joinerState.remoteRootStableId).toBe(hostRootStable)
    expect(joinerState.remoteToLocal.get(hostRootStable)).toBe(joinerStore.graph.rootId)
    expect(joinerState.localToRemote.get(joinerStore.graph.rootId)).toBe(hostRootStable)
  })
})
