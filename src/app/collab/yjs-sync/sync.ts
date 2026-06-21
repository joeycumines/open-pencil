import * as Y from 'yjs'

import {
  type GraphBindingOptions,
  type YjsGraphSyncOptions,
  type YjsObserverOptions,
  type YNodes
} from './constants'
import { applyYnodeToGraph, removeFromPendingQueues } from './graph-apply'
import { addedOrUpdatedYnodes, ensureRemoteMapping, findStableIdForYMap } from './mapping'
import { asString, syncLocalRootToYjs, syncNodePropsToYMap } from './serialize'

export function bindCollabGraphEvents({
  store,
  getYdoc,
  getYnodes,
  getSuppressGraphSync,
  setSuppressYjsEvents,
  syncNodeToYjs
}: GraphBindingOptions) {
  function onGraphMutation(nodeId: string) {
    if (!getSuppressGraphSync() && getYdoc() && getYnodes()) {
      syncNodeToYjs(nodeId)
    }
  }

  const unbinds = [
    store.onEditorEvent('node:updated', (id) => onGraphMutation(id)),
    store.onEditorEvent('node:created', (node) => onGraphMutation(node.id)),
    store.onEditorEvent('node:reparented', (nodeId) => onGraphMutation(nodeId)),
    store.onEditorEvent('node:reordered', (nodeId, parentId) => {
      onGraphMutation(nodeId)
      onGraphMutation(parentId)
    }),
    store.onEditorEvent('node:deleted', (id) => {
      const ydoc = getYdoc()
      const ynodes = getYnodes()
      if (!getSuppressGraphSync() && ydoc && ynodes) {
        const state = store.graph.getSyncState()
        const remoteStableId = state.localToRemote.get(id)
        if (remoteStableId === undefined) return
        removeFromPendingQueues(state, remoteStableId)
        setSuppressYjsEvents(true)
        ydoc.transact(() => {
          ynodes.delete(remoteStableId)
        })
        setSuppressYjsEvents(false)
      }
    })
  ]
  return () => {
    for (const unbind of unbinds) unbind()
  }
}

function findRootCandidate(
  events: Y.YEvent<Y.Map<unknown>>[],
  ynodes: YNodes
): { remoteRootStableId: string; ynode: Y.Map<unknown> } | null {
  for (const { remoteStableId, ynode } of addedOrUpdatedYnodes(events, ynodes)) {
    const parentId = asString(ynode.get('parentId'))
    if (parentId === remoteStableId) {
      return { remoteRootStableId: remoteStableId, ynode }
    }
  }
  return null
}

export function registerYjsObservers({
  store,
  ynodes,
  yimages,
  getSuppressYjsEvents,
  setSuppressGraphSync,
  applyYjsToGraph,
  reconcileRemoteRoot
}: YjsObserverOptions) {
  ynodes.observeDeep((events) => {
    if (getSuppressYjsEvents()) return
    const state = store.graph.getSyncState()
    if (state.remoteRootStableId === null) {
      const rootCandidate = findRootCandidate(events, ynodes)
      if (rootCandidate !== null && reconcileRemoteRoot !== undefined) {
        reconcileRemoteRoot(store, rootCandidate.remoteRootStableId, rootCandidate.ynode, ynodes)
      }
    }
    setSuppressGraphSync(true)
    try {
      applyYjsToGraph(events)
    } finally {
      setSuppressGraphSync(false)
    }
    store.requestRender()
  })

  yimages.observe((event) => {
    if (getSuppressYjsEvents()) return
    for (const [key, change] of event.changes.keys) {
      if (change.action === 'add' || change.action === 'update') {
        const data = yimages.get(key)
        if (data) store.graph.images.set(key, new Uint8Array(data))
      } else {
        store.graph.images.delete(key)
      }
    }
    store.requestRender()
  })
}

export function createYjsGraphSync({
  getStore,
  getYdoc,
  getYnodes,
  getYimages,
  setSuppressYjsEvents
}: YjsGraphSyncOptions) {
  function syncNodeToYjs(nodeId: string) {
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ydoc || !ynodes) return
    const node = store.graph.getNode(nodeId)
    if (!node) return

    const graph = store.graph
    const state = graph.getSyncState()
    if (state.remoteRootStableId === null) return
    const remoteRootStableId = state.remoteRootStableId

    const localYimages = getYimages()
    setSuppressYjsEvents(true)
    ydoc.transact(() => {
      let ynode: Y.Map<unknown> | undefined
      if (nodeId === graph.rootId) {
        ynode = ynodes.get(remoteRootStableId)
        if (ynode === undefined) {
          ynode = new Y.Map<unknown>()
          ynodes.set(remoteRootStableId, ynode)
        }
      } else {
        const remoteStableId = ensureRemoteMapping(state, node)
        ynode = ynodes.get(remoteStableId)
        if (ynode === undefined) {
          ynode = new Y.Map<unknown>()
          ynodes.set(remoteStableId, ynode)
        }
      }
      syncNodePropsToYMap(node, ynode, graph, state)

      if (localYimages) {
        for (const fill of node.fills) {
          if (fill.imageHash && !localYimages.has(fill.imageHash)) {
            const data = store.graph.images.get(fill.imageHash)
            if (data) localYimages.set(fill.imageHash, data)
          }
        }
      }
    })
    setSuppressYjsEvents(false)
  }

  function syncAllNodesToYjs() {
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ydoc || !ynodes) return

    const graph = store.graph
    const state = graph.getSyncState()
    if (state.remoteRootStableId === null) return

    const localYimages = getYimages()
    setSuppressYjsEvents(true)
    ydoc.transact(() => {
      syncLocalRootToYjs(graph, state, ynodes)
      for (const node of store.graph.getAllNodes()) {
        if (node.id === graph.rootId) continue
        const remoteStableId = ensureRemoteMapping(state, node)
        let ynode = ynodes.get(remoteStableId)
        if (ynode === undefined) {
          ynode = new Y.Map<unknown>()
          ynodes.set(remoteStableId, ynode)
        }
        syncNodePropsToYMap(node, ynode, graph, state)
      }
    })
    if (localYimages) {
      ydoc.transact(() => {
        for (const [hash, data] of store.graph.images) {
          if (!localYimages.has(hash)) {
            localYimages.set(hash, data)
          }
        }
      })
    }
    setSuppressYjsEvents(false)
  }

  function applyYjsToGraph(events: Y.YEvent<Y.Map<unknown>>[]) {
    const store = getStore()
    const ynodes = getYnodes()
    if (ynodes === null) return
    const graph = store.graph
    const state = graph.getSyncState()

    for (const { remoteStableId, ynode } of addedOrUpdatedYnodes(events, ynodes)) {
      applyYnodeToGraph(graph, state, ynodes, remoteStableId, ynode)
    }

    for (const event of events) {
      if (event.target !== ynodes) {
        if (event.target.parent === ynodes) {
          const remoteStableId = findStableIdForYMap(ynodes, event.target)
          if (remoteStableId !== null) {
            const ynode = ynodes.get(remoteStableId)
            if (ynode !== undefined) {
              applyYnodeToGraph(graph, state, ynodes, remoteStableId, ynode)
            }
          }
        }
        continue
      }
      for (const [remoteStableId, change] of event.changes.keys) {
        if (change.action === 'delete') {
          const localId = state.remoteToLocal.get(remoteStableId)
          if (localId !== undefined) {
            store.graph.deleteNode(localId, { permanent: true })
          }
          removeFromPendingQueues(state, remoteStableId)
        }
      }
    }
  }

  return { syncNodeToYjs, syncAllNodesToYjs, applyYjsToGraph }
}
