import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  bindCollabGraphEvents,
  findInstanceDescendantByStableId,
  isRecord,
  stableIdForCollection,
  stableIdForVariable
} from '@/app/collab/yjs-sync'

import {
  cloneYnode,
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc,
  type TestStore
} from '#tests/engine/collab/helpers'
import { firstPageId } from '#tests/helpers/scene'

function createPopulatedInstanceFixture(hostStore: TestStore) {
  const hostPage = firstPageId(hostStore.graph)
  const component = hostStore.graph.createNode('COMPONENT', hostPage, {
    name: 'Button',
    width: 120,
    height: 40
  })
  const componentChild = hostStore.graph.createNode('RECTANGLE', component.id, {
    name: 'Button Bg',
    width: 120,
    height: 40,
    x: 0
  })
  const instance = hostStore.graph.createInstance(component.id, hostPage, {
    name: 'Button Instance',
    x: 200
  })
  if (instance === null) throw new Error('expected createInstance to return an instance')
  const instanceChild = findInstanceDescendantByStableId(
    hostStore.graph,
    instance,
    componentChild.source.id
  )
  if (instanceChild === undefined) throw new Error('expected populated instance child')
  return { component, componentChild, instance, instanceChild }
}

function ymapRecordValue(ymap: Y.Map<unknown> | undefined, key: string) {
  const value = ymap?.get(key)
  return isRecord(value) ? value : undefined
}

