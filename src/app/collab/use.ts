import { tryOnScopeDispose, useLocalStorage } from '@vueuse/core'
import { computed, ref } from 'vue'
import type * as Y from 'yjs'

import { createFollowActions, generateRoomId } from '@/app/collab/awareness'
import { createLocalAwarenessActions } from '@/app/collab/local-awareness'
import {
  createCollabConnectionActions,
  createCollabRuntime,
  createInitialCollabState
} from '@/app/collab/session'
import { DEFAULT_COLLAB_STATE, type CollabState, type RemotePeer } from '@/app/collab/types'
import { applyYnodeToGraph, createYjsGraphSync, stableIdForNode } from '@/app/collab/yjs-sync'
import type { ReconcileRootFn } from '@/app/collab/yjs-sync'
import type { EditorStore } from '@/app/editor/active-store'

export { COLLAB_KEY, useCollabInjected } from '@/app/collab/context'
export { DEFAULT_COLLAB_STATE }
export type { CollabState, RemotePeer }

function prepareGraphForCollab(store: EditorStore): void {
  store.graph.migrateLegacySourceIds()
  store.graph.resetSyncState()
}

function setHostRootStableId(store: EditorStore): void {
  const graph = store.graph
  const root = graph.getNode(graph.rootId)
  if (root === undefined) return
  const state = graph.getSyncState()
  const hostRootStableId = stableIdForNode(root)
  state.remoteRootStableId = hostRootStableId
  state.remoteToLocal.set(hostRootStableId, graph.rootId)
  state.localToRemote.set(graph.rootId, hostRootStableId)
  state.rootMapped = true
}

function reconcileRemoteRoot(
  store: EditorStore,
  remoteRootStableId: string,
  hostRootYnode: Y.Map<unknown>,
  ynodes: Y.Map<Y.Map<unknown>>
): void {
  const graph = store.graph
  const state = graph.getSyncState()
  if (state.rootMapped) return

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
}

export function useCollab(storeOrGetter: EditorStore | (() => EditorStore)) {
  const getStore = () =>
    typeof storeOrGetter === 'function' ? (storeOrGetter as () => EditorStore)() : storeOrGetter
  const storedName = useLocalStorage('op-collab-name', '')
  const state = ref<CollabState>(createInitialCollabState(storedName.value))
  const runtime = createCollabRuntime()
  const remotePeers = computed(() => state.value.peers)
  const getActiveStore = () => runtime.connectedStore ?? getStore()

  const { followingPeer, followPeer, resetFollow, tickFollow } = createFollowActions(
    getActiveStore,
    () => runtime.awareness
  )
  const { broadcastAwareness, updateCursor, updateSelection, updatePeersList, setLocalName } =
    createLocalAwarenessActions({
      state,
      storedName,
      getStore: getActiveStore,
      getAwareness: () => runtime.awareness
    })

  const { syncNodeToYjs, syncAllNodesToYjs, applyYjsToGraph } = createYjsGraphSync({
    getStore: getActiveStore,
    getYdoc: () => runtime.ydoc,
    getYnodes: () => runtime.ynodes,
    getYimages: () => runtime.yimages,
    setSuppressYjsEvents: (value) => {
      runtime.suppressYjsEvents = value
    }
  })
  const { connect: rawConnect, disconnect: rawDisconnect } = createCollabConnectionActions({
    runtime,
    state,
    getStore,
    updatePeersList,
    tickFollow,
    broadcastAwareness,
    applyYjsToGraph,
    syncNodeToYjs,
    resetFollow,
    reconcileRemoteRoot: reconcileRemoteRoot as ReconcileRootFn
  })

  function connect(roomId: string): void {
    prepareGraphForCollab(getActiveStore())
    rawConnect(roomId)
  }

  function disconnect(): void {
    const store = runtime.connectedStore ?? getStore()
    store.graph.resetSyncState()
    rawDisconnect()
  }

  function shareCurrentDoc(): string {
    const roomId = generateRoomId()
    const store = getActiveStore()
    prepareGraphForCollab(store)
    setHostRootStableId(store)
    rawConnect(roomId)
    syncAllNodesToYjs()
    return roomId
  }

  tryOnScopeDispose(disconnect)

  return {
    state,
    remotePeers,
    followingPeer,
    connect,
    disconnect,
    shareCurrentDoc,
    updateCursor,
    updateSelection,
    setLocalName,
    followPeer,
    tickFollow
  }
}
