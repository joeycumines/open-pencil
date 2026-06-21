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

/**
 * C-03: Layer reordering never syncs — childIds excluded from Yjs sync.
 *
 * childIds is in EXCLUDED_SYNC_KEYS, so the parent's childIds array is never
 * sent over Yjs. When the host reorders children, the node:reordered event
 * triggers syncNodeToYjs for the child, but the child's properties haven't
 * changed (only the parent's childIds order changed). The joiner never
 * receives the new ordering.
 *
 * How it fails: Host creates frame with 3 children [A, B, C], reorders to
 * [C, A, B]. After sync, the joiner's frame still has [A, B, C].
 *
 * Fix that makes it pass: Sync child ordering via a separate Yjs structure
 * (Y.Map<Y.Array<string>> keyed by parent stable ID) or include childIds
 * in the sync (as stable IDs).
 */
describe('C-03: Layer reordering not synced to joiner', () => {
  test('host reorders children, joiner should see new order', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)

    // Create a frame with 3 children
    const frame = hostStore.graph.createNode('FRAME', hostPage, {
      name: 'Frame',
      width: 300,
      height: 100
    })
    const childA = hostStore.graph.createNode('RECTANGLE', frame.id, {
      name: 'A',
      width: 50,
      height: 50
    })
    const childB = hostStore.graph.createNode('RECTANGLE', frame.id, {
      name: 'B',
      x: 100,
      width: 50,
      height: 50
    })
    const childC = hostStore.graph.createNode('RECTANGLE', frame.id, {
      name: 'C',
      x: 200,
      width: 50,
      height: 50
    })

    // Verify initial order [A, B, C]
    const hostFrame = hostStore.graph.getNode(frame.id)!
    expect(hostFrame.childIds).toEqual([childA.id, childB.id, childC.id])

    // Setup collab
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    // Joiner
    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    // Initial sync
    encodeAndApply(hostYdoc, joinerYdoc)

    // Verify joiner has all children
    const joinerFrame = joinerStore.graph.getNode(frame.source.id ?? frame.id)
    expect(joinerFrame).toBeDefined()
    if (!joinerFrame) return
    expect(joinerFrame.childIds.length).toBe(3)

    // Host reorders: move C to front [C, A, B]
    hostStore.graph.reorderChild(childC.id, frame.id, 0)

    // Manually sync the parent (simulates what bindCollabGraphEvents would do)
    hostSync.syncNodeToYjs(frame.id)

    // Sync the change
    encodeAndApply(hostYdoc, joinerYdoc)

    // Joiner should see [C, A, B]
    const joinerFrameAfter = joinerStore.graph.getNode(frame.source.id ?? frame.id)!
    const joinerChildNames = joinerFrameAfter.childIds.map(
      (id) => joinerStore.graph.getNode(id)?.name
    )
    expect(joinerChildNames).toEqual(['C', 'A', 'B']) // FAILS: still [A, B, C]
  })
})
