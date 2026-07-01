import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  bindCollabGraphEvents,
  findInstanceDescendantByStableId,
  originalStableIdFromRemoteNodeKey
} from '@/app/collab/yjs-sync'

import {
  cloneYnode,
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  type TestStore
} from '#tests/engine/collab/helpers'
import { firstPageId } from '#tests/helpers/scene'

import {
  bindHostGraphEvents,
  createNestedInstanceFixture,
  localNodeForStableId,
  observeJoiner
} from './helpers'

function createComponentInstance(store: TestStore) {
  const pageId = firstPageId(store.graph)
  const component = store.graph.createNode('COMPONENT', pageId, {
    name: 'Card',
    width: 120,
    height: 80
  })
  const instance = store.graph.createInstance(component.id, pageId, {
    name: 'Card Instance'
  })
  if (instance === null) throw new Error('expected createInstance to return an instance')
  return { component, instance }
}

function createComponentInstanceWithSlot(store: TestStore) {
  const pageId = firstPageId(store.graph)
  const component = store.graph.createNode('COMPONENT', pageId, {
    name: 'Panel',
    width: 160,
    height: 120
  })
  const componentSlot = store.graph.createNode('FRAME', component.id, {
    name: 'Slot',
    width: 80,
    height: 40
  })
  const instance = store.graph.createInstance(component.id, pageId, {
    name: 'Panel Instance'
  })
  if (instance === null) throw new Error('expected createInstance to return an instance')
  const instanceSlot = findInstanceDescendantByStableId(
    store.graph,
    instance,
    componentSlot.source.id
  )
  if (instanceSlot === undefined) throw new Error('expected populated instance slot')
  return { component, componentSlot, instance, instanceSlot }
}

function childNamed(store: TestStore, parentId: string | undefined, name: string) {
  if (parentId === undefined) return undefined
  const parent = store.graph.getNode(parentId)
  return parent?.childIds
    .map((childId) => store.graph.getNode(childId))
    .find((child) => child?.name === name)
}

function requireInstance(node: ReturnType<TestStore['graph']['getNode']>, message: string) {
  if (node?.type !== 'INSTANCE') throw new Error(message)
  return node
}

