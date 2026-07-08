import { describe, test, expect } from 'bun:test'

import * as Y from 'yjs'

import type { Fill, GeometryPath, SceneNode } from '@open-pencil/scene-graph'
import { SceneGraph } from '@open-pencil/scene-graph'
import { nodeVisualBounds } from '@open-pencil/scene-graph/geometry'

import {
  applyYnodeToGraph,
  createYjsGraphSync,
  fallbackRootPageId,
  registerYjsObservers,
  remoteNodeKeyForStableId,
  removeLocalRootChildrenForRemoteAdoption,
  stableIdForNode,
  syncNodePropsToYMap,
  yNodeToProps,
  type ReconcileRootFn
} from '@/app/collab/yjs-sync'
import { createEditorStore, type EditorStore } from '@/app/editor/session'

import { expectDefined, getNodeOrThrow } from '#tests/helpers/assert'
import { connectYDocs } from '#tests/helpers/yjs'

// Test helper: apply a single ynode to a peer graph by stable ID.
// Renamed from applyYnodeToGraph to avoid shadowing the imported
// 5-param production function of the same name.
function applyYnodeToPeer(peer: SceneGraph, nodeId: string, ynode: Y.Map<unknown>) {
  const props = yNodeToProps(ynode)
  if (peer.getNode(nodeId)) {
    peer.updateNode(nodeId, props as Partial<SceneNode>)
    return
  }
  const type = props.type as SceneNode['type'] | undefined
  if (!type) return
  const parentId = typeof props.parentId === 'string' ? props.parentId : null
  peer.createNodeWithId(nodeId, type, parentId, props as Partial<SceneNode>)
  if (parentId === null) peer.rootId = nodeId
}

function seedHostIntoYjs(host: SceneGraph): Y.Map<Y.Map<unknown>> {
  const doc = new Y.Doc()
  const ynodes = doc.getMap<Y.Map<unknown>>('nodes')
  const state = host.getSyncState()
  doc.transact(() => {
    for (const node of host.getAllNodes()) {
      const ynode = new Y.Map<unknown>()
      ynodes.set(node.id, ynode)
      syncNodePropsToYMap(node, ynode, host, state)
    }
  })
  return ynodes
}

function firstPage(graph: SceneGraph): SceneNode {
  return expectDefined(graph.getPages()[0], 'first page')
}

function setHostRootStableId(store: EditorStore): void {
  const graph = store.graph
  const root = graph.getNode(graph.rootId)
  if (root === undefined) return
  const state = graph.getSyncState()
  const hostRootStableId = remoteNodeKeyForStableId(stableIdForNode(root))
  state.remoteRootStableId = hostRootStableId
  state.remoteToLocal.set(hostRootStableId, graph.rootId)
  state.localToRemote.set(graph.rootId, hostRootStableId)
  state.rootMapped = true
}

function switchToFirstAvailablePage(store: EditorStore): void {
  const pageId = fallbackRootPageId(store.graph, store.state.currentPageId)
  if (pageId !== null) void store.switchPage(pageId)
}

const reconcileRemoteRoot: ReconcileRootFn = (store, remoteRootStableId, hostRootYnode, ynodes) => {
  const graph = store.graph
  const state = graph.getSyncState()
  if (state.rootMapped) {
    if (state.remoteRootStableId === remoteRootStableId) return
    const prevRootStableId = state.remoteRootStableId
    if (prevRootStableId !== null && prevRootStableId < remoteRootStableId) return
    removeLocalRootChildrenForRemoteAdoption(graph, state)
    if (prevRootStableId !== null) {
      state.remoteToLocal.delete(prevRootStableId)
      state.localToRemote.delete(graph.rootId)
    }
    state.rootMapped = false
    state.remoteRootStableId = null
  } else {
    removeLocalRootChildrenForRemoteAdoption(graph, state)
  }

  state.remoteRootStableId = remoteRootStableId
  state.remoteToLocal.set(remoteRootStableId, graph.rootId)
  state.localToRemote.set(graph.rootId, remoteRootStableId)
  state.rootMapped = true

  applyYnodeToGraph(graph, state, ynodes, remoteRootStableId, hostRootYnode)

  for (const stableId of state.pendingUntilRoot) {
    const ynode = ynodes.get(stableId)
    if (ynode !== undefined) {
      applyYnodeToGraph(graph, state, ynodes, stableId, ynode)
    }
  }
  state.pendingUntilRoot.clear()
  switchToFirstAvailablePage(store)
}

type SyncedStores = ReturnType<typeof createSyncedStores>

