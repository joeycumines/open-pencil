import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  cloneYnode,
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '#tests/engine/collab/helpers'

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
})