describe('custom children under instances', () => {
  test('existing custom instance children sync as standalone nodes', () => {
    const hostStore = createTestStore()
    const { instance } = createComponentInstance(hostStore)
    const custom = hostStore.graph.createNode('RECTANGLE', instance.id, {
      name: 'Custom Badge',
      width: 16,
      height: 16,
      x: 8
    })
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)

    hostSync.syncAllNodesToYjs()
    expect(hostSync.ynodes.has(custom.source.id)).toBe(true)
    expect(hostSync.ynodes.get(custom.source.id)?.get('parentId')).toBe(instance.source.id)

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerInstance = localNodeForStableId(joiner.store, instance.source.id)
    const joinerCustom = localNodeForStableId(joiner.store, custom.source.id)

    expect(joinerCustom?.parentId).toBe(joinerInstance?.id)
    expect(joinerCustom?.name).toBe('Custom Badge')
    expect(joinerCustom?.x).toBe(8)
  })

  test('live custom instance child creation syncs as a standalone node', () => {
    const hostStore = createTestStore()
    const { instance } = createComponentInstance(hostStore)
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const unbind = bindCollabGraphEvents({
      store: hostStore,
      getYdoc: () => hostYdoc,
      getYnodes: () => hostSync.ynodes,
      getSuppressGraphSync: () => false,
      setSuppressYjsEvents: hostSync.setSuppressYjsEvents,
      syncNodeToYjs: hostSync.syncNodeToYjs,
      syncVariableToYjs: hostSync.syncVariableToYjs,
      syncCollectionToYjs: hostSync.syncCollectionToYjs
    })

    const custom = hostStore.graph.createNode('RECTANGLE', instance.id, {
      name: 'Live Custom Badge',
      width: 20,
      height: 12,
      y: 6
    })
    unbind()
    expect(hostSync.ynodes.has(custom.source.id)).toBe(true)

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerInstance = localNodeForStableId(joiner.store, instance.source.id)
    const joinerCustom = localNodeForStableId(joiner.store, custom.source.id)

    expect(joinerCustom?.parentId).toBe(joinerInstance?.id)
    expect(joinerCustom?.name).toBe('Live Custom Badge')
    expect(joinerCustom?.y).toBe(6)
  })

  test('nested custom children under populated instance descendants keep instance parent', () => {
    const hostStore = createTestStore()
    const { componentSlot, instance, instanceSlot } = createComponentInstanceWithSlot(hostStore)
    const custom = hostStore.graph.createNode('RECTANGLE', instanceSlot.id, {
      name: 'Nested Custom Badge',
      width: 18,
      height: 10,
      x: 4
    })
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)

    hostSync.syncAllNodesToYjs()
    const customYnode = hostSync.ynodes.get(custom.source.id)
    expect(customYnode?.get('parentId')).toBe(componentSlot.source.id)
    expect(customYnode?.get('parentInstanceId')).toBe(instance.source.id)

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerInstance = localNodeForStableId(joiner.store, instance.source.id)
    const joinerComponentSlot = localNodeForStableId(joiner.store, componentSlot.source.id)
    const joinerCustom = localNodeForStableId(joiner.store, custom.source.id)
    expect(joinerInstance).toBeDefined()
    if (joinerInstance === undefined) return
    const joinerInstanceSlot = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerInstance,
      componentSlot.source.id
    )

    expect(joinerCustom?.parentId).toBe(joinerInstanceSlot?.id)
    expect(joinerCustom?.parentId).not.toBe(joinerComponentSlot?.id)
    expect(joinerCustom?.name).toBe('Nested Custom Badge')
    expect(joinerCustom?.x).toBe(4)
    expect(joinerComponentSlot?.childIds).not.toContain(joinerCustom?.id)
  })

  test('custom children under nested populated instance branches keep populated branch parent', () => {
    const hostStore = createTestStore()
    const { innerSlot, nestedComponentInstance, outerInstance, populatedInnerSlot } =
      createNestedInstanceFixture(hostStore)
    const custom = hostStore.graph.createNode('RECTANGLE', populatedInnerSlot.id, {
      name: 'Nested Branch Custom Badge',
      width: 14,
      height: 10,
      x: 6
    })
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)

    hostSync.syncAllNodesToYjs()
    const customYnode = hostSync.ynodes.get(custom.source.id)
    expect(customYnode?.get('parentId')).toBe(innerSlot.source.id)
    expect(customYnode?.get('parentInstanceId')).toBe(outerInstance.source.id)
    expect(customYnode?.get('parentInstancePath')).toEqual([nestedComponentInstance.source.id])

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerOuterInstance = requireInstance(
      localNodeForStableId(joiner.store, outerInstance.source.id),
      'expected outer instance'
    )
    const joinerPopulatedNested = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerOuterInstance,
      nestedComponentInstance.source.id
    )
    const joinerPopulatedNestedInstance = requireInstance(
      joinerPopulatedNested,
      'expected populated nested instance'
    )
    const joinerPopulatedSlot = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerPopulatedNestedInstance,
      innerSlot.source.id
    )
    const joinerBackingNested = requireInstance(
      localNodeForStableId(joiner.store, nestedComponentInstance.source.id),
      'expected backing nested instance'
    )
    const joinerBackingSlot = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerBackingNested,
      innerSlot.source.id
    )
    const joinerCustom = localNodeForStableId(joiner.store, custom.source.id)

    expect(joinerCustom?.parentId).toBe(joinerPopulatedSlot?.id)
    expect(joinerCustom?.parentId).not.toBe(joinerBackingSlot?.id)
    expect(joinerCustom?.name).toBe('Nested Branch Custom Badge')
    expect(joinerCustom?.x).toBe(6)
    expect(joinerBackingSlot?.childIds).not.toContain(joinerCustom?.id)
  })

  test('nested custom children wait for component-backed instance parents', () => {
    const hostStore = createTestStore()
    const hostPageId = firstPageId(hostStore.graph)
    const hostPage = hostStore.graph.getNode(hostPageId)
    if (hostPage === undefined) throw new Error('expected host page')
    const { component, componentSlot, instance, instanceSlot } =
      createComponentInstanceWithSlot(hostStore)
    const custom = hostStore.graph.createNode('RECTANGLE', instanceSlot.id, {
      name: 'Delayed Nested Custom',
      width: 12,
      height: 12
    })
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joiner = observeJoiner()
    cloneYnode(hostSync.ynodes.get(hostRootStable), joiner.sync.ynodes, hostRootStable)
    cloneYnode(hostSync.ynodes.get(hostPage.source.id), joiner.sync.ynodes, hostPage.source.id)
    cloneYnode(hostSync.ynodes.get(component.source.id), joiner.sync.ynodes, component.source.id)
    cloneYnode(hostSync.ynodes.get(instance.source.id), joiner.sync.ynodes, instance.source.id)
    cloneYnode(hostSync.ynodes.get(custom.source.id), joiner.sync.ynodes, custom.source.id)

    const joinerState = joiner.store.graph.getSyncState()
    expect([...(joinerState.pendingParents.get(componentSlot.source.id) ?? [])]).toContain(
      custom.source.id
    )

    cloneYnode(
      hostSync.ynodes.get(componentSlot.source.id),
      joiner.sync.ynodes,
      componentSlot.source.id
    )
    const joinerInstance = localNodeForStableId(joiner.store, instance.source.id)
    const joinerCustom = localNodeForStableId(joiner.store, custom.source.id)
    expect(joinerInstance).toBeDefined()
    if (joinerInstance === undefined) return
    const joinerInstanceSlot = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerInstance,
      componentSlot.source.id
    )

    expect(joinerState.pendingParents.get(componentSlot.source.id)).toBeUndefined()
    expect(joinerCustom?.parentId).toBe(joinerInstanceSlot?.id)
    expect(joinerCustom?.name).toBe('Delayed Nested Custom')
  })

  test('stale instance descendants with deleted backing component children sync standalone', () => {
    const hostStore = createTestStore()
    const { componentSlot, instance, instanceSlot } = createComponentInstanceWithSlot(hostStore)
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const unbind = bindCollabGraphEvents({
      store: hostStore,
      getYdoc: () => hostYdoc,
      getYnodes: () => hostSync.ynodes,
      getSuppressGraphSync: () => false,
      setSuppressYjsEvents: hostSync.setSuppressYjsEvents,
      syncNodeToYjs: hostSync.syncNodeToYjs,
      syncVariableToYjs: hostSync.syncVariableToYjs,
      syncCollectionToYjs: hostSync.syncCollectionToYjs
    })

    hostStore.graph.deleteNode(componentSlot.id, { permanent: true })
    hostStore.graph.updateNode(instanceSlot.id, { name: 'Orphan customized', x: 9 })
    unbind()

    const staleChildYnode = [...hostSync.ynodes.values()].find(
      (ynode) => ynode.get('originalSourceId') === componentSlot.source.id
    )
    expect(staleChildYnode?.get('parentId')).toBe(instance.source.id)
    expect(staleChildYnode?.get('componentId')).toBeNull()
    expect(staleChildYnode?.get('name')).toBe('Orphan customized')

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerInstance = localNodeForStableId(joiner.store, instance.source.id)
    const joinerStaleChild = joinerInstance?.childIds
      .map((childId) => joiner.store.graph.getNode(childId))
      .find((child) => child?.name === 'Orphan customized')

    expect(joinerStaleChild?.parentId).toBe(joinerInstance?.id)
    expect(joinerStaleChild?.name).toBe('Orphan customized')
    expect(joinerStaleChild?.x).toBe(9)
    expect(joiner.store.graph.getSyncState().pendingOverrideKeys.get(componentSlot.source.id)).toBe(
      undefined
    )
  })

  test('live backing-child deletion publishes stale descendants without follow-up edits', () => {
    const hostStore = createTestStore()
    const pageId = firstPageId(hostStore.graph)
    const {
      component,
      componentSlot,
      instance: firstInstance
    } = createComponentInstanceWithSlot(hostStore)
    const secondInstance = hostStore.graph.createInstance(component.id, pageId, {
      name: 'Second Delete-Only Instance'
    })
    if (secondInstance === null) throw new Error('expected second instance')
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)

    hostStore.graph.deleteNode(componentSlot.id, { permanent: true })
    unbind()

    const scopedStaleEntries = [...hostSync.ynodes.values()].filter(
      (ynode) => ynode.get('originalSourceId') === componentSlot.source.id
    )
    expect(hostSync.ynodes.has(componentSlot.source.id)).toBe(false)
    expect(scopedStaleEntries).toHaveLength(2)

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerFirst = localNodeForStableId(joiner.store, firstInstance.source.id)
    const joinerSecond = localNodeForStableId(joiner.store, secondInstance.source.id)
    const firstChild = childNamed(joiner.store, joinerFirst?.id, 'Slot')
    const secondChild = childNamed(joiner.store, joinerSecond?.id, 'Slot')

    expect(firstChild?.parentId).toBe(joinerFirst?.id)
    expect(firstChild?.componentId).toBeNull()
    expect(secondChild?.parentId).toBe(joinerSecond?.id)
    expect(secondChild?.componentId).toBeNull()
  })

  test('stale descendant publication releases existing instance overrides on joiners', () => {
    const hostStore = createTestStore()
    const { componentSlot, instance, instanceSlot } = createComponentInstanceWithSlot(hostStore)
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)

    hostStore.graph.updateNode(instanceSlot.id, { name: 'Customized before delete', x: 33 })
    hostStore.graph.deleteNode(componentSlot.id, { permanent: true })
    unbind()

    const staleChildYnode = [...hostSync.ynodes.values()].find(
      (ynode) => ynode.get('originalSourceId') === componentSlot.source.id
    )
    expect(staleChildYnode?.get('name')).toBe('Customized before delete')
    expect(staleChildYnode?.get('x')).toBe(33)

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerInstance = localNodeForStableId(joiner.store, instance.source.id)
    const joinerStaleChild = childNamed(
      joiner.store,
      joinerInstance?.id,
      'Customized before delete'
    )

    expect(joinerStaleChild?.parentId).toBe(joinerInstance?.id)
    expect(joinerStaleChild?.x).toBe(33)
    expect(joiner.store.graph.getSyncState().pendingOverrideKeys.get(componentSlot.source.id)).toBe(
      undefined
    )
  })

  test('multiple stale instance descendants keep unique standalone identities for late joiners', () => {
    const hostStore = createTestStore()
    const pageId = firstPageId(hostStore.graph)
    const {
      component,
      componentSlot,
      instance: firstInstance,
      instanceSlot: firstSlot
    } = createComponentInstanceWithSlot(hostStore)
    const secondInstance = hostStore.graph.createInstance(component.id, pageId, {
      name: 'Second Panel Instance'
    })
    if (secondInstance === null) throw new Error('expected second instance')
    const secondSlot = findInstanceDescendantByStableId(
      hostStore.graph,
      secondInstance,
      componentSlot.source.id
    )
    if (secondSlot === undefined) throw new Error('expected second populated slot')
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const unbind = bindCollabGraphEvents({
      store: hostStore,
      getYdoc: () => hostYdoc,
      getYnodes: () => hostSync.ynodes,
      getSuppressGraphSync: () => false,
      setSuppressYjsEvents: hostSync.setSuppressYjsEvents,
      syncNodeToYjs: hostSync.syncNodeToYjs,
      syncVariableToYjs: hostSync.syncVariableToYjs,
      syncCollectionToYjs: hostSync.syncCollectionToYjs
    })

    hostStore.graph.deleteNode(componentSlot.id, { permanent: true })
    hostStore.graph.updateNode(firstSlot.id, { name: 'First orphan', x: 11 })
    hostStore.graph.updateNode(secondSlot.id, { name: 'Second orphan', x: 22 })
    unbind()

    const scopedStaleEntries = [...hostSync.ynodes.values()].filter(
      (ynode) => ynode.get('originalSourceId') === componentSlot.source.id
    )
    expect(scopedStaleEntries).toHaveLength(2)

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerFirst = localNodeForStableId(joiner.store, firstInstance.source.id)
    const joinerSecond = localNodeForStableId(joiner.store, secondInstance.source.id)
    const firstChild = joinerFirst?.childIds
      .map((childId) => joiner.store.graph.getNode(childId))
      .find((child) => child?.name === 'First orphan')
    const secondChild = joinerSecond?.childIds
      .map((childId) => joiner.store.graph.getNode(childId))
      .find((child) => child?.name === 'Second orphan')

    expect(firstChild?.parentId).toBe(joinerFirst?.id)
    expect(firstChild?.x).toBe(11)
    expect(secondChild?.parentId).toBe(joinerSecond?.id)
    expect(secondChild?.x).toBe(22)
  })

  test('multiple stale instance descendants converge on already-synced peers', () => {
    const hostStore = createTestStore()
    const pageId = firstPageId(hostStore.graph)
    const {
      component,
      componentSlot,
      instance: firstInstance,
      instanceSlot: firstSlot
    } = createComponentInstanceWithSlot(hostStore)
    const secondInstance = hostStore.graph.createInstance(component.id, pageId, {
      name: 'Second Synced Panel Instance'
    })
    if (secondInstance === null) throw new Error('expected second instance')
    const secondSlot = findInstanceDescendantByStableId(
      hostStore.graph,
      secondInstance,
      componentSlot.source.id
    )
    if (secondSlot === undefined) throw new Error('expected second populated slot')
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    const unbind = bindCollabGraphEvents({
      store: hostStore,
      getYdoc: () => hostYdoc,
      getYnodes: () => hostSync.ynodes,
      getSuppressGraphSync: () => false,
      setSuppressYjsEvents: hostSync.setSuppressYjsEvents,
      syncNodeToYjs: hostSync.syncNodeToYjs,
      syncVariableToYjs: hostSync.syncVariableToYjs,
      syncCollectionToYjs: hostSync.syncCollectionToYjs
    })
    hostStore.graph.deleteNode(componentSlot.id, { permanent: true })
    hostStore.graph.updateNode(firstSlot.id, { name: 'Updated first orphan', y: 7 })
    hostStore.graph.updateNode(secondSlot.id, { name: 'Updated second orphan', y: 17 })
    unbind()
    encodeAndApply(hostYdoc, joiner.ydoc)

    const joinerFirst = localNodeForStableId(joiner.store, firstInstance.source.id)
    const joinerSecond = localNodeForStableId(joiner.store, secondInstance.source.id)
    expect(joinerFirst?.childIds).toHaveLength(1)
    expect(joinerSecond?.childIds).toHaveLength(1)
    const firstChild =
      joinerFirst?.childIds[0] === undefined
        ? undefined
        : joiner.store.graph.getNode(joinerFirst.childIds[0])
    const secondChild =
      joinerSecond?.childIds[0] === undefined
        ? undefined
        : joiner.store.graph.getNode(joinerSecond.childIds[0])
    expect(firstChild?.name).toBe('Updated first orphan')
    expect(firstChild?.y).toBe(7)
    expect(secondChild?.name).toBe('Updated second orphan')
    expect(secondChild?.y).toBe(17)
  })

  test('received stale instance descendants keep scoped identity for peer edits', () => {
    const hostStore = createTestStore()
    const { componentSlot, instance } = createComponentInstanceWithSlot(hostStore)
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    const unbindHost = bindHostGraphEvents(hostStore, hostYdoc, hostSync)
    hostStore.graph.deleteNode(componentSlot.id, { permanent: true })
    unbindHost()
    encodeAndApply(hostYdoc, joiner.ydoc)

    const joinerInstance = localNodeForStableId(joiner.store, instance.source.id)
    const joinerStaleChild = childNamed(joiner.store, joinerInstance?.id, 'Slot')
    expect(joinerStaleChild?.componentId).toBeNull()
    if (joinerStaleChild === undefined) throw new Error('expected received orphan child')
    const scopedStableId = joiner.store.graph.getSyncState().localToRemote.get(joinerStaleChild.id)
    expect(scopedStableId).toBeDefined()
    expect(originalStableIdFromRemoteNodeKey(scopedStableId ?? '')).toBe(componentSlot.source.id)

    const unbindJoiner = bindHostGraphEvents(joiner.store, joiner.ydoc, joiner.sync)
    joiner.store.graph.updateNode(joinerStaleChild.id, { name: 'Joiner orphan edit', x: 44 })
    unbindJoiner()

    expect(scopedStableId).toBeDefined()
    if (scopedStableId === undefined) return
    expect(joiner.sync.ynodes.has(componentSlot.source.id)).toBe(false)
    expect(joiner.sync.ynodes.get(scopedStableId)?.get('originalSourceId')).toBe(
      componentSlot.source.id
    )
    expect(joiner.sync.ynodes.get(scopedStableId)?.get('name')).toBe('Joiner orphan edit')

    const late = observeJoiner()
    encodeAndApply(joiner.ydoc, late.ydoc)
    expect(late.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const lateInstance = localNodeForStableId(late.store, instance.source.id)
    const lateStaleChild = childNamed(late.store, lateInstance?.id, 'Joiner orphan edit')
    expect(lateStaleChild?.parentId).toBe(lateInstance?.id)
    expect(lateStaleChild?.x).toBe(44)
  })
})
