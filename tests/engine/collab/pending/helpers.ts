import * as Y from 'yjs'

import { bindCollabGraphEvents, findInstanceDescendantByStableId } from '@/app/collab/yjs-sync'

import {
  cloneYnode,
  createTestStore,
  createTestYjsSync,
  observeTargetDoc,
  type TestStore
} from '#tests/engine/collab/helpers'
import { firstPageId } from '#tests/helpers/scene'

export function localNodeForStableId(store: TestStore, stableId: string) {
  const localId = store.graph.getSyncState().remoteToLocal.get(stableId)
  return localId === undefined ? undefined : store.graph.getNode(localId)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function ymapRecordValue(ymap: Y.Map<unknown> | undefined, key: string) {
  const value = ymap?.get(key)
  return isRecord(value) ? value : undefined
}

export function cloneYmapEntries(
  source: Y.Map<unknown> | undefined,
  target: Y.Map<Y.Map<unknown>>,
  key: string
): void {
  if (source === undefined) throw new Error(`missing source ymap for ${key}`)
  const ymap = new Y.Map<unknown>()
  for (const [entryKey, value] of source.entries()) {
    ymap.set(entryKey, value)
  }
  target.set(key, ymap)
}

export function observeJoiner() {
  const store = createTestStore()
  const ydoc = new Y.Doc()
  const sync = createTestYjsSync(store, ydoc)
  observeTargetDoc(store, ydoc, sync.applyYjsToGraph, sync.reconcileRoot)
  return { store, ydoc, sync }
}

export function bindHostGraphEvents(
  store: TestStore,
  ydoc: Y.Doc,
  sync: ReturnType<typeof createTestYjsSync>
) {
  return bindCollabGraphEvents({
    store,
    getYdoc: () => ydoc,
    getYnodes: () => sync.ynodes,
    getSuppressGraphSync: () => false,
    setSuppressYjsEvents: sync.setSuppressYjsEvents,
    syncNodeToYjs: sync.syncNodeToYjs,
    syncVariableToYjs: sync.syncVariableToYjs,
    syncCollectionToYjs: sync.syncCollectionToYjs
  })
}

export function createNestedInstanceFixture(store: TestStore) {
  const pageId = firstPageId(store.graph)
  const innerComponent = store.graph.createNode('COMPONENT', pageId, {
    name: 'Inner',
    width: 64,
    height: 40
  })
  const innerSlot = store.graph.createNode('RECTANGLE', innerComponent.id, {
    name: 'Inner Slot',
    width: 24,
    height: 16
  })
  const outerComponent = store.graph.createNode('COMPONENT', pageId, {
    name: 'Outer',
    width: 160,
    height: 100
  })
  const nestedComponentInstance = store.graph.createInstance(innerComponent.id, outerComponent.id, {
    name: 'Nested In Component'
  })
  if (nestedComponentInstance === null) throw new Error('expected nested component instance')
  const outerInstance = store.graph.createInstance(outerComponent.id, pageId, {
    name: 'Outer Instance'
  })
  if (outerInstance === null) throw new Error('expected outer instance')
  const populatedNestedInstance = findInstanceDescendantByStableId(
    store.graph,
    outerInstance,
    nestedComponentInstance.source.id
  )
  if (populatedNestedInstance?.type !== 'INSTANCE') {
    throw new Error('expected populated nested instance')
  }
  const populatedInnerSlot = findInstanceDescendantByStableId(
    store.graph,
    populatedNestedInstance,
    innerSlot.source.id
  )
  if (populatedInnerSlot === undefined) throw new Error('expected populated inner slot')
  return {
    innerComponent,
    innerSlot,
    outerComponent,
    nestedComponentInstance,
    outerInstance,
    populatedNestedInstance,
    populatedInnerSlot
  }
}

export function createDeepNestedInstanceFixture(store: TestStore) {
  const pageId = firstPageId(store.graph)
  const innerComponent = store.graph.createNode('COMPONENT', pageId, {
    name: 'Inner',
    width: 64,
    height: 40
  })
  const innerSlot = store.graph.createNode('RECTANGLE', innerComponent.id, {
    name: 'Inner Slot',
    width: 24,
    height: 16
  })
  const midComponent = store.graph.createNode('COMPONENT', pageId, {
    name: 'Mid',
    width: 96,
    height: 60
  })
  const midInnerInstance = store.graph.createInstance(innerComponent.id, midComponent.id, {
    name: 'Mid Inner Instance'
  })
  if (midInnerInstance === null) throw new Error('expected mid inner instance')
  const outerComponent = store.graph.createNode('COMPONENT', pageId, {
    name: 'Outer',
    width: 220,
    height: 120
  })
  const outerMidInstanceA = store.graph.createInstance(midComponent.id, outerComponent.id, {
    name: 'Mid A'
  })
  const outerMidInstanceB = store.graph.createInstance(midComponent.id, outerComponent.id, {
    name: 'Mid B'
  })
  if (outerMidInstanceA === null || outerMidInstanceB === null) {
    throw new Error('expected sibling mid instances')
  }
  const outerInstance = store.graph.createInstance(outerComponent.id, pageId, {
    name: 'Outer Instance'
  })
  if (outerInstance === null) throw new Error('expected outer instance')

  const populatedMidA = requireInstanceDescendant(
    store,
    outerInstance,
    outerMidInstanceA.source.id,
    'expected populated mid A'
  )
  const populatedMidB = requireInstanceDescendant(
    store,
    outerInstance,
    outerMidInstanceB.source.id,
    'expected populated mid B'
  )
  const populatedInnerA = requireInstanceDescendant(
    store,
    populatedMidA,
    midInnerInstance.source.id,
    'expected populated inner A'
  )
  const populatedInnerB = requireInstanceDescendant(
    store,
    populatedMidB,
    midInnerInstance.source.id,
    'expected populated inner B'
  )
  const populatedSlotA = findInstanceDescendantByStableId(
    store.graph,
    populatedInnerA,
    innerSlot.source.id
  )
  const populatedSlotB = findInstanceDescendantByStableId(
    store.graph,
    populatedInnerB,
    innerSlot.source.id
  )
  if (populatedSlotA === undefined || populatedSlotB === undefined) {
    throw new Error('expected populated inner slots')
  }

  return {
    innerComponent,
    innerSlot,
    midComponent,
    midInnerInstance,
    outerComponent,
    outerMidInstanceA,
    outerMidInstanceB,
    outerInstance,
    populatedMidA,
    populatedMidB,
    populatedInnerA,
    populatedInnerB,
    populatedSlotA,
    populatedSlotB
  }
}

export function createMixedDirectTransitiveInstanceFixture(store: TestStore) {
  const pageId = firstPageId(store.graph)
  const innerComponent = store.graph.createNode('COMPONENT', pageId, {
    name: 'Inner',
    width: 64,
    height: 40
  })
  const innerSlot = store.graph.createNode('RECTANGLE', innerComponent.id, {
    name: 'Inner Slot',
    width: 24,
    height: 16
  })
  const outerComponent = store.graph.createNode('COMPONENT', pageId, {
    name: 'Outer',
    width: 220,
    height: 120
  })
  const outerDirectInnerInstance = store.graph.createInstance(
    innerComponent.id,
    outerComponent.id,
    { name: 'Outer Direct Inner' }
  )
  const midComponent = store.graph.createNode('COMPONENT', pageId, {
    name: 'Mid',
    width: 96,
    height: 60
  })
  const midInnerInstance = store.graph.createInstance(innerComponent.id, midComponent.id, {
    name: 'Mid Inner Instance'
  })
  const outerMidInstance = store.graph.createInstance(midComponent.id, outerComponent.id, {
    name: 'Outer Mid'
  })
  const outerInstance = store.graph.createInstance(outerComponent.id, pageId, {
    name: 'Outer Instance'
  })
  if (
    outerDirectInnerInstance === null ||
    midInnerInstance === null ||
    outerMidInstance === null ||
    outerInstance === null
  ) {
    throw new Error('expected mixed nested instances')
  }
  const populatedMid = requireInstanceDescendant(
    store,
    outerInstance,
    outerMidInstance.source.id,
    'expected populated mid'
  )
  const populatedInner = requireInstanceDescendant(
    store,
    populatedMid,
    midInnerInstance.source.id,
    'expected populated inner'
  )
  const populatedSlot = findInstanceDescendantByStableId(
    store.graph,
    populatedInner,
    innerSlot.source.id
  )
  if (populatedSlot === undefined) throw new Error('expected populated slot')
  return {
    innerComponent,
    innerSlot,
    outerComponent,
    outerDirectInnerInstance,
    midComponent,
    midInnerInstance,
    outerMidInstance,
    outerInstance,
    populatedSlot
  }
}

function requireInstanceDescendant(
  store: TestStore,
  instance: ReturnType<TestStore['graph']['getNode']>,
  stableId: string,
  message: string
) {
  if (instance?.type !== 'INSTANCE') throw new Error(message)
  const descendant = findInstanceDescendantByStableId(store.graph, instance, stableId)
  if (descendant?.type !== 'INSTANCE') throw new Error(message)
  return descendant
}

export function cloneNestedInstanceSkeleton(
  hostSync: ReturnType<typeof createTestYjsSync>,
  joinerSync: ReturnType<typeof createTestYjsSync>,
  ids: {
    rootStableId: string
    pageStableId: string
    innerComponentStableId: string
    outerComponentStableId: string
    nestedInstanceStableId: string
    outerInstanceStableId: string
  }
): void {
  cloneYnode(hostSync.ynodes.get(ids.rootStableId), joinerSync.ynodes, ids.rootStableId)
  cloneYnode(hostSync.ynodes.get(ids.pageStableId), joinerSync.ynodes, ids.pageStableId)
  cloneYnode(
    hostSync.ynodes.get(ids.innerComponentStableId),
    joinerSync.ynodes,
    ids.innerComponentStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.outerComponentStableId),
    joinerSync.ynodes,
    ids.outerComponentStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.nestedInstanceStableId),
    joinerSync.ynodes,
    ids.nestedInstanceStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.outerInstanceStableId),
    joinerSync.ynodes,
    ids.outerInstanceStableId
  )
}

