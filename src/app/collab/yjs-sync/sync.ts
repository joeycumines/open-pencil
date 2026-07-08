import * as Y from 'yjs'

import type { GraphSyncState, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { releasePendingChildOrders } from './child-order'
import type {
  GraphBindingOptions,
  YjsGraphSyncOptions,
  YjsObserverOptions,
  YNodes
} from './constants'
import { applyYnodeToGraph, removeFromPendingQueues } from './graph-apply'
import {
  ensureRemoteMappingForNode,
  isComponentBackedInstanceDescendant,
  mergeInstanceDescendantOverridesForYjs,
  orphanedInstanceDescendantSubtreeIdsForDeletedComponentNode
} from './instance-descendants'
import { addedOrUpdatedYnodes, findStableIdForYMap, stableIdForNode } from './mapping'
import { isMalformedRemoteNodeKey, originalStableIdFromRemoteNodeKey } from './remote-node-key'
import { fallbackRootPageId } from './root-adoption'
import { asString, syncLocalRootToYjs, syncNodePropsToYMap } from './serialize'
import { applyYjsCollectionsToGraph, applyYjsVariablesToGraph } from './variable/apply'
import {
  deleteCollectionMapping,
  deleteVariableMapping,
  syncAllVariablesToYjs as syncAllVariablesToYMap,
  syncCollectionToYjs as syncCollectionToYMap,
  syncVariableToYjs as syncVariableToYMap
} from './variable/sync'

function switchToFirstAvailablePage(store: YjsObserverOptions['store']): void {
  const pageId = fallbackRootPageId(store.graph, store.state.currentPageId)
  if (pageId !== null) void store.switchPage(pageId)
}

export function bindCollabGraphEvents({
  store,
  getYdoc,
  getYnodes,
  getSuppressGraphSync,
  setSuppressYjsEvents,
  syncNodeToYjs,
  syncVariableToYjs,
  syncCollectionToYjs
}: GraphBindingOptions) {
  function onGraphMutation(nodeId: string, changes?: Partial<SceneNode>) {
    if (!getSuppressGraphSync() && getYdoc() && getYnodes()) {
      syncNodeToYjs(nodeId, changes)
    }
  }

  function onVariableMutation(variableId: string) {
    if (!getSuppressGraphSync() && getYdoc() && getYnodes()) {
      syncVariableToYjs(variableId)
    }
  }

  function onCollectionMutation(collectionId: string) {
    if (!getSuppressGraphSync() && getYdoc() && getYnodes()) {
      syncCollectionToYjs(collectionId)
    }
  }

  function deleteFromYjsMap(
    mapName: string,
    localToRemote: Map<string, string> | undefined,
    id: string,
    onDeleted: (remoteStableId: string) => void
  ) {
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!getSuppressGraphSync() && ydoc && ynodes) {
      const remoteStableId = localToRemote?.get(id)
      if (remoteStableId === undefined) return
      setSuppressYjsEvents(true)
      ydoc.transact(() => {
        const ymap = ydoc.getMap<Y.Map<unknown>>(mapName)
        ymap.delete(remoteStableId)
      })
      setSuppressYjsEvents(false)
      onDeleted(remoteStableId)
    }
  }

  const unbinds = [
    store.onEditorEvent('node:updated', (id, changes) => onGraphMutation(id, changes)),
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
        const orphanedInstanceDescendantIds =
          orphanedInstanceDescendantSubtreeIdsForDeletedComponentNode(store.graph, id)
        if (remoteStableId === undefined && orphanedInstanceDescendantIds.length === 0) return
        if (remoteStableId !== undefined) removeFromPendingQueues(state, remoteStableId)
        setSuppressYjsEvents(true)
        ydoc.transact(() => {
          if (remoteStableId !== undefined) ynodes.delete(remoteStableId)
        })
        setSuppressYjsEvents(false)
        for (const orphanedId of orphanedInstanceDescendantIds) {
          syncNodeToYjs(orphanedId)
        }
      }
    }),
    store.onEditorEvent('variable:created', (variable) => onVariableMutation(variable.id)),
    store.onEditorEvent('variable:updated', (variable) => onVariableMutation(variable.id)),
    store.onEditorEvent('variable:deleted', (id) => {
      const state = store.graph.getSyncState()
      deleteFromYjsMap('variables', state.localToVariable, id, (remoteStableId) => {
        deleteVariableMapping(state, id, remoteStableId)
      })
    }),
    store.onEditorEvent('collection:created', (collection) => onCollectionMutation(collection.id)),
    store.onEditorEvent('collection:updated', (collection) => onCollectionMutation(collection.id)),
    store.onEditorEvent('collection:deleted', (id) => {
      const state = store.graph.getSyncState()
      deleteFromYjsMap('collections', state.localToCollection, id, (remoteStableId) => {
        deleteCollectionMapping(state, id, remoteStableId)
      })
    })
  ]
  return () => {
    for (const unbind of unbinds) unbind()
  }
}

