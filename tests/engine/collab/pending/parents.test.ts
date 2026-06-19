import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  cloneYnode,
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '#tests/engine/collab/helpers'

describe('pending parents', () => {
  test('child arrives before parent then materializes when parent arrives', () => {
    const hostStore = createTestStore()
    const parent = hostStore.graph.createNode('FRAME', hostStore.graph.rootId, { name: 'Parent' })
    const child = hostStore.graph.createNode('RECTANGLE', parent.id, { name: 'Child' })
    const parentStable = parent.source.id
    const childStable = child.source.id

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncNodeToYjs(hostStore.graph.rootId)

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    // Reconcile the root first.
    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    // Apply only the child; its parent has not arrived yet.
    hostSync.syncNodeToYjs(child.id)
    const hostChildYnode = hostSync.ynodes.get(childStable)
    expect(hostChildYnode).toBeDefined()
    cloneYnode(hostChildYnode, joinerSync.ynodes, childStable)

    const joinerState = joinerStore.graph.getSyncState()
    expect([...(joinerState.pendingParents.get(parentStable) ?? [])]).toContain(childStable)
    expect(joinerStore.graph.getNode(childStable)).toBeUndefined()

    // Apply the parent; the queued child should materialize under it.
    hostSync.syncNodeToYjs(parent.id)
    const hostParentYnode = hostSync.ynodes.get(parentStable)
    expect(hostParentYnode).toBeDefined()
    cloneYnode(hostParentYnode, joinerSync.ynodes, parentStable)

    expect(joinerState.pendingParents.get(parentStable)).toBeUndefined()
    const localParentId = joinerState.remoteToLocal.get(parentStable)
    expect(localParentId).toBeDefined()
    expect(joinerStore.graph.getNode(childStable)).toBeDefined()
    expect(joinerStore.graph.getNode(childStable).parentId).toBe(localParentId)
  })
})
