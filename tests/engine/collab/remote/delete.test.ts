import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { bindCollabGraphEvents } from '@/app/collab/yjs-sync'

import {
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '#tests/engine/collab/helpers'
import { firstPageId } from '#tests/helpers/scene'

describe('remote delete', () => {
  test('remote delete removes the correct local node', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const hostA = hostStore.graph.createNode('RECTANGLE', hostPage, { name: 'A' })
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

    const joinerState = joinerStore.graph.getSyncState()
    expect(joinerStore.graph.getNode(aStable)).toBeDefined()
    expect(joinerStore.graph.getNode(bStable)).toBeDefined()

    hostSync.ynodes.delete(aStable)
    encodeAndApply(hostYdoc, joinerYdoc)

    expect(joinerStore.graph.getNode(aStable)).toBeUndefined()
    expect(joinerStore.graph.getNode(bStable)).toBeDefined()
    expect(joinerState.remoteToLocal.has(aStable)).toBe(false)
    expect(joinerState.pendingUntilRoot.has(aStable)).toBe(false)
    expect(joinerState.pendingParents.has(aStable)).toBe(false)
  })

  test('local delete propagates to remote and reaches joiner without manual map seeding', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const hostA = hostStore.graph.createNode('RECTANGLE', hostPage, { name: 'A' })
    const hostB = hostStore.graph.createNode('RECTANGLE', hostPage, { name: 'B' })
    const aStable = hostA.source.id
    const aRuntime = hostA.id

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    // THE FIX: the outbound sync path (syncAllNodesToYjs) now records the
    // local<->remote mapping for non-root nodes. Previously this mapping was never
    // backfilled, so the node:deleted handler could not resolve the remote key and
    // local deletes never propagated. No manual seeding here.
    const hostState = hostStore.graph.getSyncState()
    expect(hostState.localToRemote.has(aRuntime)).toBe(true)
    expect(hostState.remoteToLocal.has(aStable)).toBe(true)
    expect(hostState.localToRemote.get(aRuntime)).toBe(aStable)
    expect(hostSync.ynodes.has(aStable)).toBe(true)

    // Wire the REAL graph-event bridge so graph.deleteNode propagates to Yjs
    // through production code (not a manual simulation).
    const suppressGraphSync = false
    const unbind = bindCollabGraphEvents({
      store: hostStore,
      getYdoc: () => hostYdoc,
      getYnodes: () => hostSync.ynodes,
      getSuppressGraphSync: () => suppressGraphSync,
      setSuppressYjsEvents: hostSync.setSuppressYjsEvents,
      syncNodeToYjs: hostSync.syncNodeToYjs
    })

    // Seed pending queues keyed by aStable to verify the delete handler cleans them.
    hostState.pendingParents.set(aStable, new Set(['child']))
    hostState.pendingComponents.set(aStable, new Set(['inst']))
    hostState.pendingOverrideKeys.set(
      aStable,
      new Set([{ remoteStableId: 'r', prop: 'x', value: 1 }])
    )
    hostState.pendingUntilRoot.add(aStable)

    // Joiner receives A and B.
    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getNode(aStable)).toBeDefined()

    // Host deletes A locally -> node:deleted handler resolves aStable via
    // localToRemote (now populated) and removes the remote Yjs key + pending queues.
    hostStore.graph.deleteNode(aRuntime, { permanent: true })

    expect(hostSync.ynodes.has(aStable)).toBe(false)
    expect(hostState.localToRemote.has(aRuntime)).toBe(false)
    expect(hostState.remoteToLocal.has(aStable)).toBe(false)
    expect(hostState.pendingParents.has(aStable)).toBe(false)
    expect(hostState.pendingComponents.has(aStable)).toBe(false)
    expect(hostState.pendingOverrideKeys.has(aStable)).toBe(false)
    expect(hostState.pendingUntilRoot.has(aStable)).toBe(false)

    // Joiner receives the deletion and removes its copy of A, keeping B.
    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getNode(aStable)).toBeUndefined()
    expect(joinerStore.graph.getNode(hostB.source.id)).toBeDefined()

    unbind()
  })

  test('deleting an instance cleans up pending overrides keyed by its unresolved children', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)

    const instance = hostStore.graph.createNode('INSTANCE', hostPage, { name: 'Instance' })
    const instanceStable = instance.source.id
    const instanceRuntime = instance.id

    // A child stable id that has NOT arrived locally — simulates the case
    // where the instance arrived with overrides for a child whose ynode
    // was never received.
    const childStable = 'unresolved-child-stable-id'

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const hostState = hostStore.graph.getSyncState()
    expect(hostState.localToRemote.has(instanceRuntime)).toBe(true)

    const suppressGraphSync = false
    const unbind = bindCollabGraphEvents({
      store: hostStore,
      getYdoc: () => hostYdoc,
      getYnodes: () => hostSync.ynodes,
      getSuppressGraphSync: () => suppressGraphSync,
      setSuppressYjsEvents: hostSync.setSuppressYjsEvents,
      syncNodeToYjs: hostSync.syncNodeToYjs
    })

    // Seed pending overrides keyed by the CHILD's stable id, with entries
    // referencing the INSTANCE's stable id as the owning instance. This is
    // the structure created by remapOverridesToLocal when an instance arrives
    // before its overridden child.
    hostState.pendingOverrideKeys.set(
      childStable,
      new Set([
        { remoteStableId: instanceStable, prop: 'x', value: 42 },
        { remoteStableId: instanceStable, prop: 'y', value: 99 }
      ])
    )

    // Delete the instance — removeFromPendingQueues must scan
    // pendingOverrideKeys for entries referencing the instance and remove them.
    // Pre-fix: pendingOverrideKeys[childStable] would retain both entries
    // (the existing `pendingOverrideKeys.delete(instanceStable)` is a no-op
    // because the key is childStable, not instanceStable).
    hostStore.graph.deleteNode(instanceRuntime, { permanent: true })

    expect(hostSync.ynodes.has(instanceStable)).toBe(false)
    expect(hostState.localToRemote.has(instanceRuntime)).toBe(false)
    expect(hostState.pendingOverrideKeys.has(childStable)).toBe(false)

    unbind()
  })
})
