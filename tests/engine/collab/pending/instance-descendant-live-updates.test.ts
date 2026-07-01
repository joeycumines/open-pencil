import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  bindCollabGraphEvents,
  findInstanceDescendantByStableId,
  isRecord
} from '@/app/collab/yjs-sync'

import {
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc,
  type TestStore
} from '#tests/engine/collab/helpers'
import { firstPageId } from '#tests/helpers/scene'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function localNodeForStableId(store: TestStore, stableId: string) {
  const localId = store.graph.getSyncState().remoteToLocal.get(stableId)
  return localId === undefined ? undefined : store.graph.getNode(localId)
}

function createInstanceWithRect(store: TestStore) {
  const pageId = firstPageId(store.graph)
  const component = store.graph.createNode('COMPONENT', pageId, {
    name: 'Counter Component',
    width: 88,
    height: 24
  })
  const componentRect = store.graph.createNode('RECTANGLE', component.id, {
    name: 'Counter Fill',
    width: 88,
    height: 24,
    x: 0
  })
  const instance = store.graph.createInstance(component.id, pageId, {
    name: 'Counter Instance',
    x: 144
  })
  if (instance === null) throw new Error('expected populated instance')
  const instanceRect = findInstanceDescendantByStableId(
    store.graph,
    instance,
    componentRect.source.id
  )
  if (instanceRect === undefined) throw new Error('expected instance rectangle')
  return { component, componentRect, instance, instanceRect }
}

