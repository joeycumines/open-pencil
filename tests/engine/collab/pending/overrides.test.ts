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

describe('pending overrides', () => {
  test('instance override arrives before referenced child then resolves when child arrives', () => {
    const hostStore = createTestStore()

    const child = hostStore.graph.createNode('RECTANGLE', hostStore.graph.rootId, { name: 'Child' })
    const childStable = child.source.id

    const instance = hostStore.graph.createNode('INSTANCE', hostStore.graph.rootId, {
      name: 'Instance',
      overrides: { [`${childStable}:x`]: 42 }
    })
    const instanceStable = instance.source.id

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncNodeToYjs(hostStore.graph.rootId)

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    hostSync.syncNodeToYjs(instance.id)
    cloneYnode(hostSync.ynodes.get(instanceStable), joinerSync.ynodes, instanceStable)

    const joinerState = joinerStore.graph.getSyncState()
    expect(
      [...(joinerState.pendingOverrideKeys.get(childStable) ?? [])].some(
        (entry) =>
          entry.remoteStableId === instanceStable && entry.prop === 'x' && entry.value === 42
      )
    ).toBe(true)

    hostSync.syncNodeToYjs(child.id)
    cloneYnode(hostSync.ynodes.get(childStable), joinerSync.ynodes, childStable)

    expect(joinerState.pendingOverrideKeys.get(childStable)).toBeUndefined()

    const joinerInstance = joinerStore.graph.getNode(instanceStable)
    expect(joinerInstance).toBeDefined()
    const joinerChild = joinerStore.graph.getNode(childStable)
    expect(joinerChild).toBeDefined()

    expect(joinerInstance.overrides[`${childStable}:x`]).toBe(42)
  })

  test('multiple pending overrides for one instance all resolve without clobbering', () => {
    const hostStore = createTestStore()

    const child = hostStore.graph.createNode('RECTANGLE', hostStore.graph.rootId, { name: 'Child' })
    const childStable = child.source.id

    const instance = hostStore.graph.createNode('INSTANCE', hostStore.graph.rootId, {
      name: 'Instance',
      overrides: {
        [`${childStable}:x`]: 11,
        [`${childStable}:y`]: 22,
        [`${childStable}:visible`]: false
      }
    })
    const instanceStable = instance.source.id

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncNodeToYjs(hostStore.graph.rootId)

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    // Instance arrives before the child -> all three override keys are queued.
    hostSync.syncNodeToYjs(instance.id)
    cloneYnode(hostSync.ynodes.get(instanceStable), joinerSync.ynodes, instanceStable)

    const joinerState = joinerStore.graph.getSyncState()
    expect(joinerState.pendingOverrideKeys.get(childStable)?.size).toBe(3)

    // Child arrives -> pending release must MERGE all three keys, not keep only the last.
    hostSync.syncNodeToYjs(child.id)
    cloneYnode(hostSync.ynodes.get(childStable), joinerSync.ynodes, childStable)

    expect(joinerState.pendingOverrideKeys.get(childStable)).toBeUndefined()

    const joinerInstance = joinerStore.graph.getNode(instanceStable)
    const joinerChild = joinerStore.graph.getNode(childStable)
    if (joinerInstance === undefined || joinerChild === undefined) {
      throw new Error('joiner instance or child missing after release')
    }
    expect(joinerInstance.overrides[`${childStable}:x`]).toBe(11)
    expect(joinerInstance.overrides[`${childStable}:y`]).toBe(22)
    expect(joinerInstance.overrides[`${childStable}:visible`]).toBe(false)
  })

  test('pending override release preserves already-resolved overrides on the instance', () => {
    const hostStore = createTestStore()

    const childA = hostStore.graph.createNode('RECTANGLE', hostStore.graph.rootId, {
      name: 'ChildA'
    })
    const childB = hostStore.graph.createNode('RECTANGLE', hostStore.graph.rootId, {
      name: 'ChildB'
    })
    const childAStable = childA.source.id
    const childBStable = childB.source.id

    const instance = hostStore.graph.createNode('INSTANCE', hostStore.graph.rootId, {
      name: 'Instance',
      overrides: {
        [`${childAStable}:x`]: 1,
        [`${childBStable}:y`]: 2
      }
    })
    const instanceStable = instance.source.id

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncNodeToYjs(hostStore.graph.rootId)

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    // childB arrives first -> its override resolves immediately when the instance lands.
    hostSync.syncNodeToYjs(childB.id)
    cloneYnode(hostSync.ynodes.get(childBStable), joinerSync.ynodes, childBStable)

    // Instance arrives: childB resolves into node.overrides, childA is still missing
    // -> queued. Pre-fix this state was correct; the bug is on release.
    hostSync.syncNodeToYjs(instance.id)
    cloneYnode(hostSync.ynodes.get(instanceStable), joinerSync.ynodes, instanceStable)

    const joinerState = joinerStore.graph.getSyncState()
    const joinerInstanceBefore = joinerStore.graph.getNode(instanceStable)
    const joinerChildB = joinerStore.graph.getNode(childBStable)
    if (joinerInstanceBefore === undefined || joinerChildB === undefined) {
      throw new Error('joiner instance/childB missing before release')
    }
    expect(joinerInstanceBefore.overrides[`${childBStable}:y`]).toBe(2)
    expect(joinerState.pendingOverrideKeys.get(childAStable)?.size).toBe(1)

    // childA arrives -> release must MERGE childA:x into the existing overrides
    // (which already contain childB:y). Pre-fix the release replaced node.overrides
    // with only { childA:x }, destroying childB:y.
    hostSync.syncNodeToYjs(childA.id)
    cloneYnode(hostSync.ynodes.get(childAStable), joinerSync.ynodes, childAStable)

    expect(joinerState.pendingOverrideKeys.get(childAStable)).toBeUndefined()

    const joinerInstance = joinerStore.graph.getNode(instanceStable)
    const joinerChildA = joinerStore.graph.getNode(childAStable)
    if (joinerInstance === undefined || joinerChildA === undefined || joinerChildB === undefined) {
      throw new Error('joiner nodes missing after release')
    }
    expect(joinerInstance.overrides[`${childAStable}:x`]).toBe(1)
    expect(joinerInstance.overrides[`${childBStable}:y`]).toBe(2)
  })
})