function cloneYmapEntries(
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

function cloneHostInstanceSkeleton(
  hostSync: ReturnType<typeof createTestYjsSync>,
  joinerSync: ReturnType<typeof createTestYjsSync>,
  ids: {
    rootStableId: string
    pageStableId: string
    componentStableId: string
    instanceStableId: string
    componentChildStableId: string
  }
): void {
  cloneYnode(hostSync.ynodes.get(ids.rootStableId), joinerSync.ynodes, ids.rootStableId)
  cloneYnode(hostSync.ynodes.get(ids.pageStableId), joinerSync.ynodes, ids.pageStableId)
  cloneYnode(hostSync.ynodes.get(ids.componentStableId), joinerSync.ynodes, ids.componentStableId)
  cloneYnode(hostSync.ynodes.get(ids.instanceStableId), joinerSync.ynodes, ids.instanceStableId)
  cloneYnode(
    hostSync.ynodes.get(ids.componentChildStableId),
    joinerSync.ynodes,
    ids.componentChildStableId
  )
}

function localNodeForStableId(store: TestStore, stableId: string) {
  const localId = store.graph.getSyncState().remoteToLocal.get(stableId)
  return localId === undefined ? undefined : store.graph.getNode(localId)
}

function bindHostGraphEvents(
  store: TestStore,
  ydoc: Y.Doc,
  sync: ReturnType<typeof createTestYjsSync>
): () => void {
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

describe('pending components', () => {
  test('instance arrives before component then materializes when component arrives', () => {
    const hostStore = createTestStore()
    const component = hostStore.graph.createNode('COMPONENT', hostStore.graph.rootId, {
      name: 'Badge',
      width: 40,
      height: 40
    })
    const instance = hostStore.graph.createInstance(component.id, hostStore.graph.rootId)
    expect(instance).toBeDefined()
    if (instance === null) return

    const componentStable = component.source.id
    const instanceStable = instance.source.id

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncNodeToYjs(hostStore.graph.rootId)

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    // Send only the instance to the joiner.
    hostSync.syncNodeToYjs(instance.id)
    const hostInstanceYnode = hostSync.ynodes.get(instanceStable)
    expect(hostInstanceYnode).toBeDefined()
    cloneYnode(hostInstanceYnode, joinerSync.ynodes, instanceStable)

    const joinerState = joinerStore.graph.getSyncState()
    expect([...(joinerState.pendingComponents.get(componentStable) ?? [])]).toContain(
      instanceStable
    )
    expect(joinerStore.graph.getNode(instanceStable)).toBeUndefined()

    // Send the component; the instance should materialize and link to it.
    hostSync.syncNodeToYjs(component.id)
    const hostComponentYnode = hostSync.ynodes.get(componentStable)
    expect(hostComponentYnode).toBeDefined()
    cloneYnode(hostComponentYnode, joinerSync.ynodes, componentStable)

    expect(joinerState.pendingComponents.get(componentStable)).toBeUndefined()
    const localComponentId = joinerState.remoteToLocal.get(componentStable)
    expect(localComponentId).toBeDefined()
    expect(joinerStore.graph.getNode(instanceStable)).toBeDefined()
    expect(joinerStore.graph.getNode(instanceStable).componentId).toBe(localComponentId)
  })

  test('populated instance descendants sync through owning instance overrides', () => {
    const hostStore = createTestStore()
    const { component, componentChild, instance, instanceChild } =
      createPopulatedInstanceFixture(hostStore)

    hostStore.graph.updateNode(instanceChild.id, { name: 'Initial Instance Bg', x: 17 })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const componentChildYnode = hostSync.ynodes.get(componentChild.source.id)
    expect(componentChildYnode?.get('parentId')).toBe(component.source.id)
    expect(componentChildYnode?.get('name')).toBe('Button Bg')

    const instanceYnode = hostSync.ynodes.get(instance.source.id)
    const initialOverrides = ymapRecordValue(instanceYnode, 'overrides')
    expect(initialOverrides?.[`${componentChild.source.id}:name`]).toBe('Initial Instance Bg')
    expect(initialOverrides?.[`${componentChild.source.id}:x`]).toBe(17)

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    const joinerInstance = localNodeForStableId(joinerStore, instance.source.id)
    const joinerComponentChild = localNodeForStableId(joinerStore, componentChild.source.id)
    expect(joinerInstance).toBeDefined()
    expect(joinerComponentChild?.name).toBe('Button Bg')
    if (joinerInstance === undefined) return
    const joinerInstanceChild = findInstanceDescendantByStableId(
      joinerStore.graph,
      joinerInstance,
      componentChild.source.id
    )
    expect(joinerInstanceChild?.name).toBe('Initial Instance Bg')
    expect(joinerInstanceChild?.x).toBe(17)

    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)

    hostStore.graph.updateNode(instanceChild.id, { name: 'Live Instance Bg', x: 33 })
    unbind()

    expect(componentChildYnode?.get('parentId')).toBe(component.source.id)
    expect(componentChildYnode?.get('name')).toBe('Button Bg')
    const liveOverrides = ymapRecordValue(instanceYnode, 'overrides')
    expect(liveOverrides?.[`${componentChild.source.id}:name`]).toBe('Live Instance Bg')
    expect(liveOverrides?.[`${componentChild.source.id}:x`]).toBe(33)

    encodeAndApply(hostYdoc, joinerYdoc)

    expect(joinerComponentChild?.name).toBe('Button Bg')
    expect(joinerInstanceChild?.name).toBe('Live Instance Bg')
    expect(joinerInstanceChild?.x).toBe(33)
  })

  test('populated instance descendant variable bindings remap through overrides', () => {
    const hostStore = createTestStore()
    const { componentChild, instance, instanceChild } = createPopulatedInstanceFixture(hostStore)
    const collection = hostStore.graph.createCollection('Colors')
    const variable = hostStore.graph.createVariable('Primary', 'COLOR', collection.id, {
      r: 0,
      g: 0.5,
      b: 1,
      a: 1
    })

    hostStore.graph.updateNode(instanceChild.id, {
      boundVariables: { fills: variable.id }
    })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const instanceYnode = hostSync.ynodes.get(instance.source.id)
    const overrides = ymapRecordValue(instanceYnode, 'overrides')
    const remoteBoundVariables = overrides?.[`${componentChild.source.id}:boundVariables`]
    expect(remoteBoundVariables).toEqual({ fills: stableIdForVariable(variable) })

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)

    const joinerInstance = localNodeForStableId(joinerStore, instance.source.id)
    expect(joinerInstance).toBeDefined()
    if (joinerInstance === undefined) return
    const joinerInstanceChild = findInstanceDescendantByStableId(
      joinerStore.graph,
      joinerInstance,
      componentChild.source.id
    )
    const stableOverrideKey = `${componentChild.source.id}:boundVariables`
    const runtimeOverrideKey = `${joinerInstanceChild?.id ?? ''}:boundVariables`
    const boundVarId = joinerInstanceChild?.boundVariables.fills
    expect(boundVarId).toBeDefined()
    if (boundVarId === undefined) return

    const joinerVariable = joinerStore.graph.variables.get(boundVarId)
    expect(joinerVariable).toBeDefined()
    if (joinerVariable === undefined) return
    expect(stableIdForVariable(joinerVariable)).toBe(stableIdForVariable(variable))
    expect(joinerInstance.overrides[stableOverrideKey]).toEqual({ fills: boundVarId })
    if (runtimeOverrideKey !== stableOverrideKey) {
      expect(joinerInstance.overrides[runtimeOverrideKey]).toBeUndefined()
    }

    if (joinerInstance.componentId === null) throw new Error('expected linked instance')
    joinerStore.graph.syncInstances(joinerInstance.componentId)
    expect(joinerInstanceChild.boundVariables.fills).toBe(boundVarId)
  })

  test('pending populated instance descendant overrides wait for component children', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const hostPageNode = hostStore.graph.getNode(hostPage)
    if (hostPageNode === undefined) throw new Error('expected host page')
    const { component, componentChild, instance, instanceChild } =
      createPopulatedInstanceFixture(hostStore)
    const collection = hostStore.graph.createCollection('Colors')
    const variable = hostStore.graph.createVariable('Primary', 'COLOR', collection.id, {
      r: 0.2,
      g: 0.3,
      b: 0.4,
      a: 1
    })

    hostStore.graph.updateNode(instanceChild.id, {
      name: 'Delayed Instance Bg',
      x: 44,
      boundVariables: { fills: variable.id }
    })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    cloneYnode(hostSync.ynodes.get(hostRootStable), joinerSync.ynodes, hostRootStable)
    cloneYnode(
      hostSync.ynodes.get(hostPageNode.source.id),
      joinerSync.ynodes,
      hostPageNode.source.id
    )
    cloneYnode(hostSync.ynodes.get(component.source.id), joinerSync.ynodes, component.source.id)
    cloneYnode(hostSync.ynodes.get(instance.source.id), joinerSync.ynodes, instance.source.id)

    const joinerState = joinerStore.graph.getSyncState()
    expect(joinerState.pendingOverrideKeys.get(componentChild.source.id)?.size).toBe(3)
    const joinerInstanceBeforeChild = localNodeForStableId(joinerStore, instance.source.id)
    expect(joinerInstanceBeforeChild?.childIds).toEqual([])

    cloneYnode(
      hostSync.ynodes.get(componentChild.source.id),
      joinerSync.ynodes,
      componentChild.source.id
    )

    expect(joinerState.pendingOverrideKeys.get(componentChild.source.id)).toBeUndefined()
    const joinerInstance = localNodeForStableId(joinerStore, instance.source.id)
    expect(joinerInstance).toBeDefined()
    if (joinerInstance === undefined) return
    const joinerInstanceChild = findInstanceDescendantByStableId(
      joinerStore.graph,
      joinerInstance,
      componentChild.source.id
    )
    expect(joinerInstanceChild?.name).toBe('Delayed Instance Bg')
    expect(joinerInstanceChild?.x).toBe(44)
    expect(joinerInstance.overrides[`${componentChild.source.id}:name`]).toBe('Delayed Instance Bg')
    expect(joinerInstance.overrides[`${componentChild.source.id}:x`]).toBe(44)
    expect(joinerInstance.overrides[`${componentChild.source.id}:boundVariables`]).toEqual({})

    cloneYmapEntries(
      hostSync.ycollections.get(stableIdForCollection(collection)),
      joinerSync.ycollections,
      stableIdForCollection(collection)
    )
    cloneYmapEntries(
      hostSync.yvariables.get(stableIdForVariable(variable)),
      joinerSync.yvariables,
      stableIdForVariable(variable)
    )

    const boundVarId = joinerInstanceChild?.boundVariables.fills
    expect(boundVarId).toBeDefined()
    if (boundVarId === undefined || joinerInstanceChild === undefined) return
    const joinerVariable = joinerStore.graph.variables.get(boundVarId)
    expect(joinerVariable).toBeDefined()
    if (joinerVariable === undefined) return
    expect(stableIdForVariable(joinerVariable)).toBe(stableIdForVariable(variable))
    expect(joinerInstance.overrides[`${componentChild.source.id}:boundVariables`]).toEqual({
      fills: boundVarId
    })

    if (joinerInstance.componentId === null) throw new Error('expected linked instance')
    joinerStore.graph.syncInstances(joinerInstance.componentId)
    expect(joinerInstanceChild.boundVariables.fills).toBe(boundVarId)
  })

  test('pending populated instance descendant variable bindings resolve when variable arrives before collection', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const hostPageNode = hostStore.graph.getNode(hostPage)
    if (hostPageNode === undefined) throw new Error('expected host page')
    const { component, componentChild, instance, instanceChild } =
      createPopulatedInstanceFixture(hostStore)
    const collection = hostStore.graph.createCollection('Colors')
    const variable = hostStore.graph.createVariable('Primary', 'COLOR', collection.id, {
      r: 0.2,
      g: 0.3,
      b: 0.4,
      a: 1
    })

    hostStore.graph.updateNode(instanceChild.id, {
      boundVariables: { fills: variable.id }
    })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    cloneHostInstanceSkeleton(hostSync, joinerSync, {
      rootStableId: hostRootStable,
      pageStableId: hostPageNode.source.id,
      componentStableId: component.source.id,
      instanceStableId: instance.source.id,
      componentChildStableId: componentChild.source.id
    })

    const joinerState = joinerStore.graph.getSyncState()
    const joinerInstance = localNodeForStableId(joinerStore, instance.source.id)
    expect(joinerInstance).toBeDefined()
    if (joinerInstance === undefined) return
    const joinerInstanceChild = findInstanceDescendantByStableId(
      joinerStore.graph,
      joinerInstance,
      componentChild.source.id
    )
    expect(joinerInstance.overrides[`${componentChild.source.id}:boundVariables`]).toEqual({})

    cloneYmapEntries(
      hostSync.yvariables.get(stableIdForVariable(variable)),
      joinerSync.yvariables,
      stableIdForVariable(variable)
    )
    expect(joinerState.pendingVariableCollections.get(stableIdForCollection(collection))).toEqual(
      new Set([stableIdForVariable(variable)])
    )
    expect(joinerState.pendingVariableBindings.get(stableIdForVariable(variable))?.size).toBe(1)

    cloneYmapEntries(
      hostSync.ycollections.get(stableIdForCollection(collection)),
      joinerSync.ycollections,
      stableIdForCollection(collection)
    )

    const boundVarId = joinerInstanceChild?.boundVariables.fills
    expect(boundVarId).toBeDefined()
    if (boundVarId === undefined || joinerInstanceChild === undefined) return
    const joinerVariable = joinerStore.graph.variables.get(boundVarId)
    expect(joinerVariable).toBeDefined()
    if (joinerVariable === undefined) return
    expect(stableIdForVariable(joinerVariable)).toBe(stableIdForVariable(variable))
    expect(joinerInstance.overrides[`${componentChild.source.id}:boundVariables`]).toEqual({
      fills: boundVarId
    })
    expect(
      joinerState.pendingVariableCollections.get(stableIdForCollection(collection))
    ).toBeUndefined()
    expect(joinerState.pendingVariableBindings.get(stableIdForVariable(variable))).toBeUndefined()
  })

  test('live instance self boundVariables override marker survives collab sync', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const component = hostStore.graph.createNode('COMPONENT', hostPage, {
      name: 'Card',
      width: 100,
      height: 40,
      opacity: 1
    })
    const collection = hostStore.graph.createCollection('Numbers')
    const componentVariable = hostStore.graph.createVariable(
      'Component opacity',
      'FLOAT',
      collection.id,
      0.25
    )
    const instanceVariable = hostStore.graph.createVariable(
      'Instance opacity',
      'FLOAT',
      collection.id,
      0.75
    )
    hostStore.graph.bindVariable(component.id, 'opacity', componentVariable.id)
    const instance = hostStore.graph.createInstance(component.id, hostPage)
    expect(instance).toBeDefined()
    if (instance === null) return
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)

    hostStore.graph.bindVariable(instance.id, 'opacity', instanceVariable.id)
    unbind()
    expect(instance.overrides.boundVariables).toBe(true)
    expect(
      ymapRecordValue(hostSync.ynodes.get(instance.source.id), 'overrides')?.boundVariables
    ).toBe(true)

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerInstance = localNodeForStableId(joinerStore, instance.source.id)
    expect(joinerInstance).toBeDefined()
    if (joinerInstance === undefined || joinerInstance.componentId === null) return
    expect(joinerInstance.overrides.boundVariables).toBe(true)

    const beforeSyncVariableId = joinerInstance.boundVariables.opacity
    expect(beforeSyncVariableId).toBeDefined()
    if (beforeSyncVariableId === undefined) return
    const beforeSyncVariable = joinerStore.graph.variables.get(beforeSyncVariableId)
    expect(beforeSyncVariable).toBeDefined()
    if (beforeSyncVariable === undefined) return
    expect(stableIdForVariable(beforeSyncVariable)).toBe(stableIdForVariable(instanceVariable))

    joinerStore.graph.syncInstances(joinerInstance.componentId)
    const afterSyncVariableId = joinerInstance.boundVariables.opacity
    expect(afterSyncVariableId).toBeDefined()
    if (afterSyncVariableId === undefined) return
    const afterSyncVariable = joinerStore.graph.variables.get(afterSyncVariableId)
    expect(afterSyncVariable).toBeDefined()
    if (afterSyncVariable === undefined) return
    expect(stableIdForVariable(afterSyncVariable)).toBe(stableIdForVariable(instanceVariable))
  })

  test('live variable binding on populated instance descendants stays a record override', () => {
    const hostStore = createTestStore()
    const { componentChild, instance, instanceChild } = createPopulatedInstanceFixture(hostStore)
    const collection = hostStore.graph.createCollection('Colors')
    const variable = hostStore.graph.createVariable('Primary', 'COLOR', collection.id, {
      r: 0.1,
      g: 0.2,
      b: 0.3,
      a: 1
    })
    hostStore.graph.updateNode(instanceChild.id, {
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
          visible: true,
          opacity: 1
        }
      ]
    })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    const hostRootStable = makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)

    hostStore.graph.bindVariable(instanceChild.id, 'fills/0/color', variable.id)
    expect(instance.overrides[`${componentChild.source.id}:boundVariables`]).toEqual({
      'fills/0/color': variable.id
    })
    let liveOverrides = ymapRecordValue(hostSync.ynodes.get(instance.source.id), 'overrides')
    expect(liveOverrides?.[`${componentChild.source.id}:boundVariables`]).toEqual({
      'fills/0/color': stableIdForVariable(variable)
    })

    hostStore.graph.updateNode(instanceChild.id, { x: 77 })
    unbind()

    liveOverrides = ymapRecordValue(hostSync.ynodes.get(instance.source.id), 'overrides')
    expect(liveOverrides?.[`${componentChild.source.id}:boundVariables`]).toEqual({
      'fills/0/color': stableIdForVariable(variable)
    })
    expect(liveOverrides?.[`${componentChild.source.id}:x`]).toBe(77)

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)
    expect(joinerStore.graph.getSyncState().remoteRootStableId).toBe(hostRootStable)
    const joinerInstance = localNodeForStableId(joinerStore, instance.source.id)
    expect(joinerInstance).toBeDefined()
    if (joinerInstance === undefined) return
    const joinerInstanceChild = findInstanceDescendantByStableId(
      joinerStore.graph,
      joinerInstance,
      componentChild.source.id
    )
    expect(joinerInstanceChild?.x).toBe(77)
    const boundVarId = joinerInstanceChild?.boundVariables['fills/0/color']
    expect(boundVarId).toBeDefined()
    if (boundVarId === undefined) return
    const joinerVariable = joinerStore.graph.variables.get(boundVarId)
    expect(joinerVariable).toBeDefined()
    if (joinerVariable === undefined) return
    expect(stableIdForVariable(joinerVariable)).toBe(stableIdForVariable(variable))
  })
})
