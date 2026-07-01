import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { findInstanceDescendantByStableId } from '@/app/collab/yjs-sync'

import {
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

function childNamed(store: TestStore, parentId: string | undefined, name: string) {
  if (parentId === undefined) return undefined
  return store.graph
    .getNode(parentId)
    ?.childIds.map((childId) => store.graph.getNode(childId))
    .find((child) => child?.name === name)
}

function requireInstance(node: ReturnType<TestStore['graph']['getNode']>, message: string) {
  if (node?.type !== 'INSTANCE') throw new Error(message)
  return node
}

describe('collab nested instance orphan descendants', () => {
  test('orphaned children below still-backed nested instances keep branch-scoped identities', () => {
    const hostStore = createTestStore()
    const pageId = firstPageId(hostStore.graph)
    const { innerSlot, nestedComponentInstance, outerComponent, outerInstance } =
      createNestedInstanceFixture(hostStore)
    const backingInnerSlot = findInstanceDescendantByStableId(
      hostStore.graph,
      nestedComponentInstance,
      innerSlot.source.id
    )
    if (backingInnerSlot === undefined) throw new Error('expected backing inner slot')
    const secondOuterInstance = hostStore.graph.createInstance(outerComponent.id, pageId, {
      name: 'Second Outer Instance'
    })
    if (secondOuterInstance === null) throw new Error('expected second outer instance')

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)

    hostStore.graph.deleteNode(backingInnerSlot.id, { permanent: true })
    unbind()

    const staleSlotEntries = [...hostSync.ynodes.entries()].filter(
      ([, ynode]) => ynode.get('originalSourceId') === backingInnerSlot.source.id
    )
    expect(staleSlotEntries).toHaveLength(2)
    expect(new Set(staleSlotEntries.map(([key]) => key)).size).toBe(2)

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    const joinerFirstOuter = requireInstance(
      localNodeForStableId(joiner.store, outerInstance.source.id),
      'expected first outer instance'
    )
    const joinerSecondOuter = requireInstance(
      localNodeForStableId(joiner.store, secondOuterInstance.source.id),
      'expected second outer instance'
    )
    const firstNested = requireInstance(
      findInstanceDescendantByStableId(
        joiner.store.graph,
        joinerFirstOuter,
        nestedComponentInstance.source.id
      ),
      'expected first populated nested instance'
    )
    const secondNested = requireInstance(
      findInstanceDescendantByStableId(
        joiner.store.graph,
        joinerSecondOuter,
        nestedComponentInstance.source.id
      ),
      'expected second populated nested instance'
    )
    const firstSlot = childNamed(joiner.store, firstNested.id, innerSlot.name)
    const secondSlot = childNamed(joiner.store, secondNested.id, innerSlot.name)

    expect(firstNested.componentId).not.toBeNull()
    expect(secondNested.componentId).not.toBeNull()
    expect(firstSlot?.parentId).toBe(firstNested.id)
    expect(firstSlot?.componentId).toBeNull()
    expect(secondSlot?.parentId).toBe(secondNested.id)
    expect(secondSlot?.componentId).toBeNull()
    expect(firstSlot?.id).not.toBe(secondSlot?.id)
  })

  test('orphaned nested grandchildren keep unique standalone identities for sibling outer instances', () => {
    const hostStore = createTestStore()
    const pageId = firstPageId(hostStore.graph)
    const { innerSlot, nestedComponentInstance, outerComponent, outerInstance } =
      createNestedInstanceFixture(hostStore)
    const secondOuterInstance = hostStore.graph.createInstance(outerComponent.id, pageId, {
      name: 'Second Outer Instance'
    })
    if (secondOuterInstance === null) throw new Error('expected second outer instance')

    const secondNested = requireInstance(
      findInstanceDescendantByStableId(
        hostStore.graph,
        secondOuterInstance,
        nestedComponentInstance.source.id
      ),
      'expected second populated nested instance'
    )
    const secondInnerSlot = findInstanceDescendantByStableId(
      hostStore.graph,
      secondNested,
      innerSlot.source.id
    )
    if (secondInnerSlot === undefined) throw new Error('expected second populated inner slot')

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)

    hostStore.graph.deleteNode(nestedComponentInstance.id, { permanent: true })
    unbind()

    const staleNestedEntries = [...hostSync.ynodes.entries()].filter(
      ([, ynode]) => ynode.get('originalSourceId') === nestedComponentInstance.source.id
    )
    const staleSlotEntries = [...hostSync.ynodes.entries()].filter(
      ([, ynode]) => ynode.get('originalSourceId') === innerSlot.source.id
    )
    expect(staleNestedEntries).toHaveLength(2)
    expect(staleSlotEntries).toHaveLength(2)
    expect(new Set(staleSlotEntries.map(([key]) => key)).size).toBe(2)

    const staleNestedKeys = new Set(staleNestedEntries.map(([key]) => key))
    const staleSlotParentIds = new Set(staleSlotEntries.map(([, ynode]) => ynode.get('parentId')))
    expect(staleSlotParentIds.size).toBe(2)
    for (const nestedKey of staleNestedKeys) {
      expect(staleSlotParentIds.has(nestedKey)).toBe(true)
    }

    const joiner = observeJoiner()
    encodeAndApply(hostYdoc, joiner.ydoc)
    expect(joiner.store.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    const joinerFirstOuter = requireInstance(
      localNodeForStableId(joiner.store, outerInstance.source.id),
      'expected first outer instance'
    )
    const joinerSecondOuter = requireInstance(
      localNodeForStableId(joiner.store, secondOuterInstance.source.id),
      'expected second outer instance'
    )
    const firstNested = requireInstance(
      childNamed(joiner.store, joinerFirstOuter.id, nestedComponentInstance.name),
      'expected first orphaned nested instance'
    )
    const secondNestedJoiner = requireInstance(
      childNamed(joiner.store, joinerSecondOuter.id, nestedComponentInstance.name),
      'expected second orphaned nested instance'
    )
    const firstSlot = childNamed(joiner.store, firstNested.id, innerSlot.name)
    const secondSlot = childNamed(joiner.store, secondNestedJoiner.id, innerSlot.name)

    expect(firstNested.componentId).toBeNull()
    expect(secondNestedJoiner.componentId).toBeNull()
    expect(firstSlot?.parentId).toBe(firstNested.id)
    expect(firstSlot?.componentId).toBeNull()
    expect(secondSlot?.parentId).toBe(secondNestedJoiner.id)
    expect(secondSlot?.componentId).toBeNull()
    expect(firstSlot?.id).not.toBe(secondSlot?.id)
  })
})
