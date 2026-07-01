import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { createTestStore, createTestYjsSync, makeHostRootState } from './helpers'
import { bindHostGraphEvents, ymapRecordValue } from './pending/helpers'

describe('collab clone override sync', () => {
  test('cloneTree emits remapped INSTANCE overrides after clone children exist', () => {
    const store = createTestStore()
    const page = store.graph.getPages()[0]
    const component = store.graph.createNode('COMPONENT', page.id, {
      name: 'Button',
      width: 100,
      height: 40
    })
    store.graph.createNode('RECTANGLE', component.id, { name: 'Bg', width: 100, height: 40 })
    const instance = store.graph.createInstance(component.id, page.id)
    if (!instance) throw new Error('instance failed')
    const instanceChild = store.graph.getChildren(instance.id)[0]
    const sourceChildStableId = store.graph.identity.getStableId(instanceChild)
    store.graph.updateNode(instanceChild.id, { width: 140 })
    instance.overrides[`${sourceChildStableId}:width`] = 140

    const ydoc = new Y.Doc()
    const sync = createTestYjsSync(store, ydoc)
    makeHostRootState(store)
    sync.syncAllNodesToYjs()
    const unbind = bindHostGraphEvents(store, ydoc, sync)

    const clone = store.graph.cloneTree(instance.id, page.id)
    if (!clone) throw new Error('clone failed')
    unbind()

    const clonedChild = store.graph.getChildren(clone.id)[0]
    const clonedChildStableId = store.graph.identity.getStableId(clonedChild)
    const cloneRemoteId = store.graph.getSyncState().localToRemote.get(clone.id)
    const remoteOverrides = ymapRecordValue(sync.ynodes.get(cloneRemoteId), 'overrides')

    expect(clone.overrides).toEqual({ [`${clonedChildStableId}:width`]: 140 })
    expect(remoteOverrides).toEqual({ [`${clonedChildStableId}:width`]: 140 })
    expect(remoteOverrides?.[`${sourceChildStableId}:width`]).toBeUndefined()
  })
})