export function cloneDeepNestedInstanceSkeleton(
  hostSync: ReturnType<typeof createTestYjsSync>,
  joinerSync: ReturnType<typeof createTestYjsSync>,
  ids: {
    rootStableId: string
    pageStableId: string
    innerComponentStableId: string
    innerSlotStableId: string
    midComponentStableId: string
    midInnerInstanceStableId: string
    outerComponentStableId: string
    outerMidInstanceAStableId: string
    outerMidInstanceBStableId: string
    outerInstanceStableId: string
  },
  options: { includeInnerSlot: boolean }
): void {
  cloneYnode(hostSync.ynodes.get(ids.rootStableId), joinerSync.ynodes, ids.rootStableId)
  cloneYnode(hostSync.ynodes.get(ids.pageStableId), joinerSync.ynodes, ids.pageStableId)
  cloneYnode(
    hostSync.ynodes.get(ids.innerComponentStableId),
    joinerSync.ynodes,
    ids.innerComponentStableId
  )
  if (options.includeInnerSlot) {
    cloneYnode(hostSync.ynodes.get(ids.innerSlotStableId), joinerSync.ynodes, ids.innerSlotStableId)
  }
  cloneYnode(
    hostSync.ynodes.get(ids.midComponentStableId),
    joinerSync.ynodes,
    ids.midComponentStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.midInnerInstanceStableId),
    joinerSync.ynodes,
    ids.midInnerInstanceStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.outerComponentStableId),
    joinerSync.ynodes,
    ids.outerComponentStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.outerMidInstanceAStableId),
    joinerSync.ynodes,
    ids.outerMidInstanceAStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.outerMidInstanceBStableId),
    joinerSync.ynodes,
    ids.outerMidInstanceBStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.outerInstanceStableId),
    joinerSync.ynodes,
    ids.outerInstanceStableId
  )
}