function isRootYnode(remoteStableId: string, ynode: Y.Map<unknown>): boolean {
  if (isMalformedRemoteNodeKey(remoteStableId)) return false
  return asString(ynode.get('parentId')) === remoteStableId
}

function findWinningRootCandidate(
  events: Y.YEvent<Y.Map<unknown>>[],
  ynodes: YNodes
): { remoteRootStableId: string; ynode: Y.Map<unknown> } | null {
  let sawChangedRootCandidate = false
  for (const { remoteStableId, ynode } of addedOrUpdatedYnodes(events, ynodes)) {
    if (isRootYnode(remoteStableId, ynode)) {
      sawChangedRootCandidate = true
      break
    }
  }
  if (!sawChangedRootCandidate) return null

  let winner: { remoteRootStableId: string; ynode: Y.Map<unknown> } | null = null
  for (const [remoteStableId, ynode] of ynodes.entries()) {
    if (!isRootYnode(remoteStableId, ynode)) continue
    if (winner === null || remoteStableId < winner.remoteRootStableId) {
      winner = { remoteRootStableId: remoteStableId, ynode }
    }
  }
  return winner
}

export function registerYjsObservers({
  store,
  ynodes,
  yimages,
  yvariables,
  ycollections,
  getSuppressYjsEvents,
  setSuppressGraphSync,
  applyYjsToGraph,
  updatePeersList,
  reconcileRemoteRoot
}: YjsObserverOptions) {
  ynodes.observeDeep((events) => {
    if (getSuppressYjsEvents()) return
    const rootCandidate = findWinningRootCandidate(events, ynodes)
    setSuppressGraphSync(true)
    try {
      const state = store.graph.getSyncState()
      if (
        rootCandidate !== null &&
        reconcileRemoteRoot !== undefined &&
        state.remoteRootStableId !== rootCandidate.remoteRootStableId
      ) {
        reconcileRemoteRoot(store, rootCandidate.remoteRootStableId, rootCandidate.ynode, ynodes)
      }
      applyYjsToGraph(events)
      switchToFirstAvailablePage(store)
      updatePeersList?.()
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

  yvariables.observeDeep((events) => {
    if (getSuppressYjsEvents()) return
    const graph = store.graph
    const state = graph.getSyncState()
    setSuppressGraphSync(true)
    try {
      applyYjsVariablesToGraph(graph, state, yvariables, events)
    } finally {
      setSuppressGraphSync(false)
    }
    store.requestRender()
  })

  ycollections.observeDeep((events) => {
    if (getSuppressYjsEvents()) return
    const graph = store.graph
    const state = graph.getSyncState()
    setSuppressGraphSync(true)
    try {
      applyYjsCollectionsToGraph(graph, state, ycollections, yvariables, events)
    } finally {
      setSuppressGraphSync(false)
    }
    store.requestRender()
  })
}

export function createYjsGraphSync({
  getStore,
  getYdoc,
  getYnodes,
  getYimages,
  getYvariables,
  getYcollections,
  setSuppressYjsEvents
}: YjsGraphSyncOptions) {
  function syncNodeImagesToYjs(
    store: ReturnType<YjsGraphSyncOptions['getStore']>,
    node: SceneNode,
    yimages: Y.Map<Uint8Array>
  ): void {
    for (const fill of node.fills) {
      if (fill.imageHash && !yimages.has(fill.imageHash)) {
        const data = store.graph.images.get(fill.imageHash)
        if (data) yimages.set(fill.imageHash, data)
      }
    }
  }

  function getActiveNodeSyncContext() {
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ydoc || !ynodes) return null

    const graph = store.graph
    const state = graph.getSyncState()
    if (state.remoteRootStableId === null) return null
    return { store, ydoc, ynodes, graph, state, remoteRootStableId: state.remoteRootStableId }
  }

  function nodeDepth(graph: SceneGraph, node: SceneNode): number {
    let depth = 0
    let parentId = node.parentId
    while (parentId !== null) {
      const parent = graph.getNode(parentId)
      if (parent === undefined) break
      depth++
      parentId = parent.parentId
    }
    return depth
  }

  function mergeNestedInstanceDescendantOverrides(
    graph: SceneGraph,
    state: GraphSyncState,
    nodeId: string,
    changes?: Partial<SceneNode>
  ): SceneNode | null {
    let ownerInstance = mergeInstanceDescendantOverridesForYjs(graph, state, nodeId, changes)
    let node = ownerInstance
    while (ownerInstance !== null) {
      node = ownerInstance
      ownerInstance = mergeInstanceDescendantOverridesForYjs(graph, state, node.id, {
        overrides: node.overrides
      })
    }
    return node
  }

  function deleteStaleScopedOrphanYnode(
    ynodes: YNodes,
    node: SceneNode,
    previousRemoteStableId: string | undefined,
    nextRemoteStableId: string
  ): void {
    if (previousRemoteStableId === undefined || previousRemoteStableId === nextRemoteStableId) {
      return
    }
    if (originalStableIdFromRemoteNodeKey(previousRemoteStableId) !== stableIdForNode(node)) {
      return
    }
    ynodes.delete(previousRemoteStableId)
  }

  function syncNodeToYjs(nodeId: string, changes?: Partial<SceneNode>) {
    const syncContext = getActiveNodeSyncContext()
    if (syncContext === null) return
    const { store, ydoc, ynodes, graph, state, remoteRootStableId } = syncContext
    const changedNode = graph.getNode(nodeId)
    if (!changedNode) return
    const ownerInstance = mergeNestedInstanceDescendantOverrides(graph, state, nodeId, changes)
    const node = ownerInstance ?? changedNode

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
        const previousRemoteStableId = state.localToRemote.get(node.id)
        const remoteStableId = ensureRemoteMappingForNode(graph, state, node)
        deleteStaleScopedOrphanYnode(ynodes, node, previousRemoteStableId, remoteStableId)
        ynode = ynodes.get(remoteStableId)
        if (ynode === undefined) {
          ynode = new Y.Map<unknown>()
          ynodes.set(remoteStableId, ynode)
        }
      }
      syncNodePropsToYMap(node, ynode, graph, state)

      if (localYimages) {
        syncNodeImagesToYjs(store, node, localYimages)
        if (ownerInstance !== null) syncNodeImagesToYjs(store, changedNode, localYimages)
      }
    })
    setSuppressYjsEvents(false)
  }

  function syncVariableToYjs(variableId: string) {
    const store = getStore()
    const ydoc = getYdoc()
    const yvariables = getYvariables()
    if (!ydoc || !yvariables) return
    const variable = store.graph.variables.get(variableId)
    if (!variable) return

    const graph = store.graph
    const state = graph.getSyncState()
    if (state.remoteRootStableId === null) return

    setSuppressYjsEvents(true)
    ydoc.transact(() => {
      syncVariableToYMap(graph, state, yvariables, variable)
    })
    setSuppressYjsEvents(false)
  }

  function syncCollectionToYjs(collectionId: string) {
    const store = getStore()
    const ydoc = getYdoc()
    const ycollections = getYcollections()
    if (!ydoc || !ycollections) return
    const collection = store.graph.variableCollections.get(collectionId)
    if (!collection) return

    const graph = store.graph
    const state = graph.getSyncState()
    if (state.remoteRootStableId === null) return

    setSuppressYjsEvents(true)
    ydoc.transact(() => {
      syncCollectionToYMap(graph, state, ycollections, collection)
    })
    setSuppressYjsEvents(false)
  }

  function syncAllNodesToYjs() {
    const syncContext = getActiveNodeSyncContext()
    if (syncContext === null) return
    const { store, ydoc, ynodes, graph, state } = syncContext

    const localYimages = getYimages()
    const nodesByDepth = [...store.graph.getAllNodes()].sort(
      (a, b) => nodeDepth(graph, b) - nodeDepth(graph, a)
    )
    for (const node of nodesByDepth) {
      mergeInstanceDescendantOverridesForYjs(graph, state, node.id)
    }

    setSuppressYjsEvents(true)
    ydoc.transact(() => {
      syncLocalRootToYjs(graph, state, ynodes)
      for (const node of store.graph.getAllNodes()) {
        if (node.id === graph.rootId) continue
        if (isComponentBackedInstanceDescendant(graph, node.id)) {
          state.localToRemote.delete(node.id)
          continue
        }
        const previousRemoteStableId = state.localToRemote.get(node.id)
        const remoteStableId = ensureRemoteMappingForNode(graph, state, node)
        deleteStaleScopedOrphanYnode(ynodes, node, previousRemoteStableId, remoteStableId)
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

    // Sync all variables and collections
    const yvariables = getYvariables()
    const ycollections = getYcollections()
    if (yvariables && ycollections) {
      ydoc.transact(() => {
        syncAllVariablesToYMap(graph, state, yvariables, ycollections)
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
    let deletedLocalNode = false

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
            deletedLocalNode = true
          }
          removeFromPendingQueues(state, remoteStableId)
        }
      }
    }

    if (deletedLocalNode) {
      releasePendingChildOrders(graph, state)
    }
  }

  return {
    syncNodeToYjs,
    syncVariableToYjs,
    syncCollectionToYjs,
    syncAllNodesToYjs,
    applyYjsToGraph
  }
}
