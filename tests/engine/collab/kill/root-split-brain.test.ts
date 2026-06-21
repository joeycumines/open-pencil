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

/**
 * C-02: Root split-brain when two peers both call shareCurrentDoc.
 *
 * When two peers both call shareCurrentDoc(), both set state.rootMapped = true.
 * When the remote root arrives, reconcileRemoteRoot has an early return:
 * `if (state.rootMapped) return`. Neither peer adopts the other's root.
 *
 * How it fails: After two-way sync, both peers still have their original
 * root names — they have NOT converged.
 *
 * Fix that makes it pass: Replace the early return with a yield decision:
 * the peer with the lexicographically larger root stable ID yields and
 * adopts the winner's root properties.
 */
describe('C-02: Root split-brain when two peers both share', () => {
  test('two peers sharing docs should converge on same root name after two-way sync', () => {
    // Peer A (host)
    const hostAStore = createTestStore()
    const hostAPage = firstPageId(hostAStore.graph)
    hostAStore.graph.createNode('RECTANGLE', hostAPage, { name: 'A rect' })
    const rootA = hostAStore.graph.getNode(hostAStore.graph.rootId)
    if (rootA) rootA.name = 'Document A'

    const hostAYdoc = new Y.Doc()
    const hostASync = createTestYjsSync(hostAStore, hostAYdoc)
    makeHostRootState(hostAStore)
    hostASync.syncAllNodesToYjs()

    // Peer B (also host — calls shareCurrentDoc)
    const hostBStore = createTestStore()
    const hostBPage = firstPageId(hostBStore.graph)
    hostBStore.graph.createNode('RECTANGLE', hostBPage, { name: 'B rect' })
    const rootB = hostBStore.graph.getNode(hostBStore.graph.rootId)
    if (rootB) rootB.name = 'Document B'

    const hostBYdoc = new Y.Doc()
    const hostBSync = createTestYjsSync(hostBStore, hostBYdoc)
    makeHostRootState(hostBStore)
    hostBSync.syncAllNodesToYjs()

    // Both peers have rootMapped = true
    expect(hostAStore.graph.getSyncState().rootMapped).toBe(true)
    expect(hostBStore.graph.getSyncState().rootMapped).toBe(true)

    // Peer B observes Peer A's Yjs doc
    observeTargetDoc(hostBStore, hostBYdoc, hostBSync.applyYjsToGraph, hostBSync.reconcileRoot)

    // Peer A observes Peer B's Yjs doc
    observeTargetDoc(hostAStore, hostAYdoc, hostASync.applyYjsToGraph, hostASync.reconcileRoot)

    // Two-way sync: A→B then B→A
    encodeAndApply(hostAYdoc, hostBYdoc)
    encodeAndApply(hostBYdoc, hostAYdoc)

    // Both peers should have converged on the same root name
    const aRootName = hostAStore.graph.getNode(hostAStore.graph.rootId)?.name
    const bRootName = hostBStore.graph.getNode(hostBStore.graph.rootId)?.name

    // With the bug: both keep their own root name (divergent)
    // With the fix: they converge on the winner's root name
    expect(aRootName).toBe(bRootName) // FAILS: 'Document A' !== 'Document B'
  })
})