export function deepNestedJoinerTargets(
  store: TestStore,
  ids: {
    outerInstanceStableId: string
    outerMidInstanceAStableId: string
    outerMidInstanceBStableId: string
    midInnerInstanceStableId: string
    innerSlotStableId: string
  }
) {
  const outerInstance = localNodeForStableId(store, ids.outerInstanceStableId)
  const midA = requireInstanceDescendant(
    store,
    outerInstance,
    ids.outerMidInstanceAStableId,
    'expected joiner mid A'
  )
  const midB = requireInstanceDescendant(
    store,
    outerInstance,
    ids.outerMidInstanceBStableId,
    'expected joiner mid B'
  )
  const innerA = requireInstanceDescendant(
    store,
    midA,
    ids.midInnerInstanceStableId,
    'expected joiner inner A'
  )
  const innerB = requireInstanceDescendant(
    store,
    midB,
    ids.midInnerInstanceStableId,
    'expected joiner inner B'
  )
  const slotA = findInstanceDescendantByStableId(store.graph, innerA, ids.innerSlotStableId)
  const slotB = findInstanceDescendantByStableId(store.graph, innerB, ids.innerSlotStableId)
  if (outerInstance?.type !== 'INSTANCE' || slotA === undefined || slotB === undefined) {
    throw new Error('expected joiner deep nested slots')
  }
  return { outerInstance, slotA, slotB }
}