function createSyncedStores() {
  const hostStore = createEditorStore(new SceneGraph())
  const peerStore = createEditorStore(new SceneGraph())
  const hostDoc = new Y.Doc()
  const peerDoc = new Y.Doc()
  const hostNodes = hostDoc.getMap<Y.Map<unknown>>('nodes')
  const peerNodes = peerDoc.getMap<Y.Map<unknown>>('nodes')
  const hostImages = hostDoc.getMap<Uint8Array>('images')
  const peerImages = peerDoc.getMap<Uint8Array>('images')
  const hostVariables = hostDoc.getMap<Y.Map<unknown>>('variables')
  const peerVariables = peerDoc.getMap<Y.Map<unknown>>('variables')
  const hostCollections = hostDoc.getMap<Y.Map<unknown>>('collections')
  const peerCollections = peerDoc.getMap<Y.Map<unknown>>('collections')
  let hostSuppressYjsEvents = false
  let peerSuppressYjsEvents = false
  let hostSuppressGraphSync = false
  let peerSuppressGraphSync = false

  const hostSync = createYjsGraphSync({
    getStore: () => hostStore,
    getYdoc: () => hostDoc,
    getYnodes: () => hostNodes,
    getYimages: () => hostImages,
    getYvariables: () => hostVariables,
    getYcollections: () => hostCollections,
    setSuppressYjsEvents: (value) => {
      hostSuppressYjsEvents = value
    }
  })
  const peerSync = createYjsGraphSync({
    getStore: () => peerStore,
    getYdoc: () => peerDoc,
    getYnodes: () => peerNodes,
    getYimages: () => peerImages,
    getYvariables: () => peerVariables,
    getYcollections: () => peerCollections,
    setSuppressYjsEvents: (value) => {
      peerSuppressYjsEvents = value
    }
  })

  setHostRootStableId(hostStore)

  registerYjsObservers({
    store: hostStore,
    ynodes: hostNodes,
    yimages: hostImages,
    yvariables: hostVariables,
    ycollections: hostCollections,
    getSuppressYjsEvents: () => hostSuppressYjsEvents,
    setSuppressGraphSync: (value) => {
      hostSuppressGraphSync = value
    },
    applyYjsToGraph: hostSync.applyYjsToGraph,
    reconcileRemoteRoot
  })
  registerYjsObservers({
    store: peerStore,
    ynodes: peerNodes,
    yimages: peerImages,
    yvariables: peerVariables,
    ycollections: peerCollections,
    getSuppressYjsEvents: () => peerSuppressYjsEvents,
    setSuppressGraphSync: (value) => {
      peerSuppressGraphSync = value
    },
    applyYjsToGraph: peerSync.applyYjsToGraph,
    reconcileRemoteRoot
  })

  const disconnectYDocs = connectYDocs(hostDoc, peerDoc)

  return {
    hostStore,
    peerStore,
    hostSync,
    peerSync,
    get hostSuppressGraphSync() {
      return hostSuppressGraphSync
    },
    get peerSuppressGraphSync() {
      return peerSuppressGraphSync
    },
    cleanup: () => {
      disconnectYDocs()
      hostDoc.destroy()
      peerDoc.destroy()
    }
  }
}

function withSyncedStores(run: (stores: SyncedStores) => void) {
  const stores = createSyncedStores()
  try {
    run(stores)
  } finally {
    stores.cleanup()
  }
}

