import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  findInstanceDescendantByStableId,
  stableIdForCollection,
  stableIdForVariable
} from '@/app/collab/yjs-sync'

import {
  cloneYnode,
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState
} from '#tests/engine/collab/helpers'
import { firstPageId } from '#tests/helpers/scene'

import {
  bindHostGraphEvents,
  cloneDeepNestedInstanceSkeleton,
  cloneMixedDirectTransitiveSkeleton,
  cloneNestedInstanceSkeleton,
  cloneYmapEntries,
  createDeepNestedInstanceFixture,
  createMixedDirectTransitiveInstanceFixture,
  createNestedInstanceFixture,
  deepNestedJoinerTargets,
  isRecord,
  localNodeForStableId,
  mixedDirectTransitiveJoinerTargets,
  observeJoiner,
  ymapRecordValue
} from './helpers'

describe('collab nested component instances', () => {
  test('populated nested instances do not overwrite backing component child maps', () => {
    const hostStore = createTestStore()
    const { innerComponent, outerComponent, nestedComponentInstance, outerInstance } =
      createNestedInstanceFixture(hostStore)
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)

    hostSync.syncAllNodesToYjs()
    const nestedYnode = hostSync.ynodes.get(nestedComponentInstance.source.id)
    expect(nestedYnode?.get('parentId')).toBe(outerComponent.source.id)
    expect(nestedYnode?.get('componentId')).toBe(innerComponent.source.id)

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerOuter = localNodeForStableId(joiner.store, outerComponent.source.id)
    const joinerNestedBacking = localNodeForStableId(
      joiner.store,
      nestedComponentInstance.source.id
    )
    const joinerOuterInstance = localNodeForStableId(joiner.store, outerInstance.source.id)
    expect(joinerNestedBacking?.parentId).toBe(joinerOuter?.id)
    expect(joinerOuterInstance?.type).toBe('INSTANCE')
    if (joinerOuterInstance?.type !== 'INSTANCE') return
    const joinerNestedInstance = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerOuterInstance,
      nestedComponentInstance.source.id
    )
    expect(joinerNestedInstance?.type).toBe('INSTANCE')
    expect(joinerNestedInstance?.parentId).toBe(joinerOuterInstance.id)
    expect(joinerNestedInstance?.componentId).toBe(joinerNestedBacking?.id)
  })

  test('live edits inside populated nested instances sync through nested overrides', () => {
    const hostStore = createTestStore()
    const { innerSlot, nestedComponentInstance, outerInstance, populatedInnerSlot } =
      createNestedInstanceFixture(hostStore)
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)

    hostStore.graph.updateNode(populatedInnerSlot.id, { width: 37 })
    unbind()

    const nestedYnode = hostSync.ynodes.get(nestedComponentInstance.source.id)
    expect(nestedYnode?.get('parentId')).not.toBe(outerInstance.source.id)
    const outerOverrides = hostSync.ynodes.get(outerInstance.source.id)?.get('overrides')
    expect(isRecord(outerOverrides)).toBe(true)
    if (!isRecord(outerOverrides)) return
    const nestedOverrides = outerOverrides[`${nestedComponentInstance.source.id}:overrides`]
    expect(isRecord(nestedOverrides)).toBe(true)
    if (!isRecord(nestedOverrides)) return
    expect(nestedOverrides[`${innerSlot.source.id}:width`]).toBe(37)

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerOuterInstance = localNodeForStableId(joiner.store, outerInstance.source.id)
    expect(joinerOuterInstance?.type).toBe('INSTANCE')
    if (joinerOuterInstance?.type !== 'INSTANCE') return
    const joinerNestedInstance = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerOuterInstance,
      nestedComponentInstance.source.id
    )
    expect(joinerNestedInstance?.type).toBe('INSTANCE')
    if (joinerNestedInstance?.type !== 'INSTANCE') return
    const joinerInnerSlot = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerNestedInstance,
      innerSlot.source.id
    )
    expect(joinerInnerSlot?.width).toBe(37)
  })

  test('pending nested primitive overrides release onto populated nested instances', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const hostPageNode = hostStore.graph.getNode(hostPage)
    if (hostPageNode === undefined) throw new Error('expected host page')
    const {
      innerComponent,
      innerSlot,
      outerComponent,
      nestedComponentInstance,
      outerInstance,
      populatedInnerSlot
    } = createNestedInstanceFixture(hostStore)

    hostStore.graph.updateNode(populatedInnerSlot.id, { width: 37 })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joiner = observeJoiner()
    cloneNestedInstanceSkeleton(hostSync, joiner.sync, {
      rootStableId: hostRootStable,
      pageStableId: hostPageNode.source.id,
      innerComponentStableId: innerComponent.source.id,
      outerComponentStableId: outerComponent.source.id,
      nestedInstanceStableId: nestedComponentInstance.source.id,
      outerInstanceStableId: outerInstance.source.id
    })

    const joinerState = joiner.store.graph.getSyncState()
    expect(joinerState.pendingOverrideKeys.get(innerSlot.source.id)?.size).toBe(1)

    cloneYnode(hostSync.ynodes.get(innerSlot.source.id), joiner.sync.ynodes, innerSlot.source.id)

    expect(joinerState.pendingOverrideKeys.get(innerSlot.source.id)).toBeUndefined()
    const joinerOuterInstance = localNodeForStableId(joiner.store, outerInstance.source.id)
    expect(joinerOuterInstance?.type).toBe('INSTANCE')
    if (joinerOuterInstance?.type !== 'INSTANCE') return
    const joinerNestedInstance = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerOuterInstance,
      nestedComponentInstance.source.id
    )
    expect(joinerNestedInstance?.type).toBe('INSTANCE')
    if (joinerNestedInstance?.type !== 'INSTANCE') return
    const joinerInnerSlot = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerNestedInstance,
      innerSlot.source.id
    )
    expect(joinerInnerSlot?.width).toBe(37)

    const outerNestedOverrides =
      joinerOuterInstance.overrides[`${nestedComponentInstance.source.id}:overrides`]
    expect(isRecord(outerNestedOverrides)).toBe(true)
    if (!isRecord(outerNestedOverrides)) return
    expect(outerNestedOverrides[`${innerSlot.source.id}:width`]).toBe(37)

    const joinerBackingNested = localNodeForStableId(
      joiner.store,
      nestedComponentInstance.source.id
    )
    expect(joinerBackingNested?.type).toBe('INSTANCE')
    if (joinerBackingNested?.type !== 'INSTANCE') return
    expect(joinerBackingNested.overrides[`${innerSlot.source.id}:width`]).toBeUndefined()
  })

  test('pending nested boundVariables release onto populated nested instances', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const hostPageNode = hostStore.graph.getNode(hostPage)
    if (hostPageNode === undefined) throw new Error('expected host page')
    const {
      innerComponent,
      innerSlot,
      outerComponent,
      nestedComponentInstance,
      outerInstance,
      populatedInnerSlot
    } = createNestedInstanceFixture(hostStore)
    const collection = hostStore.graph.createCollection('Nested colors')
    const variable = hostStore.graph.createVariable('Accent', 'COLOR', collection.id, {
      r: 0.8,
      g: 0.1,
      b: 0.2,
      a: 1
    })
    hostStore.graph.updateNode(populatedInnerSlot.id, {
      boundVariables: { fills: variable.id }
    })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const hostOuterOverrides = ymapRecordValue(
      hostSync.ynodes.get(outerInstance.source.id),
      'overrides'
    )
    const hostNestedOverrides =
      hostOuterOverrides?.[`${nestedComponentInstance.source.id}:overrides`]
    expect(isRecord(hostNestedOverrides)).toBe(true)
    if (!isRecord(hostNestedOverrides)) return
    expect(hostNestedOverrides[`${innerSlot.source.id}:boundVariables`]).toEqual({
      fills: stableIdForVariable(variable)
    })

    const joiner = observeJoiner()
    cloneNestedInstanceSkeleton(hostSync, joiner.sync, {
      rootStableId: hostRootStable,
      pageStableId: hostPageNode.source.id,
      innerComponentStableId: innerComponent.source.id,
      outerComponentStableId: outerComponent.source.id,
      nestedInstanceStableId: nestedComponentInstance.source.id,
      outerInstanceStableId: outerInstance.source.id
    })
    cloneYnode(hostSync.ynodes.get(innerSlot.source.id), joiner.sync.ynodes, innerSlot.source.id)

    const joinerState = joiner.store.graph.getSyncState()
    expect(joinerState.pendingVariableBindings.get(stableIdForVariable(variable))?.size).toBe(1)
    const pendingBinding = [
      ...(joinerState.pendingVariableBindings.get(stableIdForVariable(variable)) ?? [])
    ][0]
    expect(pendingBinding?.instanceStableId).toBe(outerInstance.source.id)
    expect(pendingBinding?.nestedInstanceStablePath).toEqual([nestedComponentInstance.source.id])

    cloneYmapEntries(
      hostSync.ycollections.get(stableIdForCollection(collection)),
      joiner.sync.ycollections,
      stableIdForCollection(collection)
    )
    cloneYmapEntries(
      hostSync.yvariables.get(stableIdForVariable(variable)),
      joiner.sync.yvariables,
      stableIdForVariable(variable)
    )

    const joinerOuterInstance = localNodeForStableId(joiner.store, outerInstance.source.id)
    expect(joinerOuterInstance?.type).toBe('INSTANCE')
    if (joinerOuterInstance?.type !== 'INSTANCE') return
    const joinerNestedInstance = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerOuterInstance,
      nestedComponentInstance.source.id
    )
    expect(joinerNestedInstance?.type).toBe('INSTANCE')
    if (joinerNestedInstance?.type !== 'INSTANCE') return
    const joinerInnerSlot = findInstanceDescendantByStableId(
      joiner.store.graph,
      joinerNestedInstance,
      innerSlot.source.id
    )
    const boundVarId = joinerInnerSlot?.boundVariables.fills
    expect(boundVarId).toBeDefined()
    if (boundVarId === undefined) return
    const joinerVariable = joiner.store.graph.variables.get(boundVarId)
    expect(joinerVariable).toBeDefined()
    if (joinerVariable === undefined) return
    expect(stableIdForVariable(joinerVariable)).toBe(stableIdForVariable(variable))

    const outerNestedOverrides =
      joinerOuterInstance.overrides[`${nestedComponentInstance.source.id}:overrides`]
    expect(isRecord(outerNestedOverrides)).toBe(true)
    if (!isRecord(outerNestedOverrides)) return
    expect(outerNestedOverrides[`${innerSlot.source.id}:boundVariables`]).toEqual({
      fills: boundVarId
    })
    expect(joinerState.pendingVariableBindings.get(stableIdForVariable(variable))).toBeUndefined()

    if (joinerOuterInstance.componentId === null) throw new Error('expected linked outer instance')
    joiner.store.graph.syncInstances(joinerOuterInstance.componentId)
    expect(joinerInnerSlot?.boundVariables.fills).toBe(boundVarId)
  })

  test('pending deeply nested boundVariables keep the targeted sibling branch path', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const hostPageNode = hostStore.graph.getNode(hostPage)
    if (hostPageNode === undefined) throw new Error('expected host page')
    const {
      innerComponent,
      innerSlot,
      midComponent,
      midInnerInstance,
      outerComponent,
      outerMidInstanceA,
      outerMidInstanceB,
      outerInstance,
      populatedSlotA
    } = createDeepNestedInstanceFixture(hostStore)
    const collection = hostStore.graph.createCollection('Deep colors')
    const variable = hostStore.graph.createVariable('Accent', 'COLOR', collection.id, {
      r: 0.4,
      g: 0.2,
      b: 0.9,
      a: 1
    })
    hostStore.graph.updateNode(populatedSlotA.id, {
      boundVariables: { fills: variable.id }
    })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joiner = observeJoiner()
    cloneDeepNestedInstanceSkeleton(
      hostSync,
      joiner.sync,
      {
        rootStableId: hostRootStable,
        pageStableId: hostPageNode.source.id,
        innerComponentStableId: innerComponent.source.id,
        innerSlotStableId: innerSlot.source.id,
        midComponentStableId: midComponent.source.id,
        midInnerInstanceStableId: midInnerInstance.source.id,
        outerComponentStableId: outerComponent.source.id,
        outerMidInstanceAStableId: outerMidInstanceA.source.id,
        outerMidInstanceBStableId: outerMidInstanceB.source.id,
        outerInstanceStableId: outerInstance.source.id
      },
      { includeInnerSlot: true }
    )

    const joinerState = joiner.store.graph.getSyncState()
    const pendingBinding = [
      ...(joinerState.pendingVariableBindings.get(stableIdForVariable(variable)) ?? [])
    ][0]
    expect(pendingBinding?.instanceStableId).toBe(outerInstance.source.id)
    expect(pendingBinding?.nestedInstanceStablePath).toEqual([
      outerMidInstanceA.source.id,
      midInnerInstance.source.id
    ])

    cloneYmapEntries(
      hostSync.ycollections.get(stableIdForCollection(collection)),
      joiner.sync.ycollections,
      stableIdForCollection(collection)
    )
    cloneYmapEntries(
      hostSync.yvariables.get(stableIdForVariable(variable)),
      joiner.sync.yvariables,
      stableIdForVariable(variable)
    )

    const {
      outerInstance: joinerOuterInstance,
      slotA: joinerSlotA,
      slotB: joinerSlotB
    } = deepNestedJoinerTargets(joiner.store, {
      outerInstanceStableId: outerInstance.source.id,
      outerMidInstanceAStableId: outerMidInstanceA.source.id,
      outerMidInstanceBStableId: outerMidInstanceB.source.id,
      midInnerInstanceStableId: midInnerInstance.source.id,
      innerSlotStableId: innerSlot.source.id
    })
    const boundVarId = joinerSlotA?.boundVariables.fills
    expect(boundVarId).toBeDefined()
    expect(joinerSlotB?.boundVariables.fills).toBeUndefined()
    if (boundVarId === undefined) return
    const joinerVariable = joiner.store.graph.variables.get(boundVarId)
    expect(joinerVariable).toBeDefined()
    if (joinerVariable === undefined) return
    expect(stableIdForVariable(joinerVariable)).toBe(stableIdForVariable(variable))

    const midAOverrides = joinerOuterInstance.overrides[`${outerMidInstanceA.source.id}:overrides`]
    expect(isRecord(midAOverrides)).toBe(true)
    if (!isRecord(midAOverrides)) return
    const innerAOverrides = midAOverrides[`${midInnerInstance.source.id}:overrides`]
    expect(isRecord(innerAOverrides)).toBe(true)
    if (!isRecord(innerAOverrides)) return
    expect(innerAOverrides[`${innerSlot.source.id}:boundVariables`]).toEqual({
      fills: boundVarId
    })
    const midBOverrides = joinerOuterInstance.overrides[`${outerMidInstanceB.source.id}:overrides`]
    expect(midBOverrides).toBeUndefined()
  })

  test('pending deeply nested primitive overrides release after transitive component sync', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const hostPageNode = hostStore.graph.getNode(hostPage)
    if (hostPageNode === undefined) throw new Error('expected host page')
    const {
      innerComponent,
      innerSlot,
      midComponent,
      midInnerInstance,
      outerComponent,
      outerMidInstanceA,
      outerMidInstanceB,
      outerInstance,
      populatedSlotA
    } = createDeepNestedInstanceFixture(hostStore)
    hostStore.graph.updateNode(populatedSlotA.id, { width: 37 })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joiner = observeJoiner()
    cloneDeepNestedInstanceSkeleton(
      hostSync,
      joiner.sync,
      {
        rootStableId: hostRootStable,
        pageStableId: hostPageNode.source.id,
        innerComponentStableId: innerComponent.source.id,
        innerSlotStableId: innerSlot.source.id,
        midComponentStableId: midComponent.source.id,
        midInnerInstanceStableId: midInnerInstance.source.id,
        outerComponentStableId: outerComponent.source.id,
        outerMidInstanceAStableId: outerMidInstanceA.source.id,
        outerMidInstanceBStableId: outerMidInstanceB.source.id,
        outerInstanceStableId: outerInstance.source.id
      },
      { includeInnerSlot: false }
    )

    const joinerState = joiner.store.graph.getSyncState()
    expect(joinerState.pendingOverrideKeys.get(innerSlot.source.id)?.size).toBe(1)

    cloneYnode(hostSync.ynodes.get(innerSlot.source.id), joiner.sync.ynodes, innerSlot.source.id)

    expect(joinerState.pendingOverrideKeys.get(innerSlot.source.id)).toBeUndefined()
    const {
      outerInstance: joinerOuterInstance,
      slotA: joinerSlotA,
      slotB: joinerSlotB
    } = deepNestedJoinerTargets(joiner.store, {
      outerInstanceStableId: outerInstance.source.id,
      outerMidInstanceAStableId: outerMidInstanceA.source.id,
      outerMidInstanceBStableId: outerMidInstanceB.source.id,
      midInnerInstanceStableId: midInnerInstance.source.id,
      innerSlotStableId: innerSlot.source.id
    })
    expect(joinerSlotA?.width).toBe(37)
    expect(joinerSlotB?.width).toBe(24)

    const midAOverrides = joinerOuterInstance.overrides[`${outerMidInstanceA.source.id}:overrides`]
    expect(isRecord(midAOverrides)).toBe(true)
    if (!isRecord(midAOverrides)) return
    const innerAOverrides = midAOverrides[`${midInnerInstance.source.id}:overrides`]
    expect(isRecord(innerAOverrides)).toBe(true)
    if (!isRecord(innerAOverrides)) return
    expect(innerAOverrides[`${innerSlot.source.id}:width`]).toBe(37)
  })

  test('pending deep primitive overrides resync ancestors reached through direct and transitive paths', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const hostPageNode = hostStore.graph.getNode(hostPage)
    if (hostPageNode === undefined) throw new Error('expected host page')
    const {
      innerComponent,
      innerSlot,
      outerComponent,
      outerDirectInnerInstance,
      midComponent,
      midInnerInstance,
      outerMidInstance,
      outerInstance,
      populatedSlot
    } = createMixedDirectTransitiveInstanceFixture(hostStore)
    hostStore.graph.updateNode(populatedSlot.id, { width: 37 })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joiner = observeJoiner()
    cloneMixedDirectTransitiveSkeleton(hostSync, joiner.sync, {
      rootStableId: hostRootStable,
      pageStableId: hostPageNode.source.id,
      innerComponentStableId: innerComponent.source.id,
      outerComponentStableId: outerComponent.source.id,
      outerDirectInnerInstanceStableId: outerDirectInnerInstance.source.id,
      midComponentStableId: midComponent.source.id,
      midInnerInstanceStableId: midInnerInstance.source.id,
      outerMidInstanceStableId: outerMidInstance.source.id,
      outerInstanceStableId: outerInstance.source.id
    })

    const joinerState = joiner.store.graph.getSyncState()
    expect(joinerState.pendingOverrideKeys.get(innerSlot.source.id)?.size).toBe(1)

    cloneYnode(hostSync.ynodes.get(innerSlot.source.id), joiner.sync.ynodes, innerSlot.source.id)

    expect(joinerState.pendingOverrideKeys.get(innerSlot.source.id)).toBeUndefined()
    const {
      outerInstance: joinerOuterInstance,
      directSlot: joinerDirectSlot,
      nestedSlot: joinerNestedSlot
    } = mixedDirectTransitiveJoinerTargets(joiner.store, {
      outerInstanceStableId: outerInstance.source.id,
      outerDirectInnerInstanceStableId: outerDirectInnerInstance.source.id,
      outerMidInstanceStableId: outerMidInstance.source.id,
      midInnerInstanceStableId: midInnerInstance.source.id,
      innerSlotStableId: innerSlot.source.id
    })
    expect(joinerDirectSlot.width).toBe(24)
    expect(joinerNestedSlot.width).toBe(37)

    const midOverrides = joinerOuterInstance.overrides[`${outerMidInstance.source.id}:overrides`]
    expect(isRecord(midOverrides)).toBe(true)
    if (!isRecord(midOverrides)) return
    const innerOverrides = midOverrides[`${midInnerInstance.source.id}:overrides`]
    expect(isRecord(innerOverrides)).toBe(true)
    if (!isRecord(innerOverrides)) return
    expect(innerOverrides[`${innerSlot.source.id}:width`]).toBe(37)
  })
})
