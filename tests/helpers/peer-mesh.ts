import * as Y from 'yjs'

import type { SceneGraph, SceneNode } from '@open-pencil/core'

import {
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc,
  type TestStore
} from '#tests/engine/collab/helpers'

export interface PeerMesh {
  peers: Peer[]
  /** Encode state from all peers and apply to all others (full mesh sync). */
  syncFullMesh: () => void
  /** Encode state from peer `from` and apply to peer `to`. */
  syncFromTo: (from: number, to: number) => void
  /** Disconnect a peer (stop observing). */
  disconnect: (index: number) => void
  /** Reconnect a peer and apply all pending updates. */
  reconnect: (index: number) => void
  /** Assert all peers have at least as many nodes as the host. */
  assertNodeCountConverged: () => void
  /**
   * Assert all non-root host stable IDs are present on every joiner.
   *
   * The root node is excluded because root reconciliation *maps* the
   * host's root stable ID to the joiner's root via `remoteToLocal` —
   * the joiner's root keeps its own different stable ID. All other
   * nodes (pages, frames, shapes) are synced by stable ID and should
   * appear identically on every peer.
   */
  assertStableIdsConverged: () => void
  /**
   * Find a node by its stable ID on a specific peer.
   * Useful for locating the host's page on joiners after sync.
   */
  findNodeByStableId: (peerIndex: number, stableId: string) => SceneNode | undefined
  /** Get the stable ID of the host's first page. */
  getHostPageStableId: () => string
  /** Find the host's page on any peer (by stable ID match). */
  findHostPage: (peerIndex: number) => SceneNode | undefined
  /** Cleanup all peers. */
  dispose: () => void
}

export interface Peer {
  store: TestStore
  ydoc: Y.Doc
  sync: ReturnType<typeof createTestYjsSync>
  unbind: (() => void) | null
}

/**
 * Creates an N-peer collaboration mesh for testing.
 *
 * The first peer (index 0) is the host — it calls `makeHostRootState` and
 * `syncAllNodesToYjs` to seed its Yjs doc. All peers (including the host)
 * observe their own Yjs docs via `observeTargetDoc` so they can process
 * incoming updates from other peers.
 *
 * Network sync is simulated by `syncFullMesh()` which encodes each peer's
 * Yjs state and applies it to all other peers. This is equivalent to
 * Trystero's WebRTC mesh but deterministic and synchronous.
 *
 * Root collision is handled by `reconcileRoot`'s lexicographic comparison:
 * when a peer receives another peer's root, the peer with the smaller
 * root stable ID wins. Since the host's root is already mapped (via
 * `makeHostRootState`), and joiner roots are stored under the host's
 * root stable ID key in Yjs, the host's root is never replaced.
 */
export function createPeerMesh(numPeers: number): PeerMesh {
  const peers: Peer[] = []

  for (let i = 0; i < numPeers; i++) {
    const store = createTestStore()
    const ydoc = new Y.Doc()
    const sync = createTestYjsSync(store, ydoc)
    peers.push({ store, ydoc, sync, unbind: null })
  }

  // Host seeds its Yjs doc
  makeHostRootState(peers[0].store)

  // ALL peers (including host) observe their own Yjs docs so they can
  // process incoming updates from other peers via syncFullMesh.
  for (let i = 0; i < numPeers; i++) {
    const peer = peers[i]
    peer.unbind = observeTargetDoc(
      peer.store,
      peer.ydoc,
      peer.sync.applyYjsToGraph,
      peer.sync.reconcileRoot
    )
  }

  function syncFullMesh(): void {
    // Encode each peer's state and apply to all others
    const updates = peers.map((p) => Y.encodeStateAsUpdate(p.ydoc))
    for (let i = 0; i < peers.length; i++) {
      for (let j = 0; j < peers.length; j++) {
        if (i === j) continue
        Y.applyUpdate(peers[j].ydoc, updates[i])
      }
    }
  }

  function syncFromTo(from: number, to: number): void {
    encodeAndApply(peers[from].ydoc, peers[to].ydoc)
  }

  function disconnect(index: number): void {
    const peer = peers[index]
    peer.unbind?.()
    peer.unbind = null
  }

  function reconnect(index: number): void {
    const peer = peers[index]
    if (peer.unbind !== null) return
    peer.unbind = observeTargetDoc(
      peer.store,
      peer.ydoc,
      peer.sync.applyYjsToGraph,
      peer.sync.reconcileRoot
    )
    // Apply all pending updates
    syncFullMesh()
  }

  function assertNodeCountConverged(): void {
    const hostCount = peers[0].store.graph.nodes.size
    for (let i = 1; i < peers.length; i++) {
      const count = peers[i].store.graph.nodes.size
      if (count < hostCount) {
        throw new Error(`Node count not converged: host has ${hostCount}, peer ${i} has ${count}`)
      }
    }
  }

  function assertStableIdsConverged(): void {
    // Exclude the root — it is *mapped* (not duplicated) during root
    // reconciliation. The joiner's root keeps its own stable ID; the
    // host's root stable ID is resolved via `remoteToLocal`.
    const getIdSet = (graph: SceneGraph): Set<string> => {
      const ids = new Set<string>()
      for (const node of graph.getAllNodes()) {
        if (node.id === graph.rootId) continue
        ids.add(graph.getStableId(node))
      }
      return ids
    }

    const hostIds = getIdSet(peers[0].store.graph)
    for (let i = 1; i < peers.length; i++) {
      const otherIds = getIdSet(peers[i].store.graph)
      for (const id of hostIds) {
        if (!otherIds.has(id)) {
          throw new Error(`Stable ID ${id} from host missing from peer ${i}`)
        }
      }
    }
  }

  function findNodeByStableId(peerIndex: number, stableId: string): SceneNode | undefined {
    const peer = peers[peerIndex]
    if (peer === undefined) return undefined
    for (const node of peer.store.graph.getAllNodes()) {
      if (peer.store.graph.getStableId(node) === stableId) return node
    }
    return undefined
  }

  function getHostPageStableId(): string {
    const hostPage = peers[0].store.graph.getPages()[0]
    if (hostPage === undefined) {
      throw new Error('Host has no pages')
    }
    return peers[0].store.graph.getStableId(hostPage)
  }

  function findHostPage(peerIndex: number): SceneNode | undefined {
    return findNodeByStableId(peerIndex, getHostPageStableId())
  }

  function dispose(): void {
    for (const peer of peers) {
      peer.unbind?.()
      peer.ydoc.destroy()
    }
  }

  return {
    peers,
    syncFullMesh,
    syncFromTo,
    disconnect,
    reconnect,
    assertNodeCountConverged,
    assertStableIdsConverged,
    findNodeByStableId,
    getHostPageStableId,
    findHostPage,
    dispose
  }
}
