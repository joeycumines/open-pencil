import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { SceneGraph } from '@open-pencil/scene-graph'

import { registerYjsObservers } from '@/app/collab/yjs-sync'

import {
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc,
  type TestStore
} from '#tests/engine/collab/helpers'
import { firstPageId } from '#tests/helpers/scene'

type TestYjsSync = ReturnType<typeof createTestYjsSync>

function createSharingPeer(rootName: string, rectName: string, sessionID: number) {
  const store = createTestStore(new SceneGraph({ sessionID }))
  const pageId = firstPageId(store.graph)
  store.graph.createNode('RECTANGLE', pageId, { name: rectName })
  const root = store.graph.getNode(store.graph.rootId)
  if (root) root.name = rootName

  const ydoc = new Y.Doc()
  const sync = createTestYjsSync(store, ydoc)
  makeHostRootState(store)
  sync.syncAllNodesToYjs()

  return { store, ydoc, sync }
}

function rootStableIdsInYdoc(ydoc: Y.Doc): string[] {
  const ynodes = ydoc.getMap<Y.Map<unknown>>('nodes')
  return [...ynodes.entries()]
    .filter(([stableId, ynode]) => ynode.get('parentId') === stableId)
    .map(([stableId]) => stableId)
}

function observeTargetDocWithProductionObserver(
  store: TestStore,
  ydoc: Y.Doc,
  sync: TestYjsSync
): void {
  registerYjsObservers({
    store,
    ynodes: ydoc.getMap('nodes'),
    yimages: ydoc.getMap('images'),
    yvariables: ydoc.getMap('variables'),
    ycollections: ydoc.getMap('collections'),
    getSuppressYjsEvents: sync.getSuppressYjsEvents,
    setSuppressGraphSync: () => {
      /* Graph-event binding is not installed in this isolated observer test. */
    },
    applyYjsToGraph: sync.applyYjsToGraph,
    reconcileRemoteRoot: sync.reconcileRoot
  })
}

function expectConvergedRootNames(hostAStore: TestStore, hostBStore: TestStore): void {
  const aRootName = hostAStore.graph.getNode(hostAStore.graph.rootId)?.name
  const bRootName = hostBStore.graph.getNode(hostBStore.graph.rootId)?.name
  expect(aRootName).toBe(bRootName)
}

function expectOnlyWinningRect(store: TestStore): void {
  const names = [...store.graph.getAllNodes()].map((node) => node.name)
  expect(names).toContain('A rect')
  expect(names).not.toContain('B rect')
}

/**
 * C-02: Root split-brain when two peers both call shareCurrentDoc.
 *
 * When two peers both call shareCurrentDoc(), both set state.rootMapped = true.
 * When the production observer ignores later root candidates because
 * `remoteRootStableId` is already set, reconcileRemoteRoot is never reached.
 *
 * How it fails: After two-way sync, both peers still have their original
 * root names — they have NOT converged.
 *
 * Fix that makes it pass: production observers must send differing root
 * candidates into reconcileRemoteRoot, whose yield decision makes the peer with
 * the lexicographically larger root stable ID adopt the winner's root.
 */
describe('C-02: Root split-brain when two peers both share', () => {
  test('two peers sharing docs should converge on same root name after two-way sync', () => {
    const {
      store: hostAStore,
      ydoc: hostAYdoc,
      sync: hostASync
    } = createSharingPeer('Document A', 'A rect', 10)
    const {
      store: hostBStore,
      ydoc: hostBYdoc,
      sync: hostBSync
    } = createSharingPeer('Document B', 'B rect', 20)

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
    // With the bug: both keep their own root name (divergent)
    // With the fix: they converge on the winner's root name
    expectConvergedRootNames(hostAStore, hostBStore)
    expectOnlyWinningRect(hostAStore)
    expectOnlyWinningRect(hostBStore)
  })

  test('production observer reaches root reconciliation after local root is already mapped', () => {
    const {
      store: hostAStore,
      ydoc: hostAYdoc,
      sync: hostASync
    } = createSharingPeer('Document A', 'A rect', 10)
    const {
      store: hostBStore,
      ydoc: hostBYdoc,
      sync: hostBSync
    } = createSharingPeer('Document B', 'B rect', 20)

    expect(hostAStore.graph.getSyncState().remoteRootStableId).not.toBeNull()
    expect(hostBStore.graph.getSyncState().remoteRootStableId).not.toBeNull()

    observeTargetDocWithProductionObserver(hostBStore, hostBYdoc, hostBSync)
    observeTargetDocWithProductionObserver(hostAStore, hostAYdoc, hostASync)

    encodeAndApply(hostAYdoc, hostBYdoc)
    encodeAndApply(hostBYdoc, hostAYdoc)

    expectConvergedRootNames(hostAStore, hostBStore)
    expectOnlyWinningRect(hostAStore)
    expectOnlyWinningRect(hostBStore)
  })

  test('late joiner ignores abandoned root candidates retained in a converged Yjs doc', () => {
    const {
      store: hostAStore,
      ydoc: hostAYdoc,
      sync: hostASync
    } = createSharingPeer('Document A', 'A rect', 10)
    const {
      store: hostBStore,
      ydoc: hostBYdoc,
      sync: hostBSync
    } = createSharingPeer('Document B', 'B rect', 20)

    observeTargetDocWithProductionObserver(hostBStore, hostBYdoc, hostBSync)
    observeTargetDocWithProductionObserver(hostAStore, hostAYdoc, hostASync)

    encodeAndApply(hostAYdoc, hostBYdoc)
    encodeAndApply(hostBYdoc, hostAYdoc)

    expectConvergedRootNames(hostAStore, hostBStore)
    expectOnlyWinningRect(hostAStore)
    expectOnlyWinningRect(hostBStore)
    expect(rootStableIdsInYdoc(hostBYdoc)).toEqual(['20:1', '10:1'])

    const joinerStore = createTestStore(new SceneGraph({ sessionID: 30 }))
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDocWithProductionObserver(joinerStore, joinerYdoc, joinerSync)

    encodeAndApply(hostBYdoc, joinerYdoc)

    const joinerState = joinerStore.graph.getSyncState()
    expect(joinerState.remoteRootStableId).toBe('10:1')
    expect(joinerStore.graph.getNode(joinerStore.graph.rootId)?.name).toBe('Document A')
    expectOnlyWinningRect(joinerStore)
    expect(joinerState.pendingParents.has('20:1')).toBe(false)
  })
})