function bindHostEvents(store: TestStore, ydoc: Y.Doc, sync: ReturnType<typeof createTestYjsSync>) {
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

describe('live populated instance descendant sync', () => {
  test('reverting a descendant edit to the component value clears the stable override', () => {
    const hostStore = createTestStore()
    const { component, componentRect, instance, instanceRect } = createInstanceWithRect(hostStore)
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)

    const unbind = bindHostEvents(hostStore, hostYdoc, hostSync)
    const overrideKey = `${componentRect.source.id}:width`

    hostStore.graph.updateNode(instanceRect.id, { width: 104 })
    encodeAndApply(hostYdoc, joinerYdoc)
    expect(Object.hasOwn(instance.overrides, overrideKey)).toBe(true)
    const joinerEditedInstance = localNodeForStableId(joinerStore, instance.source.id)
    const joinerEditedRect =
      joinerEditedInstance?.type === 'INSTANCE'
        ? findInstanceDescendantByStableId(
            joinerStore.graph,
            joinerEditedInstance,
            componentRect.source.id
          )
        : undefined
    expect(joinerEditedInstance?.overrides[overrideKey]).toBe(104)
    expect(joinerEditedRect?.width).toBe(104)

    hostStore.graph.updateNode(instanceRect.id, { width: componentRect.width })
    unbind()
    encodeAndApply(hostYdoc, joinerYdoc)

    const remoteInstanceOverrides = asRecord(
      hostSync.ynodes.get(instance.source.id)?.get('overrides')
    )
    expect(Object.hasOwn(instance.overrides, overrideKey)).toBe(false)
    expect(remoteInstanceOverrides).toEqual({})
    expect(Object.hasOwn(remoteInstanceOverrides ?? {}, overrideKey)).toBe(false)
    const joinerClearedInstance = localNodeForStableId(joinerStore, instance.source.id)
    const joinerClearedRect =
      joinerClearedInstance?.type === 'INSTANCE'
        ? findInstanceDescendantByStableId(
            joinerStore.graph,
            joinerClearedInstance,
            componentRect.source.id
          )
        : undefined
    expect(joinerClearedInstance?.overrides).toEqual({})
    expect(joinerClearedRect?.width).toBe(componentRect.width)

    hostStore.graph.updateNode(componentRect.id, { width: 120 })
    hostStore.graph.syncInstances(component.id)
    const syncedInstanceRect = findInstanceDescendantByStableId(
      hostStore.graph,
      instance,
      componentRect.source.id
    )
    expect(syncedInstanceRect?.width).toBe(120)
  })

  test('live inherited instance variable deletion publishes the override marker', () => {
    const hostStore = createTestStore()
    const pageId = firstPageId(hostStore.graph)
    const collection = hostStore.graph.createCollection('Numbers')
    const variable = hostStore.graph.createVariable('Opacity', 'FLOAT', collection.id, 0.5)
    const component = hostStore.graph.createNode('COMPONENT', pageId, {
      name: 'Variable Card',
      opacity: 1
    })
    hostStore.graph.bindVariable(component.id, 'opacity', variable.id)
    const instance = hostStore.graph.createInstance(component.id, pageId, {
      name: 'Variable Card Instance'
    })
    if (instance === null) throw new Error('expected populated instance')
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const unbind = bindHostEvents(hostStore, hostYdoc, hostSync)

    hostStore.graph.removeVariable(variable.id)
    unbind()

    const remoteInstanceOverrides = asRecord(
      hostSync.ynodes.get(instance.source.id)?.get('overrides')
    )
    expect(instance.overrides.boundVariables).toBe(true)
    expect(remoteInstanceOverrides?.boundVariables).toBe(true)

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerComponent = localNodeForStableId(joinerStore, component.source.id)
    const joinerInstance = localNodeForStableId(joinerStore, instance.source.id)
    expect(joinerInstance?.overrides.boundVariables).toBe(true)

    if (joinerComponent === undefined || joinerInstance === undefined) return
    const nextCollection = joinerStore.graph.createCollection('Replacement')
    const nextVariable = joinerStore.graph.createVariable(
      'Replacement Opacity',
      'FLOAT',
      nextCollection.id,
      0.25
    )
    joinerStore.graph.bindVariable(joinerComponent.id, 'opacity', nextVariable.id)
    joinerStore.graph.syncInstances(joinerComponent.id)
    expect(joinerInstance.boundVariables).toEqual({})
  })

  test('live inherited descendant variable deletion preserves empty override markers', () => {
    const hostStore = createTestStore()
    const pageId = firstPageId(hostStore.graph)
    const collection = hostStore.graph.createCollection('Colors')
    const variable = hostStore.graph.createVariable('Fill', 'COLOR', collection.id, {
      r: 0.1,
      g: 0.2,
      b: 0.3,
      a: 1
    })
    const component = hostStore.graph.createNode('COMPONENT', pageId, {
      name: 'Variable Child Component'
    })
    const componentRect = hostStore.graph.createNode('RECTANGLE', component.id, {
      name: 'Variable Child',
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.4, g: 0.5, b: 0.6, a: 1 },
          visible: true,
          opacity: 1
        }
      ]
    })
    hostStore.graph.bindVariable(componentRect.id, 'fills/0/color', variable.id)
    const instance = hostStore.graph.createInstance(component.id, pageId, {
      name: 'Variable Child Instance'
    })
    if (instance === null) throw new Error('expected populated instance')
    const instanceRect = findInstanceDescendantByStableId(
      hostStore.graph,
      instance,
      componentRect.source.id
    )
    if (instanceRect === undefined) throw new Error('expected populated rectangle')
    expect(instanceRect.boundVariables['fills/0/color']).toBe(variable.id)

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const unbind = bindHostEvents(hostStore, hostYdoc, hostSync)
    const overrideKey = `${componentRect.source.id}:boundVariables`

    hostStore.graph.removeVariable(variable.id)
    unbind()

    const remoteInstanceOverrides = asRecord(
      hostSync.ynodes.get(instance.source.id)?.get('overrides')
    )
    expect(instance.overrides[overrideKey]).toEqual({})
    expect(remoteInstanceOverrides?.[overrideKey]).toEqual({})

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    const joinerComponent = localNodeForStableId(joinerStore, component.source.id)
    const joinerComponentRect = localNodeForStableId(joinerStore, componentRect.source.id)
    const joinerInstance = localNodeForStableId(joinerStore, instance.source.id)
    expect(joinerInstance?.overrides[overrideKey]).toEqual({})
    if (
      joinerComponent === undefined ||
      joinerComponentRect === undefined ||
      joinerInstance === undefined
    ) {
      return
    }

    const replacementCollection = joinerStore.graph.createCollection('Replacement Colors')
    const replacementVariable = joinerStore.graph.createVariable(
      'Replacement Fill',
      'COLOR',
      replacementCollection.id,
      { r: 0.8, g: 0.7, b: 0.6, a: 1 }
    )
    joinerStore.graph.bindVariable(joinerComponentRect.id, 'fills/0/color', replacementVariable.id)
    joinerStore.graph.syncInstances(joinerComponent.id)
    const joinerInstanceRect = findInstanceDescendantByStableId(
      joinerStore.graph,
      joinerInstance,
      componentRect.source.id
    )
    expect(joinerInstanceRect?.boundVariables['fills/0/color']).toBeUndefined()
  })
})
