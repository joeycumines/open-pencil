import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { SceneGraph, createDefaultSource } from '@open-pencil/core'

import {
  createSelectionPayload,
  type AwarenessSelectionRef
} from '@/app/collab/awareness-selection'
import {
  createLocalAwarenessActions,
  selectionRuntimeIdsToRefs,
  selectionRefsToRuntimeIds,
  type LocalAwarenessStore
} from '@/app/collab/local-awareness'
import type { CollabState } from '@/app/collab/types'
import {
  findInstanceDescendantByStableId,
  registerYjsObservers,
  stableIdForNode
} from '@/app/collab/yjs-sync'

import { createTestStore, createTestYjsSync } from '#tests/engine/collab/helpers'

function createStore(graph = new SceneGraph()): LocalAwarenessStore {
  const page = graph.getPages()[0]
  return {
    graph,
    state: {
      currentPageId: page?.id ?? graph.rootId,
      remoteCursors: [],
      zoom: 1
    },
    requestRender: () => undefined
  }
}

function createStableNode(graph: SceneGraph, runtimeId: string, stableId: string) {
  const page = graph.getPages()[0]
  if (page === undefined) throw new Error('test graph has no page')
  return graph.createNode('RECTANGLE', page.id, {
    id: runtimeId,
    name: stableId,
    source: { ...createDefaultSource(), format: 'fig', id: stableId }
  })
}

function createComponentBackedInstanceDescendantFixture(graph: SceneGraph) {
  const page = graph.getPages()[0]
  if (page === undefined) throw new Error('test graph has no page')
  const component = graph.createNode('COMPONENT', page.id, {
    name: 'Component',
    width: 100,
    height: 40
  })
  const componentChild = graph.createNode('RECTANGLE', component.id, {
    name: 'Component Child',
    width: 100,
    height: 40
  })
  const instance = graph.createInstance(component.id, page.id, {
    name: 'Instance',
    x: 200
  })
  if (instance === null) throw new Error('expected populated instance')
  const instanceChild = findInstanceDescendantByStableId(
    graph,
    instance,
    stableIdForNode(componentChild)
  )
  if (instanceChild === undefined) throw new Error('expected populated instance child')
  return { componentChild, instance, instanceChild }
}

function seedRemoteMapping(store: LocalAwarenessStore, localId: string, remoteStableId: string) {
  const syncState = store.graph.getSyncState()
  syncState.localToRemote.set(localId, remoteStableId)
  syncState.remoteToLocal.set(remoteStableId, localId)
}

function nodeRef(stableId: string): AwarenessSelectionRef {
  return { kind: 'node', version: 1, stableId }
}

function createCollabState(): CollabState {
  return {
    connected: true,
    roomId: 'room',
    peers: [],
    localName: 'Local',
    localColor: { r: 0.1, g: 0.2, b: 0.3, a: 1 }
  }
}

