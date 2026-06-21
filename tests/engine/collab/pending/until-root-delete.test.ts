import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { registerYjsObservers, type ReconcileRootFn } from '@/app/collab/yjs-sync'

import { createTestStore, createTestYjsSync } from '#tests/engine/collab/helpers'

describe('pendingUntilRoot cleanup', () => {
  test('remote delete removes a non-root ynode buffered before root mapping', () => {
    const store = createTestStore()
    const ydoc = new Y.Doc()
    const ynodes = ydoc.getMap<Y.Map<unknown>>('nodes')
    const yimages = ydoc.getMap<Uint8Array>('images')
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const sync = createTestYjsSync(store, ydoc)

    registerYjsObservers({
      store,
      ynodes,
      yimages,
      yvariables,
      ycollections,
      getSuppressYjsEvents: sync.getSuppressYjsEvents,
      setSuppressGraphSync: () => {
        /* no-op: graph sync suppression is not needed for this test */
      },
      applyYjsToGraph: sync.applyYjsToGraph,
      reconcileRemoteRoot: undefined as ReconcileRootFn | undefined
    })

    const ynode = new Y.Map<unknown>()
    ynode.set('id', 'r:X')
    ynode.set('type', 'RECTANGLE')
    ynode.set('name', 'Buffered')
    ynode.set('parentId', 'r:Parent')

    ydoc.transact(() => {
      ynodes.set('r:X', ynode)
    })

    const state = store.graph.getSyncState()
    expect(state.pendingUntilRoot.has('r:X')).toBe(true)

    ydoc.transact(() => {
      ynodes.delete('r:X')
    })

    expect(state.pendingUntilRoot.has('r:X')).toBe(false)
    expect(state.remoteToLocal.has('r:X')).toBe(false)
    expect(store.graph.getNode('r:X')).toBeUndefined()
  })
})
