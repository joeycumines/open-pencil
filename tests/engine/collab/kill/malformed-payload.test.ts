import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { copyEffects, copyFills } from '@open-pencil/scene-graph/copy'

import {
  applyInstanceOverrideValuesToChildren,
  findInstanceDescendantByStableId
} from '@/app/collab/yjs-sync'

import {
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '#tests/engine/collab/helpers'
import { firstPageId } from '#tests/helpers/scene'

function createInstanceOverrideFixture(store: ReturnType<typeof createTestStore>) {
  const page = firstPageId(store.graph)
  const component = store.graph.createNode('COMPONENT', page, {
    name: 'Card',
    width: 120,
    height: 40
  })
  const componentChild = store.graph.createNode('RECTANGLE', component.id, {
    name: 'Card slot',
    width: 120,
    height: 40
  })
  const instance = store.graph.createInstance(component.id, page, {
    name: 'Card instance',
    x: 200
  })
  if (instance === null) throw new Error('expected instance')
  const componentChildStableId = componentChild.source.id
  if (componentChildStableId === undefined) throw new Error('expected stable component child')
  return { componentChildStableId, instanceStableId: instance.source.id }
}

function expectJoinerInstanceChild(
  store: ReturnType<typeof createTestStore>,
  instanceStableId: string,
  childStableId: string
) {
  const instanceId = store.graph.getSyncState().remoteToLocal.get(instanceStableId)
  expect(instanceId).toBeDefined()
  if (instanceId === undefined) throw new Error('missing instance mapping')
  const instance = store.graph.getNode(instanceId)
  expect(instance?.type).toBe('INSTANCE')
  if (instance?.type !== 'INSTANCE') throw new Error('missing instance')
  const child = findInstanceDescendantByStableId(store.graph, instance, childStableId)
  expect(child).toBeDefined()
  if (child === undefined) throw new Error('missing instance child')
  return child
}

function createNestedInstanceOverrideFixture(store: ReturnType<typeof createTestStore>) {
  const page = firstPageId(store.graph)
  const innerComponent = store.graph.createNode('COMPONENT', page, {
    name: 'Inner',
    width: 24,
    height: 16
  })
  const innerSlot = store.graph.createNode('RECTANGLE', innerComponent.id, {
    name: 'Inner slot',
    width: 24,
    height: 16
  })
  const outerComponent = store.graph.createNode('COMPONENT', page, {
    name: 'Outer',
    width: 160,
    height: 80
  })
  const nestedInstance = store.graph.createInstance(innerComponent.id, outerComponent.id, {
    name: 'Nested inner instance'
  })
  if (nestedInstance === null) throw new Error('expected nested instance')
  const outerInstance = store.graph.createInstance(outerComponent.id, page, {
    name: 'Outer instance'
  })
  if (outerInstance === null) throw new Error('expected outer instance')
  return {
    innerSlotStableId: innerSlot.source.id,
    nestedInstanceStableId: nestedInstance.source.id,
    outerInstance
  }
}

/**
 * C-09: assumeFigmaPayload unchecked `as` cast — no validation of remote
 * Yjs peer data.
 *
 * assumeFigmaPayload in serialize.ts casts `unknown` to `SourceMetadata['fig']`
 * with only an `isRecord()` check. Malformed data from a buggy or malicious
 * peer is accepted without validation, causing type confusion downstream.
 *
 * How it fails: A peer sends sourceFig with symbolOverrides as a string
 * instead of an array. assumeFigmaPayload casts it through. The receiver
 * stores it and later code that iterates symbolOverrides crashes or
 * produces wrong results.
 *
 * Fix that makes it pass: Replace assumeFigmaPayload with parseFigmaPayload
 * that validates field types before accepting the data.
 */
describe('C-09: Malformed sourceFig payload accepted without validation', () => {
  test('sourceFig with wrong-typed symbolOverrides should be rejected', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const node = hostStore.graph.createNode('RECTANGLE', hostPage, {
      name: 'Box',
      width: 100,
      height: 100,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ]
    })
    const nodeStableId = node.source.id
    expect(nodeStableId).toBeDefined()
    if (nodeStableId === undefined) return

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    // Corrupt the sourceFig on the host's Yjs doc
    // Set symbolOverrides to a string instead of an array
    const ynode = hostSync.ynodes.get(nodeStableId)
    expect(ynode).toBeDefined()
    if (!ynode) return

    const maliciousSourceFig = JSON.stringify({
      rawSize: null,
      rawTransform: null,
      rawNodeFields: {},
      layout: null,
      symbolOverrides: 'NOT_AN_ARRAY', // wrong type — should be rejected
      componentPropAssignments: [],
      derivedSymbolData: [],
      derivedSymbolDataLayoutVersion: null,
      uniformScaleFactor: null
    })
    ynode.set('sourceFig', maliciousSourceFig)

    // Joiner receives the malformed data
    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    // The joiner should have rejected the malformed sourceFig
    // and used default values instead
    const joinerNode = joinerStore.graph.getNode(nodeStableId)
    expect(joinerNode).toBeDefined()
    if (!joinerNode) return

    // FAILS: symbolOverrides is 'NOT_AN_ARRAY' (string) instead of []
    // After fix: parseFigmaPayload returns undefined, source.fig uses defaults
    expect(Array.isArray(joinerNode.source.fig?.symbolOverrides)).toBe(true)
    expect(joinerNode.source.fig?.symbolOverrides).not.toBe('NOT_AN_ARRAY')
  })

  test('malformed create payload fields are ignored instead of type-confusing scene nodes', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const node = hostStore.graph.createNode('RECTANGLE', hostPage, {
      name: 'Box',
      width: 123,
      height: 77
    })
    const nodeStableId = node.source.id
    expect(nodeStableId).toBeDefined()
    if (nodeStableId === undefined) return

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const ynode = hostSync.ynodes.get(nodeStableId)
    expect(ynode).toBeDefined()
    if (!ynode) return

    ynode.set('type', 'NOT_A_NODE_TYPE')
    ynode.set('width', 'wide')
    ynode.set('height', { px: 77 })
    ynode.set('visible', 'yes')
    ynode.set('layoutMode', 'SIDEWAYS')
    ynode.set('childIds', JSON.stringify(['child-a', 12]))
    ynode.set('fills', JSON.stringify([{ type: 'SOLID', color: 'red', opacity: 'solid' }]))
    ynode.set('effects', JSON.stringify({ type: 'DROP_SHADOW' }))
    ynode.set('boundVariables', JSON.stringify(['not', 'a', 'record']))

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    const joinerNode = joinerStore.graph.getNode(nodeStableId)
    expect(joinerNode).toBeDefined()
    if (!joinerNode) return

    expect(joinerNode.type).toBe('FRAME')
    expect(typeof joinerNode.width).toBe('number')
    expect(Number.isFinite(joinerNode.width)).toBe(true)
    expect(typeof joinerNode.height).toBe('number')
    expect(Number.isFinite(joinerNode.height)).toBe(true)
    expect(joinerNode.visible).toBe(true)
    expect(joinerNode.layoutMode).toBe('NONE')
    expect(Array.isArray(joinerNode.fills)).toBe(true)
    expect(Array.isArray(joinerNode.effects)).toBe(true)
    expect(joinerNode.boundVariables).toEqual({})
  })

  test('malformed update payload fields leave existing scene-node values intact', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const node = hostStore.graph.createNode('RECTANGLE', hostPage, {
      name: 'Box',
      width: 144,
      height: 96,
      visible: false
    })
    const nodeStableId = node.source.id
    expect(nodeStableId).toBeDefined()
    if (nodeStableId === undefined) return

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)

    const initialJoinerNode = joinerStore.graph.getNode(nodeStableId)
    expect(initialJoinerNode).toBeDefined()
    if (!initialJoinerNode) return
    const initialFills = copyFills(initialJoinerNode.fills)
    const initialEffects = copyEffects(initialJoinerNode.effects)

    const ynode = hostSync.ynodes.get(nodeStableId)
    expect(ynode).toBeDefined()
    if (!ynode) return
    ynode.set('width', 'wide')
    ynode.set('height', Number.NaN)
    ynode.set('visible', 'false')
    ynode.set('layoutMode', 'SIDEWAYS')
    ynode.set('fills', JSON.stringify({ type: 'SOLID' }))
    ynode.set('effects', JSON.stringify([{ type: 'DROP_SHADOW', color: 'black' }]))
    ynode.set('boundVariables', JSON.stringify(['wrong']))

    encodeAndApply(hostYdoc, joinerYdoc)

    const updatedJoinerNode = joinerStore.graph.getNode(nodeStableId)
    expect(updatedJoinerNode).toBeDefined()
    if (!updatedJoinerNode) return

    expect(updatedJoinerNode.width).toBe(144)
    expect(updatedJoinerNode.height).toBe(96)
    expect(updatedJoinerNode.visible).toBe(false)
    expect(updatedJoinerNode.layoutMode).toBe('NONE')
    expect(updatedJoinerNode.fills).toEqual(initialFills)
    expect(updatedJoinerNode.effects).toEqual(initialEffects)
    expect(updatedJoinerNode.boundVariables).toEqual({})
  })

  test('nested malicious fill keys are rejected and not re-emitted', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const node = hostStore.graph.createNode('RECTANGLE', hostPage, {
      name: 'Box',
      width: 100,
      height: 100,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ]
    })
    const nodeStableId = node.source.id
    expect(nodeStableId).toBeDefined()
    if (nodeStableId === undefined) return
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()
    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)
    const initialJoinerNode = joinerStore.graph.getNode(nodeStableId)
    expect(initialJoinerNode).toBeDefined()
    if (!initialJoinerNode) return
    const initialFills = copyFills(initialJoinerNode.fills)
    const ynode = hostSync.ynodes.get(nodeStableId)
    expect(ynode).toBeDefined()
    if (!ynode) return
    const maliciousNestedValue = new Y.Map<unknown>()
    maliciousNestedValue.set('x', 1)
    const initialFill = copyFills(initialFills)[0]
    expect(initialFill).toBeDefined()
    if (initialFill === undefined) return
    ynode.set('fills', [
      {
        ...initialFill,
        color: { ...initialFill.color, 'g b': maliciousNestedValue },
        evil: maliciousNestedValue
      }
    ])
    encodeAndApply(hostYdoc, joinerYdoc)
    const updatedJoinerNode = joinerStore.graph.getNode(nodeStableId)
    expect(updatedJoinerNode).toBeDefined()
    if (!updatedJoinerNode) return
    expect(updatedJoinerNode.fills).toEqual(initialFills)
    joinerSync.syncNodeToYjs(updatedJoinerNode.id)
    const outboundFills = joinerSync.ynodes.get(nodeStableId)?.get('fills')
    expect(typeof outboundFills).toBe('string')
    expect(outboundFills).not.toContain('evil')
    expect(outboundFills).not.toContain('g b')
    expect(outboundFills).not.toContain('_map')
  })

  test('malformed create overrides are dropped before applying to instance descendants', () => {
    const hostStore = createTestStore()
    const { componentChildStableId, instanceStableId } = createInstanceOverrideFixture(hostStore)

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const ynode = hostSync.ynodes.get(instanceStableId)
    expect(ynode).toBeDefined()
    if (!ynode) return
    ynode.set(
      'overrides',
      JSON.stringify({
        [`${componentChildStableId}:width`]: 'wide',
        [`${componentChildStableId}:height`]: 64
      })
    )

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    const joinerChild = expectJoinerInstanceChild(
      joinerStore,
      instanceStableId,
      componentChildStableId
    )
    expect(joinerChild.width).toBe(120)
    expect(joinerChild.height).toBe(64)
  })

  test('malformed update overrides do not type-confuse existing instance descendants', () => {
    const hostStore = createTestStore()
    const { componentChildStableId, instanceStableId } = createInstanceOverrideFixture(hostStore)

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)

    const ynode = hostSync.ynodes.get(instanceStableId)
    expect(ynode).toBeDefined()
    if (!ynode) return
    ynode.set(
      'overrides',
      JSON.stringify({
        [`${componentChildStableId}:width`]: 'wide',
        [`${componentChildStableId}:height`]: 72
      })
    )

    encodeAndApply(hostYdoc, joinerYdoc)

    const joinerChild = expectJoinerInstanceChild(
      joinerStore,
      instanceStableId,
      componentChildStableId
    )
    expect(joinerChild.width).toBe(120)
    expect(joinerChild.height).toBe(72)
  })

  test('Yjs shared types are rejected as remote override records', () => {
    const hostStore = createTestStore()
    const { componentChildStableId, instanceStableId } = createInstanceOverrideFixture(hostStore)

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const ynode = hostSync.ynodes.get(instanceStableId)
    expect(ynode).toBeDefined()
    if (!ynode) return
    const maliciousOverrides = new Y.Map<unknown>()
    maliciousOverrides.set(`${componentChildStableId}:width`, 'wide')
    ynode.set('overrides', maliciousOverrides)

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    const joinerInstanceId = joinerStore.graph.getSyncState().remoteToLocal.get(instanceStableId)
    expect(joinerInstanceId).toBeDefined()
    if (joinerInstanceId === undefined) return
    const joinerInstance = joinerStore.graph.getNode(joinerInstanceId)
    expect(joinerInstance?.type).toBe('INSTANCE')
    if (joinerInstance?.type !== 'INSTANCE') return

    const joinerChild = expectJoinerInstanceChild(
      joinerStore,
      instanceStableId,
      componentChildStableId
    )
    expect(joinerChild.width).toBe(120)
    expect(joinerInstance.overrides).toEqual({})
    expect(() => joinerSync.syncNodeToYjs(joinerInstance.id)).not.toThrow()
  })

  test('bare override markers reject Yjs shared-type payloads', () => {
    const hostStore = createTestStore()
    const { instanceStableId } = createInstanceOverrideFixture(hostStore)

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const ynode = hostSync.ynodes.get(instanceStableId)
    expect(ynode).toBeDefined()
    if (!ynode) return
    const maliciousBoundVariables = new Y.Map<unknown>()
    maliciousBoundVariables.set('width', 'host-local-variable-id')
    ynode.set('overrides', { boundVariables: maliciousBoundVariables })

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    const joinerInstanceId = joinerStore.graph.getSyncState().remoteToLocal.get(instanceStableId)
    expect(joinerInstanceId).toBeDefined()
    if (joinerInstanceId === undefined) return
    const joinerInstance = joinerStore.graph.getNode(joinerInstanceId)
    expect(joinerInstance?.type).toBe('INSTANCE')
    if (joinerInstance?.type !== 'INSTANCE') return

    expect(joinerInstance.overrides).toEqual({})
    expect(() => joinerSync.syncNodeToYjs(joinerInstance.id)).not.toThrow()
  })

  test('malformed childless bare override keys are dropped and not re-emitted', () => {
    const hostStore = createTestStore()
    const { instanceStableId } = createInstanceOverrideFixture(hostStore)

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const ynode = hostSync.ynodes.get(instanceStableId)
    expect(ynode).toBeDefined()
    if (!ynode) return
    ynode.set('overrides', { ':boundVariables': true })

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    const joinerInstanceId = joinerStore.graph.getSyncState().remoteToLocal.get(instanceStableId)
    expect(joinerInstanceId).toBeDefined()
    if (joinerInstanceId === undefined) return
    const joinerInstance = joinerStore.graph.getNode(joinerInstanceId)
    expect(joinerInstance?.type).toBe('INSTANCE')
    if (joinerInstance?.type !== 'INSTANCE') return

    expect(joinerInstance.overrides).toEqual({})
    joinerSync.syncNodeToYjs(joinerInstance.id)
    expect(joinerSync.ynodes.get(instanceStableId)?.get('overrides')).toEqual({})
  })

  test('unknown child override props reject Yjs shared-type payloads before storing', () => {
    const hostStore = createTestStore()
    const { componentChildStableId, instanceStableId } = createInstanceOverrideFixture(hostStore)

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const ynode = hostSync.ynodes.get(instanceStableId)
    expect(ynode).toBeDefined()
    if (!ynode) return
    const maliciousUnknown = new Y.Map<unknown>()
    maliciousUnknown.set('x', 1)
    ynode.set('overrides', {
      [`${componentChildStableId}:notARealSceneProp`]: maliciousUnknown,
      [`${componentChildStableId}:componentId`]: 'fake-component-id',
      [`${componentChildStableId}:height`]: 64
    })

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    const joinerInstanceId = joinerStore.graph.getSyncState().remoteToLocal.get(instanceStableId)
    expect(joinerInstanceId).toBeDefined()
    if (joinerInstanceId === undefined) return
    const joinerInstance = joinerStore.graph.getNode(joinerInstanceId)
    expect(joinerInstance?.type).toBe('INSTANCE')
    if (joinerInstance?.type !== 'INSTANCE') return

    expect(joinerInstance.overrides).toEqual({ [`${componentChildStableId}:height`]: 64 })
    expect(() => joinerSync.syncNodeToYjs(joinerInstance.id)).not.toThrow()
  })

  test('defensive nested override application sanitizes malformed nested overrides before storing', () => {
    const store = createTestStore()
    const { innerSlotStableId, nestedInstanceStableId, outerInstance } =
      createNestedInstanceOverrideFixture(store)

    outerInstance.overrides = {
      [`${nestedInstanceStableId}:overrides`]: {
        boundVariables: new Y.Map<unknown>(),
        [`${innerSlotStableId}:notARealSceneProp`]: new Y.Map<unknown>(),
        [`${innerSlotStableId}:componentId`]: 'fake-component-id',
        [`${innerSlotStableId}:width`]: 'wide',
        [`${innerSlotStableId}:height`]: 37
      }
    }

    applyInstanceOverrideValuesToChildren(store.graph, outerInstance)

    const nestedInstance = findInstanceDescendantByStableId(
      store.graph,
      outerInstance,
      nestedInstanceStableId
    )
    expect(nestedInstance?.type).toBe('INSTANCE')
    if (nestedInstance?.type !== 'INSTANCE') return

    const innerSlot = findInstanceDescendantByStableId(
      store.graph,
      nestedInstance,
      innerSlotStableId
    )
    expect(innerSlot).toBeDefined()
    if (innerSlot === undefined) return

    expect(innerSlot.width).toBe(24)
    expect(innerSlot.height).toBe(37)
    expect(nestedInstance.overrides).toEqual({ [`${innerSlotStableId}:height`]: 37 })
  })
})