describe('collab yjs-sync', () => {
  test('createNodeWithId forces the requested id even if synced props contain a stale id', () => {
    const graph = new SceneGraph()
    const page = firstPage(graph)
    const node = graph.createNodeWithId('remote-id', 'RECTANGLE', page.id, {
      id: 'stale-local-id',
      width: 50
    })

    expect(node.id).toBe('remote-id')
    expect(graph.getNode('remote-id')).toBe(node)
    expect(graph.getNode('stale-local-id')).toBeUndefined()
    expect(page.childIds).toContain('remote-id')
  })

  test('binary geometry fields are excluded from sync', () => {
    const host = new SceneGraph()
    const page = firstPage(host)
    const blob = new Uint8Array([1, 2, 3, 250])
    const geometry: GeometryPath[] = [{ windingRule: 'NONZERO', commandsBlob: blob }]
    const ellipse = host.createNode('ELLIPSE', page.id, {
      width: 100,
      height: 100,
      fillGeometry: geometry
    })

    const doc = new Y.Doc()
    const ynode = new Y.Map<unknown>()
    doc.getMap<Y.Map<unknown>>('nodes').set(ellipse.id, ynode)
    syncNodePropsToYMap(ellipse, ynode, host, host.getSyncState())
    blob[0] = 99
    const props = yNodeToProps(ynode)

    // fillGeometry and strokeGeometry are excluded from sync — they are derived
    // data that peers recompute locally rather than transferring as binary blobs.
    expect(ynode.get('fillGeometry')).toBeUndefined()
    expect(props.fillGeometry).toBeUndefined()
    expect(props.strokeGeometry).toBeUndefined()
    // Non-excluded fields round-trip correctly.
    expect(props.type).toBe('ELLIPSE')
    expect(props.width).toBe(100)
    expect(props.height).toBe(100)
  })

  test('a fresh peer reconstructs one ellipse, no duplicate childIds, order-independent', () => {
    const host = new SceneGraph()
    const hostPage = firstPage(host)
    const ellipse = host.createNode('ELLIPSE', hostPage.id, { width: 80, height: 60 })

    const ynodes = seedHostIntoYjs(host)

    const peer = new SceneGraph()
    const ids = [...ynodes.keys()].reverse()
    for (const id of ids) applyYnodeToPeer(peer, id, expectDefined(ynodes.get(id), `ynode ${id}`))

    const peerEllipse = getNodeOrThrow(peer, ellipse.id)
    expect(peerEllipse.type).toBe('ELLIPSE')
    expect(peerEllipse.parentId).toBe(hostPage.id)

    const peerPage = getNodeOrThrow(peer, hostPage.id)
    const refs = peerPage.childIds.filter((c) => c === ellipse.id)
    expect(refs).toHaveLength(1)
    expect(peer.getPages().map((page) => page.id)).toContain(hostPage.id)
  })

  test('a live-created node links into its parent even when the parent childIds was not re-synced', () => {
    const host = new SceneGraph()
    const hostPage = firstPage(host)
    const rect = host.createNode('RECTANGLE', hostPage.id, { width: 50, height: 50 })

    const doc = new Y.Doc()
    const ynodes = doc.getMap<Y.Map<unknown>>('nodes')
    doc.transact(() => {
      const pageYnode = new Y.Map<unknown>()
      ynodes.set(hostPage.id, pageYnode)
      syncNodePropsToYMap(
        { ...hostPage, childIds: [] } as SceneNode,
        pageYnode,
        host,
        host.getSyncState()
      )

      const rectYnode = new Y.Map<unknown>()
      ynodes.set(rect.id, rectYnode)
      syncNodePropsToYMap(rect, rectYnode, host, host.getSyncState())
    })

    const peer = new SceneGraph()
    applyYnodeToPeer(peer, hostPage.id, expectDefined(ynodes.get(hostPage.id), 'page ynode'))
    applyYnodeToPeer(peer, rect.id, expectDefined(ynodes.get(rect.id), 'rect ynode'))

    const peerPage = getNodeOrThrow(peer, hostPage.id)
    expect(peerPage.childIds).toEqual([rect.id])
    expect(getNodeOrThrow(peer, rect.id).type).toBe('RECTANGLE')
  })

  test('syncAllNodesToYjs populates peer graph and current page', () => {
    withSyncedStores(({ hostStore, peerStore, hostSync }) => {
      const hostPage = firstPage(hostStore.graph)
      const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, { width: 80, height: 60 })

      hostSync.syncAllNodesToYjs()

      // Root IDs differ across peers (each generates its own runtime ID).
      // Verify the peer adopted the host's root stable ID instead.
      expect(peerStore.graph.getSyncState().remoteRootStableId).toBe(
        hostStore.graph.getSyncState().remoteRootStableId
      )
      expect(peerStore.state.currentPageId).toBe(hostPage.id)
      expect(peerStore.graph.getPages().map((page) => page.id)).toContain(hostPage.id)
      expect(getNodeOrThrow(peerStore.graph, rect.id).type).toBe('RECTANGLE')
    })
  })

  test('live-created and edited nodes sync in both directions', () => {
    withSyncedStores(({ hostStore, peerStore, hostSync, peerSync }) => {
      const hostPage = firstPage(hostStore.graph)
      hostSync.syncAllNodesToYjs()

      const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, { width: 50, height: 50 })
      hostSync.syncNodeToYjs(rect.id)

      const peerRect = getNodeOrThrow(peerStore.graph, rect.id)
      expect(peerRect.parentId).toBe(hostPage.id)
      expect(getNodeOrThrow(peerStore.graph, hostPage.id).childIds).toContain(rect.id)

      peerStore.graph.updateNode(rect.id, { x: 42, y: 24 })
      peerSync.syncNodeToYjs(rect.id)

      expect(getNodeOrThrow(hostStore.graph, rect.id).x).toBe(42)
      expect(getNodeOrThrow(hostStore.graph, rect.id).y).toBe(24)
    })
  })

  test('image fills sync image bytes', () => {
    withSyncedStores(({ hostStore, peerStore, hostSync }) => {
      const hostPage = firstPage(hostStore.graph)
      const imageHash = 'image-hash'
      const imageFill: Fill = {
        type: 'IMAGE',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        imageHash,
        imageScaleMode: 'FILL'
      }
      const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, { fills: [imageFill] })
      hostStore.graph.images.set(imageHash, new Uint8Array([9, 8, 7]))

      hostSync.syncNodeToYjs(rect.id)

      expect(
        Array.from(expectDefined(peerStore.graph.images.get(imageHash), 'peer image'))
      ).toEqual([9, 8, 7])
    })
  })

  test('synced node does not crash the visual-bounds helper', () => {
    const host = new SceneGraph()
    const hostPage = firstPage(host)
    const ellipse = host.createNode('ELLIPSE', hostPage.id, { width: 120, height: 90 })

    const ynodes = seedHostIntoYjs(host)
    const peer = new SceneGraph()
    for (const id of ynodes.keys()) {
      applyYnodeToPeer(peer, id, expectDefined(ynodes.get(id), `ynode ${id}`))
    }

    const peerEllipse = getNodeOrThrow(peer, ellipse.id)
    expect(() =>
      nodeVisualBounds(peerEllipse, (id) => {
        const n = peer.getNode(id)
        return { x: n?.x ?? 0, y: n?.y ?? 0 }
      })
    ).not.toThrow()
  })
})
