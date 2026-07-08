import type { Ref } from 'vue'
import type { Awareness } from 'y-protocols/awareness'

import type { SceneNode } from '@open-pencil/scene-graph'

import { buildRemotePeers, remotePeersToCursors, type RawRemotePeer } from '@/app/collab/awareness'
import {
  createInstanceDescendantSelectionRef,
  createNodeSelectionRef,
  createSelectionPayload,
  type AwarenessInstanceDescendantSelectionRef,
  type AwarenessSelectionRef
} from '@/app/collab/awareness-selection'
import type { CollabState } from '@/app/collab/types'
import {
  findInstanceDescendantByStablePath,
  isComponentBackedInstanceDescendant,
  stableIdForNode,
  toRuntimeId
} from '@/app/collab/yjs-sync'
import type { EditorStore } from '@/app/editor/active-store'

export type LocalAwarenessStore = {
  graph: EditorStore['graph']
  state: Pick<EditorStore['state'], 'currentPageId' | 'remoteCursors' | 'zoom'>
  requestRender: EditorStore['requestRender']
}

type LocalAwarenessOptions = {
  state: Ref<CollabState>
  storedName: Ref<string>
  getStore: () => LocalAwarenessStore
  getAwareness: () => Awareness | null
}

function pathFromTopInstanceToNode(
  store: LocalAwarenessStore,
  node: SceneNode
): { owner: SceneNode; path: string[] } | null {
  const chain: SceneNode[] = []
  let current: SceneNode | undefined = node

  while (current !== undefined) {
    chain.unshift(current)
    current = current.parentId === null ? undefined : store.graph.getNode(current.parentId)
  }

  const ownerIndex = chain.findIndex(
    (candidate, index) => candidate.type === 'INSTANCE' && index < chain.length - 1
  )
  if (ownerIndex === -1) return null

  const path = chain.slice(ownerIndex + 1).map(stableIdForNode)
  return path.length > 0 ? { owner: chain[ownerIndex], path } : null
}

function componentBackedSelectionReference(
  store: LocalAwarenessStore,
  node: SceneNode
): AwarenessSelectionRef | null {
  if (!isComponentBackedInstanceDescendant(store.graph, node.id)) return null
  const state = store.graph.getSyncState()
  const selectionPath = pathFromTopInstanceToNode(store, node)
  if (selectionPath === null) return null
  return createInstanceDescendantSelectionRef(
    state.localToRemote.get(selectionPath.owner.id) ?? stableIdForNode(selectionPath.owner),
    selectionPath.path
  )
}

function instanceSelectionReferenceToRuntimeId(
  store: LocalAwarenessStore,
  reference: AwarenessInstanceDescendantSelectionRef
): string | undefined {
  const ownerId = toRuntimeId(store.graph, store.graph.getSyncState(), reference.ownerStableId)
  const owner = ownerId === undefined ? undefined : store.graph.getNode(ownerId)
  if (owner?.type !== 'INSTANCE') return undefined
  return findInstanceDescendantByStablePath(store.graph, owner, reference.stablePath)?.id
}

export function selectionRuntimeIdsToRefs(
  store: LocalAwarenessStore,
  ids: readonly string[]
): AwarenessSelectionRef[] {
  const refs: AwarenessSelectionRef[] = []
  const state = store.graph.getSyncState()
  for (const id of ids) {
    const node = store.graph.getNode(id)
    if (node === undefined) continue
    const remoteStableId = state.localToRemote.get(id)
    if (remoteStableId !== undefined) {
      const ref = createNodeSelectionRef(remoteStableId)
      if (ref !== null) refs.push(ref)
      continue
    }

    const ref =
      componentBackedSelectionReference(store, node) ??
      createNodeSelectionRef(stableIdForNode(node))
    if (ref !== null) refs.push(ref)
  }
  return refs
}

export function selectionRefsToRuntimeIds(
  store: LocalAwarenessStore,
  refs: readonly AwarenessSelectionRef[] | undefined
): string[] | undefined {
  if (refs === undefined) return undefined
  const state = store.graph.getSyncState()
  const runtimeIds: string[] = []
  for (const ref of refs) {
    const runtimeId =
      ref.kind === 'node'
        ? toRuntimeId(store.graph, state, ref.stableId)
        : instanceSelectionReferenceToRuntimeId(store, ref)
    if (runtimeId !== undefined && store.graph.getNode(runtimeId) !== undefined) {
      runtimeIds.push(runtimeId)
    }
  }
  return runtimeIds.length > 0 ? runtimeIds : undefined
}

function mapPeerSelectionsToRuntimeIds(store: LocalAwarenessStore, peers: RawRemotePeer[]) {
  return peers.map((peer) => ({
    ...peer,
    selection:
      peer.selectionStatus === 'ok' ? selectionRefsToRuntimeIds(store, peer.selection) : undefined
  }))
}

export function createLocalAwarenessActions({
  state,
  storedName,
  getStore,
  getAwareness
}: LocalAwarenessOptions) {
  function broadcastAwareness() {
    const awareness = getAwareness()
    if (!awareness) return
    awareness.setLocalStateField('user', {
      name: state.value.localName,
      color: state.value.localColor
    })
  }

  function updateCursor(x: number, y: number, pageId: string) {
    const awareness = getAwareness()
    if (!awareness) return
    awareness.setLocalStateField('cursor', { x, y, pageId, zoom: getStore().state.zoom })
  }

  function updateSelection(ids: string[]) {
    const awareness = getAwareness()
    if (!awareness) return
    awareness.setLocalStateField(
      'selection',
      createSelectionPayload(selectionRuntimeIdsToRefs(getStore(), ids))
    )
  }

  function updatePeersList() {
    const awareness = getAwareness()
    if (!awareness) return

    const store = getStore()
    const peers = mapPeerSelectionsToRuntimeIds(
      store,
      buildRemotePeers(
        awareness.getStates() as Map<number, Record<string, unknown>>,
        awareness.clientID
      )
    )

    state.value.peers = peers
    store.state.remoteCursors = remotePeersToCursors(peers, store.state.currentPageId)
    store.requestRender()
  }

  function setLocalName(name: string) {
    state.value.localName = name
    storedName.value = name
    broadcastAwareness()
  }

  return { broadcastAwareness, updateCursor, updateSelection, updatePeersList, setLocalName }
}
