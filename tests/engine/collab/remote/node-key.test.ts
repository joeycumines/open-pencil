import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  appendRemoteNodeKeySegment,
  applyYnodeToGraph,
  decodeRemoteNodeKey,
  findInstanceDescendantByStableId,
  isMalformedRemoteNodeKey,
  originalStableIdFromRemoteNodeKey,
  rawStableIdFromRemoteNodeKey,
  remoteNodeKeyForStableId,
  stableIdForNode
} from '@/app/collab/yjs-sync'

import { firstPageId } from '#tests/helpers/scene'

import {
  createTestStore,
  createTestYjsSync,
  cloneYnode,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '../helpers'
import { createNestedInstanceFixture, localNodeForStableId } from '../pending/helpers'

function cloneRequiredYnode(
  source: Y.Map<Y.Map<unknown>>,
  target: Y.Map<Y.Map<unknown>>,
  key: string
): void {
  const ynode = source.get(key)
  expect(ynode).toBeDefined()
  if (ynode === undefined) return
  cloneYnode(ynode, target, key)
}

describe('collab remote node key codec', () => {
  test('treats delimiter-looking stable ids as raw node keys unless the versioned codec prefix is present', () => {
    const stableId = 'raw:orphan:{"json":true}:branch:雪'
    const remoteKey = remoteNodeKeyForStableId(stableId)

    expect(remoteKey).toBe(stableId)
    expect(originalStableIdFromRemoteNodeKey(remoteKey)).toBeNull()
    expect(rawStableIdFromRemoteNodeKey(remoteKey)).toBe(stableId)
  })

  test('escapes raw stable ids that collide with the versioned codec prefix', () => {
    const stableId = 'open-pencil:collab-node-key:v1:{"id":"☃"}:orphan:x'
    const remoteKey = remoteNodeKeyForStableId(stableId)
    const decoded = decodeRemoteNodeKey(remoteKey)

    expect(remoteKey).not.toBe(stableId)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.parts).toEqual({ baseStableId: stableId, segments: [] })
    expect(rawStableIdFromRemoteNodeKey(remoteKey)).toBe(stableId)
  })

  test('raw codec-prefix stable ids round-trip through nested populated branch parent routing', () => {
    const host = createTestStore()
    const fixture = createNestedInstanceFixture(host)
    const prefixStableId = 'open-pencil:collab-node-key:v1:{nested-raw}:orphan:x'
    fixture.nestedComponentInstance.source.id = prefixStableId
    fixture.populatedNestedInstance.source.id = prefixStableId
    const custom = host.graph.createNode('RECTANGLE', fixture.populatedNestedInstance.id, {
      name: 'Nested custom prefix path'
    })

    const hostDoc = new Y.Doc()
    const hostSync = createTestYjsSync(host, hostDoc)
    makeHostRootState(host)
    hostSync.syncAllNodesToYjs()

    const joiner = createTestStore()
    const joinerDoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joiner, joinerDoc)
    observeTargetDoc(joiner, joinerDoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostDoc, joinerDoc)

    const joinerOuter = localNodeForStableId(joiner, fixture.outerInstance.source.id)
    expect(joinerOuter?.type).toBe('INSTANCE')
    if (joinerOuter?.type !== 'INSTANCE') return
    const joinerNested = findInstanceDescendantByStableId(joiner.graph, joinerOuter, prefixStableId)
    expect(joinerNested?.type).toBe('INSTANCE')
    if (joinerNested?.type !== 'INSTANCE') return
    const roundTrippedCustom = joinerNested.childIds
      .map((id) => joiner.graph.getNode(id))
      .find((node) => node?.name === custom.name)

    expect(roundTrippedCustom?.parentId).toBe(joinerNested.id)
  })

  test('raw codec-prefix stable ids round-trip through populated-descendant overrides', () => {
    const host = createTestStore()
    const pageId = firstPageId(host.graph)
    const component = host.graph.createNode('COMPONENT', pageId, { name: 'Prefix Component' })
    const child = host.graph.createNode('RECTANGLE', component.id, { name: 'Prefix Child', x: 0 })
    const prefixStableId = 'open-pencil:collab-node-key:v1:{child-raw}:orphan:x'
    child.source.id = prefixStableId
    const instance = host.graph.createInstance(component.id, pageId, { name: 'Prefix Instance' })
    expect(instance?.type).toBe('INSTANCE')
    if (instance?.type !== 'INSTANCE') return
    const instanceChild = findInstanceDescendantByStableId(host.graph, instance, prefixStableId)
    expect(instanceChild).toBeDefined()
    if (instanceChild === undefined) return
    instanceChild.source.id = prefixStableId
    host.graph.updateNode(instanceChild.id, { x: 77 })

    const hostDoc = new Y.Doc()
    const hostSync = createTestYjsSync(host, hostDoc)
    makeHostRootState(host)
    hostSync.syncAllNodesToYjs()

    const joiner = createTestStore()
    const joinerDoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joiner, joinerDoc)
    observeTargetDoc(joiner, joinerDoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostDoc, joinerDoc)

    const joinerInstanceId = joiner.graph.getSyncState().remoteToLocal.get(instance.source.id)
    const joinerInstance =
      joinerInstanceId === undefined ? undefined : joiner.graph.getNode(joinerInstanceId)
    expect(joinerInstance?.type).toBe('INSTANCE')
    if (joinerInstance?.type !== 'INSTANCE') return
    const joinerChild = findInstanceDescendantByStableId(
      joiner.graph,
      joinerInstance,
      prefixStableId
    )

    expect(joinerChild?.x).toBe(77)
    expect(joinerInstance.overrides[`${prefixStableId}:x`]).toBe(77)
  })

  test('raw codec-prefix stable ids localize when pending populated-descendant overrides release', () => {
    const host = createTestStore()
    const pageId = firstPageId(host.graph)
    const page = host.graph.getNode(pageId)
    expect(page).toBeDefined()
    if (page === undefined) return
    const component = host.graph.createNode('COMPONENT', pageId, {
      name: 'Pending Prefix Component'
    })
    const child = host.graph.createNode('RECTANGLE', component.id, {
      name: 'Pending Prefix Child',
      width: 20
    })
    const prefixStableId = 'open-pencil:collab-node-key:v1:{pending-child}:orphan:x'
    child.source.id = prefixStableId
    const instance = host.graph.createInstance(component.id, pageId, {
      name: 'Pending Prefix Instance'
    })
    expect(instance?.type).toBe('INSTANCE')
    if (instance?.type !== 'INSTANCE') return
    const instanceChild = findInstanceDescendantByStableId(host.graph, instance, prefixStableId)
    expect(instanceChild).toBeDefined()
    if (instanceChild === undefined) return
    instanceChild.source.id = prefixStableId
    host.graph.updateNode(instanceChild.id, { width: 77 })

    const hostDoc = new Y.Doc()
    const hostSync = createTestYjsSync(host, hostDoc)
    const rootRemoteId = makeHostRootState(host)
    hostSync.syncAllNodesToYjs()
    const pageRemoteId = remoteNodeKeyForStableId(stableIdForNode(page))
    const componentRemoteId = remoteNodeKeyForStableId(stableIdForNode(component))
    const instanceRemoteId = remoteNodeKeyForStableId(stableIdForNode(instance))
    const childRemoteId = remoteNodeKeyForStableId(prefixStableId)
    expect(childRemoteId).not.toBe(prefixStableId)

    const joiner = createTestStore()
    const joinerDoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joiner, joinerDoc)
    observeTargetDoc(joiner, joinerDoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    cloneRequiredYnode(hostSync.ynodes, joinerSync.ynodes, rootRemoteId)
    cloneRequiredYnode(hostSync.ynodes, joinerSync.ynodes, pageRemoteId)
    cloneRequiredYnode(hostSync.ynodes, joinerSync.ynodes, componentRemoteId)
    cloneRequiredYnode(hostSync.ynodes, joinerSync.ynodes, instanceRemoteId)
    expect(joiner.graph.getSyncState().pendingOverrideKeys.has(childRemoteId)).toBe(true)
    cloneRequiredYnode(hostSync.ynodes, joinerSync.ynodes, childRemoteId)

    const joinerInstanceId = joiner.graph.getSyncState().remoteToLocal.get(instanceRemoteId)
    const joinerInstance =
      joinerInstanceId === undefined ? undefined : joiner.graph.getNode(joinerInstanceId)
    expect(joinerInstance?.type).toBe('INSTANCE')
    if (joinerInstance?.type !== 'INSTANCE') return
    const joinerChild = findInstanceDescendantByStableId(
      joiner.graph,
      joinerInstance,
      prefixStableId
    )
    expect(joinerChild?.width).toBe(77)
    expect(joinerInstance.overrides[`${prefixStableId}:width`]).toBe(77)
    expect(joinerInstance.overrides[`${childRemoteId}:width`]).toBeUndefined()
    expect(joinerInstance.componentId).not.toBeNull()
    if (joinerInstance.componentId === null) return
    joiner.graph.syncInstances(joinerInstance.componentId)
    const resyncedChild = findInstanceDescendantByStableId(
      joiner.graph,
      joinerInstance,
      prefixStableId
    )
    expect(resyncedChild?.width).toBe(77)
  })

  test('raw codec-prefix instance owner ids release pending override updates', () => {
    const host = createTestStore()
    const pageId = firstPageId(host.graph)
    const page = host.graph.getNode(pageId)
    expect(page).toBeDefined()
    if (page === undefined) return
    const component = host.graph.createNode('COMPONENT', pageId, {
      name: 'Prefix Owner Component'
    })
    const childStableId = 'prefix-owner-child'
    const child = host.graph.createNode('RECTANGLE', component.id, {
      name: 'Prefix Owner Child',
      width: 20
    })
    child.source.id = childStableId
    const instance = host.graph.createInstance(component.id, pageId, {
      name: 'Prefix Owner Instance'
    })
    expect(instance?.type).toBe('INSTANCE')
    if (instance?.type !== 'INSTANCE') return
    const ownerStableId = 'open-pencil:collab-node-key:v1:{owner-instance}:orphan:x'
    instance.source.id = ownerStableId

    const hostDoc = new Y.Doc()
    const hostSync = createTestYjsSync(host, hostDoc)
    const rootRemoteId = makeHostRootState(host)
    hostSync.syncAllNodesToYjs()
    const pageRemoteId = remoteNodeKeyForStableId(stableIdForNode(page))
    const componentRemoteId = remoteNodeKeyForStableId(stableIdForNode(component))
    const instanceRemoteId = remoteNodeKeyForStableId(ownerStableId)
    const childRemoteId = remoteNodeKeyForStableId(childStableId)
    expect(instanceRemoteId).not.toBe(ownerStableId)

    const joiner = createTestStore()
    const joinerDoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joiner, joinerDoc)
    observeTargetDoc(joiner, joinerDoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    cloneRequiredYnode(hostSync.ynodes, joinerSync.ynodes, rootRemoteId)
    cloneRequiredYnode(hostSync.ynodes, joinerSync.ynodes, pageRemoteId)
    cloneRequiredYnode(hostSync.ynodes, joinerSync.ynodes, componentRemoteId)
    cloneRequiredYnode(hostSync.ynodes, joinerSync.ynodes, instanceRemoteId)
    const remoteInstanceYnode = joinerSync.ynodes.get(instanceRemoteId)
    expect(remoteInstanceYnode).toBeDefined()
    if (remoteInstanceYnode === undefined) return
    remoteInstanceYnode.set('overrides', { [`${childRemoteId}:width`]: 77 })

    const pending = joiner.graph.getSyncState().pendingOverrideKeys.get(childRemoteId)
    expect([...(pending ?? [])].some((entry) => entry.remoteStableId === instanceRemoteId)).toBe(
      true
    )
    cloneRequiredYnode(hostSync.ynodes, joinerSync.ynodes, childRemoteId)

    const joinerInstanceId = joiner.graph.getSyncState().remoteToLocal.get(instanceRemoteId)
    const joinerInstance =
      joinerInstanceId === undefined ? undefined : joiner.graph.getNode(joinerInstanceId)
    expect(joinerInstance?.type).toBe('INSTANCE')
    if (joinerInstance?.type !== 'INSTANCE') return
    const joinerChild = findInstanceDescendantByStableId(
      joiner.graph,
      joinerInstance,
      childStableId
    )
    expect(joinerChild?.width).toBe(77)
    expect(joinerInstance.overrides[`${childStableId}:width`]).toBe(77)
    expect(joiner.graph.getSyncState().pendingOverrideKeys.has(childRemoteId)).toBe(false)
    expect(joinerInstance.componentId).not.toBeNull()
    if (joinerInstance.componentId === null) return
    joiner.graph.syncInstances(joinerInstance.componentId)
    const resyncedChild = findInstanceDescendantByStableId(
      joiner.graph,
      joinerInstance,
      childStableId
    )
    expect(resyncedChild?.width).toBe(77)
  })

  test('round-trips branch and orphan path segments without delimiter collisions', () => {
    const base = 'outer:orphan:{"base":"✓"}'
    const nested = 'nested:branch:{"unicode":"雪"}'
    const slot = 'slot:orphan:[1,2,3]'

    const branchKey = appendRemoteNodeKeySegment(remoteNodeKeyForStableId(base), 'branch', nested)
    const orphanKey = appendRemoteNodeKeySegment(branchKey, 'orphan', slot)
    const decoded = decodeRemoteNodeKey(orphanKey)

    expect(originalStableIdFromRemoteNodeKey(branchKey)).toBeNull()
    expect(originalStableIdFromRemoteNodeKey(orphanKey)).toBe(slot)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.parts.baseStableId).toBe(base)
    expect(decoded.parts.segments).toEqual([
      { kind: 'branch', stableId: nested },
      { kind: 'orphan', stableId: slot }
    ])
  })

  test('rejects malformed versioned keys instead of treating them as raw stable ids', () => {
    const malformed = 'open-pencil:collab-node-key:v1:not-a-length-prefixed-key'

    expect(isMalformedRemoteNodeKey(malformed)).toBe(true)
    expect(decodeRemoteNodeKey(malformed).ok).toBe(false)
    expect(rawStableIdFromRemoteNodeKey(malformed)).toBeNull()
    expect(originalStableIdFromRemoteNodeKey(malformed)).toBeNull()
  })

  test('fails closed when a malformed remote node key arrives from Yjs', () => {
    const store = createTestStore()
    const ydoc = new Y.Doc()
    const sync = createTestYjsSync(store, ydoc)
    const rootRemoteId = makeHostRootState(store)
    const malformed = 'open-pencil:collab-node-key:v1:bad'
    const ynode = new Y.Map<unknown>()
    ynode.set('id', malformed)
    ynode.set('parentId', rootRemoteId)
    ynode.set('type', 'FRAME')
    ynode.set('name', 'Malformed remote node')
    sync.ynodes.set(malformed, ynode)

    applyYnodeToGraph(store.graph, store.graph.getSyncState(), sync.ynodes, malformed, ynode)

    expect(
      [...store.graph.getAllNodes()].some((node) => node.name === 'Malformed remote node')
    ).toBe(false)
    expect(store.graph.getSyncState().remoteToLocal.has(malformed)).toBe(false)
  })
})
