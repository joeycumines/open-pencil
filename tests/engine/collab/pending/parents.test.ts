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

  test('parent child order waits for children that arrive later', () => {
    const hostStore = createTestStore()
    const parent = hostStore.graph.createNode('FRAME', hostStore.graph.rootId, { name: 'Parent' })
    const first = hostStore.graph.createNode('RECTANGLE', parent.id, { name: 'First' })
    const second = hostStore.graph.createNode('RECTANGLE', parent.id, { name: 'Second' })
    const parentStable = parent.source.id
    const firstStable = first.source.id
    const secondStable = second.source.id

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncNodeToYjs(hostStore.graph.rootId)

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)

    hostSync.syncNodeToYjs(parent.id)
    cloneYnode(hostSync.ynodes.get(parentStable), joinerSync.ynodes, parentStable)

    const joinerState = joinerStore.graph.getSyncState()
    expect(joinerState.pendingChildOrders.get(parentStable)).toEqual([firstStable, secondStable])

    hostSync.syncNodeToYjs(second.id)
    cloneYnode(hostSync.ynodes.get(secondStable), joinerSync.ynodes, secondStable)
    expect(joinerState.pendingChildOrders.get(parentStable)).toEqual([firstStable, secondStable])

    hostSync.syncNodeToYjs(first.id)
    cloneYnode(hostSync.ynodes.get(firstStable), joinerSync.ynodes, firstStable)

    const localParentId = joinerState.remoteToLocal.get(parentStable)
    expect(localParentId).toBeDefined()
    if (localParentId === undefined) return
    const localParent = joinerStore.graph.getNode(localParentId)
    const orderedNames = localParent?.childIds.map((id) => joinerStore.graph.getNode(id)?.name)
    expect(orderedNames).toEqual(['First', 'Second'])
    expect(joinerState.pendingChildOrders.has(parentStable)).toBe(false)
  })

  test('parent child order waits for mapped children that reparent later', () => {
    const hostStore = createTestStore()
    const page = hostStore.graph.getPages()[0]
    if (page === undefined) throw new Error('test graph has no page')
    const parent = hostStore.graph.createNode('FRAME', page.id, { name: 'Parent' })
    const first = hostStore.graph.createNode('RECTANGLE', parent.id, { name: 'First' })
    const second = hostStore.graph.createNode('RECTANGLE', page.id, { name: 'Second' })
    const parentStable = parent.source.id
    const firstStable = first.source.id
    const secondStable = second.source.id

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)

    const joinerState = joinerStore.graph.getSyncState()
    const localParentId = joinerState.remoteToLocal.get(parentStable)
    expect(localParentId).toBeDefined()
    if (localParentId === undefined) return
    const localSecondId = joinerState.remoteToLocal.get(secondStable)
    expect(localSecondId).toBeDefined()
    expect(joinerStore.graph.getNode(localSecondId)?.parentId).not.toBe(localParentId)

    hostStore.graph.reparentNode(second.id, parent.id)
    hostStore.graph.reorderChild(second.id, parent.id, 0)
    hostSync.syncNodeToYjs(parent.id)
    hostSync.syncNodeToYjs(second.id)

    cloneYnode(hostSync.ynodes.get(parentStable), joinerSync.ynodes, parentStable)
    expect(joinerState.pendingChildOrders.get(parentStable)).toEqual([secondStable, firstStable])

    cloneYnode(hostSync.ynodes.get(secondStable), joinerSync.ynodes, secondStable)

    const localParent = joinerStore.graph.getNode(localParentId)
    const orderedNames = localParent?.childIds.map((id) => joinerStore.graph.getNode(id)?.name)
    expect(orderedNames).toEqual(['Second', 'First'])
    expect(joinerState.pendingChildOrders.has(parentStable)).toBe(false)
  })

  test('parent child order drains after an omitted child is deleted later', () => {
    const hostStore = createTestStore()
    const page = hostStore.graph.getPages()[0]
    if (page === undefined) throw new Error('test graph has no page')
    const parent = hostStore.graph.createNode('FRAME', page.id, { name: 'Parent' })
    const first = hostStore.graph.createNode('RECTANGLE', parent.id, { name: 'First' })
    const second = hostStore.graph.createNode('RECTANGLE', parent.id, { name: 'Second' })
    const parentStable = parent.source.id
    const firstStable = first.source.id
    const secondStable = second.source.id

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)

    const joinerState = joinerStore.graph.getSyncState()
    const localParentId = joinerState.remoteToLocal.get(parentStable)
    const localSecondId = joinerState.remoteToLocal.get(secondStable)
    expect(localParentId).toBeDefined()
    expect(localSecondId).toBeDefined()
    if (localParentId === undefined || localSecondId === undefined) return

    hostStore.graph.deleteNode(second.id, { permanent: true })
    hostSync.syncNodeToYjs(parent.id)
    cloneYnode(hostSync.ynodes.get(parentStable), joinerSync.ynodes, parentStable)
    expect(joinerState.pendingChildOrders.get(parentStable)).toEqual([firstStable])

    joinerYdoc.transact(() => {
      joinerSync.ynodes.delete(secondStable)
    })

    const localParent = joinerStore.graph.getNode(localParentId)
    const orderedNames = localParent?.childIds.map((id) => joinerStore.graph.getNode(id)?.name)
    expect(orderedNames).toEqual(['First'])
    expect(joinerStore.graph.getNode(localSecondId)).toBeUndefined()
    expect(joinerState.pendingChildOrders.has(parentStable)).toBe(false)
  })
})