describe('collaboration awareness selections', () => {
  test('local selection broadcast uses stable node ids', () => {
    const graph = new SceneGraph()
    const node = createStableNode(graph, 'local-runtime-id', 'stable-selection-id')
    const store = createStore(graph)

    expect(selectionRuntimeIdsToRefs(store, [node.id, 'missing-node'])).toEqual([
      nodeRef('stable-selection-id')
    ])
  })

  test('remote selection payloads map through sync state to local runtime ids', () => {
    const graph = new SceneGraph()
    const node = createStableNode(graph, 'local-runtime-id', 'stable-selection-id')
    const store = createStore(graph)
    const syncState = graph.getSyncState()
    syncState.remoteToLocal.set('stable-selection-id', node.id)
    syncState.localToRemote.set(node.id, 'stable-selection-id')

    expect(
      selectionRefsToRuntimeIds(store, [nodeRef('stable-selection-id'), nodeRef('missing-stable')])
    ).toEqual([node.id])
  })

  test('updateSelection writes structured selection payload into awareness state', () => {
    const graph = new SceneGraph()
    const node = createStableNode(graph, 'local-runtime-id', 'stable-selection-id')
    const store = createStore(graph)
    const awareness = new Awareness(new Y.Doc())
    const actions = createLocalAwarenessActions({
      state: ref(createCollabState()),
      storedName: ref('Local'),
      getStore: () => store,
      getAwareness: () => awareness
    })

    actions.updateSelection([node.id, 'missing-node'])

    expect(awareness.getLocalState()?.selection).toEqual(
      createSelectionPayload([nodeRef('stable-selection-id')])
    )
  })

  test('local selection broadcast prefers collab remote stable ids', () => {
    const graph = new SceneGraph()
    const node = createStableNode(graph, 'local-runtime-id', 'original-stable-id')
    const scopedStableId = 'owner:orphan:original-stable-id'
    const syncState = graph.getSyncState()
    syncState.localToRemote.set(node.id, scopedStableId)
    syncState.remoteToLocal.set(scopedStableId, node.id)
    const store = createStore(graph)
    const awareness = new Awareness(new Y.Doc())
    const actions = createLocalAwarenessActions({
      state: ref(createCollabState()),
      storedName: ref('Local'),
      getStore: () => store,
      getAwareness: () => awareness
    })

    expect(selectionRuntimeIdsToRefs(store, [node.id])).toEqual([nodeRef(scopedStableId)])
    actions.updateSelection([node.id])

    expect(awareness.getLocalState()?.selection).toEqual(
      createSelectionPayload([nodeRef(scopedStableId)])
    )
    expect(selectionRefsToRuntimeIds(store, [nodeRef(scopedStableId)])).toEqual([node.id])
    expect(selectionRefsToRuntimeIds(store, [nodeRef('original-stable-id')])).toBeUndefined()
  })

  test('stable ids that look like old prefixed JSON remain node refs', () => {
    const prefixLikeStableId = 'open-pencil:instance-selection:{"owner":"fake","path":["fake"]}'
    const graph = new SceneGraph()
    const node = createStableNode(graph, 'local-runtime-id', prefixLikeStableId)
    const store = createStore(graph)
    seedRemoteMapping(store, node.id, prefixLikeStableId)

    const refs = selectionRuntimeIdsToRefs(store, [node.id])

    expect(refs).toEqual([nodeRef(prefixLikeStableId)])
    expect(selectionRefsToRuntimeIds(store, refs)).toEqual([node.id])
  })

  test('component-backed instance descendant selections use instance paths', () => {
    const graph = new SceneGraph()
    const { componentChild, instance, instanceChild } =
      createComponentBackedInstanceDescendantFixture(graph)
    const store = createStore(graph)
    seedRemoteMapping(store, instance.id, stableIdForNode(instance))
    seedRemoteMapping(store, componentChild.id, stableIdForNode(componentChild))
    const awareness = new Awareness(new Y.Doc())
    const actions = createLocalAwarenessActions({
      state: ref(createCollabState()),
      storedName: ref('Local'),
      getStore: () => store,
      getAwareness: () => awareness
    })

    const selection = selectionRuntimeIdsToRefs(store, [instanceChild.id])
    const selectionRef = selection[0]
    if (selectionRef === undefined) throw new Error('expected component-backed selection ref')

    expect(selection).toHaveLength(1)
    expect(selectionRef.kind).toBe('instance-descendant')
    expect(selectionRef).not.toEqual(nodeRef(stableIdForNode(componentChild)))
    expect(selectionRefsToRuntimeIds(store, selection)).toEqual([instanceChild.id])

    actions.updateSelection([instanceChild.id])

    expect(awareness.getLocalState()?.selection).toEqual(createSelectionPayload(selection))
  })

  test('remote component-backed selection paths target populated descendants', () => {
    const graph = new SceneGraph()
    const { componentChild, instance, instanceChild } =
      createComponentBackedInstanceDescendantFixture(graph)
    const store = createStore(graph)
    seedRemoteMapping(store, instance.id, stableIdForNode(instance))
    seedRemoteMapping(store, componentChild.id, stableIdForNode(componentChild))
    const selection = selectionRuntimeIdsToRefs(store, [instanceChild.id])
    const awareness = new Awareness(new Y.Doc())
    const state = ref(createCollabState())
    const actions = createLocalAwarenessActions({
      state,
      storedName: ref('Local'),
      getStore: () => store,
      getAwareness: () => awareness
    })
    awareness.getStates().set(awareness.clientID + 1, {
      user: { name: 'Peer', color: { r: 0.8, g: 0.2, b: 0.4, a: 1 } },
      cursor: { x: 10, y: 20, pageId: store.state.currentPageId },
      selection: createSelectionPayload(selection)
    })

    actions.updatePeersList()

    expect(state.value.peers[0]?.selection).toEqual([instanceChild.id])
    expect(store.state.remoteCursors[0]?.selection).toEqual([instanceChild.id])
    expect(state.value.peers[0]?.selection).not.toEqual([componentChild.id])
  })

  test('updatePeersList exposes remote selections as local runtime ids', () => {
    const graph = new SceneGraph()
    const node = createStableNode(graph, 'local-runtime-id', 'stable-selection-id')
    const syncState = graph.getSyncState()
    syncState.remoteToLocal.set('stable-selection-id', node.id)
    syncState.localToRemote.set(node.id, 'stable-selection-id')

    let renderCount = 0
    const store = createStore(graph)
    store.requestRender = () => {
      renderCount++
    }
    const awareness = new Awareness(new Y.Doc())
    const state = ref(createCollabState())
    const actions = createLocalAwarenessActions({
      state,
      storedName: ref('Local'),
      getStore: () => store,
      getAwareness: () => awareness
    })
    awareness.getStates().set(awareness.clientID + 1, {
      user: { name: 'Peer', color: { r: 0.8, g: 0.2, b: 0.4, a: 1 } },
      cursor: { x: 10, y: 20, pageId: store.state.currentPageId },
      selection: createSelectionPayload([nodeRef('stable-selection-id'), nodeRef('missing-stable')])
    })

    actions.updatePeersList()

    expect(state.value.peers).toHaveLength(1)
    expect(state.value.peers[0]?.selection).toEqual([node.id])
    expect(store.state.remoteCursors).toHaveLength(1)
    expect(store.state.remoteCursors[0]?.selection).toEqual([node.id])
    expect(renderCount).toBe(1)
  })

  test('legacy string selection payloads are unsupported and never render overlays', () => {
    const graph = new SceneGraph()
    const node = createStableNode(graph, 'local-runtime-id', 'stable-selection-id')
    const store = createStore(graph)
    seedRemoteMapping(store, node.id, 'stable-selection-id')
    const awareness = new Awareness(new Y.Doc())
    const state = ref(createCollabState())
    const actions = createLocalAwarenessActions({
      state,
      storedName: ref('Local'),
      getStore: () => store,
      getAwareness: () => awareness
    })
    awareness.getStates().set(awareness.clientID + 1, {
      user: { name: 'Old Peer', color: { r: 0.8, g: 0.2, b: 0.4, a: 1 } },
      cursor: { x: 10, y: 20, pageId: store.state.currentPageId },
      selection: ['stable-selection-id']
    })

    actions.updatePeersList()

    expect(state.value.peers[0]?.selectionStatus).toBe('unsupported')
    expect(state.value.peers[0]?.selection).toBeUndefined()
    expect(store.state.remoteCursors[0]?.selection).toBeUndefined()
  })

  test('malformed structured selection payloads are marked and hidden', () => {
    const graph = new SceneGraph()
    const node = createStableNode(graph, 'local-runtime-id', 'stable-selection-id')
    const store = createStore(graph)
    seedRemoteMapping(store, node.id, 'stable-selection-id')
    const awareness = new Awareness(new Y.Doc())
    const state = ref(createCollabState())
    const actions = createLocalAwarenessActions({
      state,
      storedName: ref('Local'),
      getStore: () => store,
      getAwareness: () => awareness
    })
    awareness.getStates().set(awareness.clientID + 1, {
      user: { name: 'Bad Peer', color: { r: 0.8, g: 0.2, b: 0.4, a: 1 } },
      cursor: { x: 10, y: 20, pageId: store.state.currentPageId },
      selection: {
        kind: 'selection',
        version: 1,
        refs: [{ kind: 'node', version: 1, stableId: '' }]
      }
    })

    actions.updatePeersList()

    expect(state.value.peers[0]?.selectionStatus).toBe('malformed')
    expect(state.value.peers[0]?.selection).toBeUndefined()
    expect(store.state.remoteCursors[0]?.selection).toBeUndefined()
  })

  test('remote selections remap when Yjs mapping arrives after awareness', () => {
    const graph = new SceneGraph()
    const node = createStableNode(graph, 'local-runtime-id', 'stable-selection-id')
    const page = graph.getPages()[0]
    if (page === undefined) throw new Error('test graph has no page')
    const pageStableId = stableIdForNode(page)
    const syncState = graph.getSyncState()
    syncState.remoteRootStableId = graph.rootId
    syncState.remoteToLocal.set(graph.rootId, graph.rootId)
    syncState.localToRemote.set(graph.rootId, graph.rootId)
    syncState.remoteToLocal.set(pageStableId, page.id)
    syncState.localToRemote.set(page.id, pageStableId)
    syncState.rootMapped = true

    let renderCount = 0
    const awarenessStore = createStore(graph)
    awarenessStore.requestRender = () => {
      renderCount++
    }
    const awareness = new Awareness(new Y.Doc())
    const state = ref(createCollabState())
    const actions = createLocalAwarenessActions({
      state,
      storedName: ref('Local'),
      getStore: () => awarenessStore,
      getAwareness: () => awareness
    })
    awareness.getStates().set(awareness.clientID + 1, {
      user: { name: 'Peer', color: { r: 0.8, g: 0.2, b: 0.4, a: 1 } },
      cursor: { x: 10, y: 20, pageId: awarenessStore.state.currentPageId },
      selection: createSelectionPayload([nodeRef('stable-selection-id')])
    })
    actions.updatePeersList()

    expect(state.value.peers[0]?.selection).toBeUndefined()
    expect(awarenessStore.state.remoteCursors[0]?.selection).toBeUndefined()

    const yjsStore = createTestStore(graph)
    const ydoc = new Y.Doc()
    const sync = createTestYjsSync(yjsStore, ydoc)
    registerYjsObservers({
      store: yjsStore,
      ynodes: sync.ynodes,
      yimages: sync.yimages,
      yvariables: sync.yvariables,
      ycollections: sync.ycollections,
      getSuppressYjsEvents: sync.getSuppressYjsEvents,
      setSuppressGraphSync: () => undefined,
      applyYjsToGraph: sync.applyYjsToGraph,
      updatePeersList: actions.updatePeersList
    })
    const remoteNode = new Y.Map<unknown>()
    remoteNode.set('id', 'stable-selection-id')
    remoteNode.set('type', 'RECTANGLE')
    remoteNode.set('name', 'Remote Selected')
    remoteNode.set('parentId', pageStableId)

    ydoc.transact(() => {
      sync.ynodes.set('stable-selection-id', remoteNode)
    })

    expect(syncState.remoteToLocal.get('stable-selection-id')).toBe(node.id)
    expect(state.value.peers[0]?.selection).toEqual([node.id])
    expect(awarenessStore.state.remoteCursors[0]?.selection).toEqual([node.id])
    expect(renderCount).toBeGreaterThan(1)
  })
})