export function cloneMixedDirectTransitiveSkeleton(
  hostSync: ReturnType<typeof createTestYjsSync>,
  joinerSync: ReturnType<typeof createTestYjsSync>,
  ids: {
    rootStableId: string
    pageStableId: string
    innerComponentStableId: string
    outerComponentStableId: string
    outerDirectInnerInstanceStableId: string
    midComponentStableId: string
    midInnerInstanceStableId: string
    outerMidInstanceStableId: string
    outerInstanceStableId: string
  }
): void {
  cloneYnode(hostSync.ynodes.get(ids.rootStableId), joinerSync.ynodes, ids.rootStableId)
  cloneYnode(hostSync.ynodes.get(ids.pageStableId), joinerSync.ynodes, ids.pageStableId)
  cloneYnode(
    hostSync.ynodes.get(ids.innerComponentStableId),
    joinerSync.ynodes,
    ids.innerComponentStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.outerComponentStableId),
    joinerSync.ynodes,
    ids.outerComponentStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.outerDirectInnerInstanceStableId),
    joinerSync.ynodes,
    ids.outerDirectInnerInstanceStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.midComponentStableId),
    joinerSync.ynodes,
    ids.midComponentStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.midInnerInstanceStableId),
    joinerSync.ynodes,
    ids.midInnerInstanceStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.outerMidInstanceStableId),
    joinerSync.ynodes,
    ids.outerMidInstanceStableId
  )
  cloneYnode(
    hostSync.ynodes.get(ids.outerInstanceStableId),
    joinerSync.ynodes,
    ids.outerInstanceStableId
  )
}

export function mixedDirectTransitiveJoinerTargets(
  store: TestStore,
  ids: {
    outerInstanceStableId: string
    outerDirectInnerInstanceStableId: string
    outerMidInstanceStableId: string
    midInnerInstanceStableId: string
    innerSlotStableId: string
  }
) {
  const outerInstance = localNodeForStableId(store, ids.outerInstanceStableId)
  const directInner = requireInstanceDescendant(
    store,
    outerInstance,
    ids.outerDirectInnerInstanceStableId,
    'expected joiner direct inner'
  )
  const mid = requireInstanceDescendant(
    store,
    outerInstance,
    ids.outerMidInstanceStableId,
    'expected joiner mid'
  )
  const midInner = requireInstanceDescendant(
    store,
    mid,
    ids.midInnerInstanceStableId,
    'expected joiner nested inner'
  )
  const directSlot = findInstanceDescendantByStableId(
    store.graph,
    directInner,
    ids.innerSlotStableId
  )
  const nestedSlot = findInstanceDescendantByStableId(store.graph, midInner, ids.innerSlotStableId)
  if (outerInstance?.type !== 'INSTANCE' || directSlot === undefined || nestedSlot === undefined) {
    throw new Error('expected joiner mixed nested slots')
  }
  return { outerInstance, directSlot, nestedSlot }
}
