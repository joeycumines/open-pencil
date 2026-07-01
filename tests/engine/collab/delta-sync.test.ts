import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { createTestStore, createTestYjsSync, makeHostRootState } from './helpers'

describe('delta-based collab property sync', () => {
  test('live node sync writes only changed Yjs properties', () => {
    const store = createTestStore()
    const page = store.graph.getPages()[0]
    const rect = store.graph.createNode('RECTANGLE', page.id, {
      name: 'Delta tracked',
      x: 0,
      y: 0,
      width: 100,
      height: 50
    })
    const ydoc = new Y.Doc()
    const sync = createTestYjsSync(store, ydoc)
    makeHostRootState(store)
    sync.syncAllNodesToYjs()

    const remoteId = store.graph.getSyncState().localToRemote.get(rect.id)
    expect(remoteId).toBeDefined()
    if (remoteId === undefined) return
    const ynode = sync.ynodes.get(remoteId)
    expect(ynode).toBeDefined()
    if (ynode === undefined) return

    const changedKeys: string[][] = []
    ynode.observe((event) => {
      changedKeys.push([...event.changes.keys.keys()].sort())
    })

    store.graph.updateNode(rect.id, { x: 42, y: 9 })
    sync.syncNodeToYjs(rect.id, { x: 42, y: 9 })
    expect(changedKeys).toEqual([['x', 'y']])

    changedKeys.length = 0
    sync.syncNodeToYjs(rect.id)
    expect(changedKeys).toEqual([])

    store.graph.updateNode(rect.id, { y: 10 })
    sync.syncNodeToYjs(rect.id, { y: 10 })
    expect(changedKeys).toEqual([['y']])
  })
})
