import * as Y from 'yjs'

import { SceneGraph } from '@open-pencil/core'
import type { EditorEvents } from '@open-pencil/core/editor'
import type { SceneNode, Variable, VariableCollection } from '@open-pencil/core/scene-graph'

import {
  applyYnodeToGraph,
  applyYjsCollectionsToGraph,
  applyYjsVariablesToGraph,
  createYjsGraphSync,
  stableIdForNode,
  yNodeToProps,
  type ReconcileRootFn
} from '@/app/collab/yjs-sync'

/**
 * Minimal store shape required by the collab sync code.
 * The real EditorStore has many more properties, but the collab
 * binding only accesses graph, requestRender, and onEditorEvent.
 */
export interface TestStore {
  graph: SceneGraph
  requestRender: () => void
  onEditorEvent: <K extends keyof EditorEvents>(event: K, handler: EditorEvents[K]) => () => void
}

/**
 * Bridge editor-event subscriptions to the SceneGraph emitter.
 *
 * TypeScript cannot narrow a generic type parameter (`K`) inside a switch
 * case, so `handler` is still typed as `EditorEvents[K]` — not the specific
 * overload for each case.  The `as` casts below adapt the generic handler
 * to the concrete SceneGraphEventHandlers callback shapes.  These casts are
 * safe because `EditorEvents` extends `SceneGraphEvents`, so the handler
 * types are structurally identical.
 */
function createNodeEventBridge(graph: SceneGraph) {
  return <K extends keyof EditorEvents>(event: K, handler: EditorEvents[K]): (() => void) => {
    switch (event) {
      case 'node:created':
        return graph.onNodeEvents({ created: handler as (node: SceneNode) => void })
      case 'node:updated':
        return graph.onNodeEvents({
          updated: handler as (id: string, changes: Partial<SceneNode>) => void
        })
      case 'node:deleted':
        return graph.onNodeEvents({ deleted: handler as (id: string) => void })
      case 'node:reparented':
        return graph.onNodeEvents({
          reparented: handler as (
            nodeId: string,
            oldParentId: string | null,
            newParentId: string
          ) => void
        })
      case 'node:reordered':
        return graph.onNodeEvents({
          reordered: handler as (nodeId: string, parentId: string, index: number) => void
        })
      case 'variable:created':
        return graph.onNodeEvents({ variableCreated: handler as (v: Variable) => void })
      case 'variable:deleted':
        return graph.onNodeEvents({ variableDeleted: handler as (id: string) => void })
      case 'collection:created':
        return graph.onNodeEvents({ collectionCreated: handler as (c: VariableCollection) => void })
      case 'collection:updated':
        return graph.onNodeEvents({ collectionUpdated: handler as (c: VariableCollection) => void })
      case 'collection:deleted':
        return graph.onNodeEvents({ collectionDeleted: handler as (id: string) => void })
      default:
        return () => undefined
    }
  }
}

export function createTestStore(graph?: SceneGraph): TestStore {
  const g = graph ?? new SceneGraph()
  return {
    graph: g,
    requestRender: () => {
      // no-op render stub for collab tests
    },
    onEditorEvent: createNodeEventBridge(g)
  }
}

export function createTestYjsSync(store: TestStore, ydoc: Y.Doc) {
  let suppressYjsEvents = false
  const ynodes = ydoc.getMap<Y.Map<unknown>>('nodes')
  const yimages = ydoc.getMap<Uint8Array>('images')
  const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
  const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
  const sync = createYjsGraphSync({
    getStore: () => store,
    getYdoc: () => ydoc,
    getYnodes: () => ynodes,
    getYimages: () => yimages,
    getYvariables: () => yvariables,
    getYcollections: () => ycollections,
    setSuppressYjsEvents: (value) => {
      suppressYjsEvents = value
    }
  })

  function reconcileRoot(
    targetStore: TestStore,
    remoteRootStableId: string,
    hostRootYnode: Y.Map<unknown>
  ): void {
    const graph = targetStore.graph
    const state = graph.getSyncState()
    if (state.rootMapped) {
      const currentRemote = state.remoteRootStableId
      if (currentRemote === remoteRootStableId) return
      if (currentRemote !== null && currentRemote < remoteRootStableId) return
      if (currentRemote !== null) state.remoteToLocal.delete(currentRemote)
      state.localToRemote.delete(graph.rootId)
      state.rootMapped = false
      state.remoteRootStableId = null
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
  }

  return {
    ...sync,
    ynodes,
    yimages,
    yvariables,
    ycollections,
    getSuppressYjsEvents: () => suppressYjsEvents,
    setSuppressYjsEvents: (value: boolean) => {
      suppressYjsEvents = value
    },
    reconcileRoot
  }
}

export function makeHostRootState(store: TestStore): string {
  const root = store.graph.getNode(store.graph.rootId)
  if (root === undefined) {
    throw new Error('host graph has no root')
  }
  const state = store.graph.getSyncState()
  const hostRootStableId = stableIdForNode(root)
  state.remoteRootStableId = hostRootStableId
  state.remoteToLocal.set(hostRootStableId, store.graph.rootId)
  state.localToRemote.set(store.graph.rootId, hostRootStableId)
  state.rootMapped = true
  return hostRootStableId
}

export function observeTargetDoc(
  store: TestStore,
  ydoc: Y.Doc,
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void,
  reconcileRemoteRoot?: ReconcileRootFn
): () => void {
  let suppressGraphSync = false
  const ynodes = ydoc.getMap<Y.Map<unknown>>('nodes')
  const yimages = ydoc.getMap<Uint8Array>('images')
  const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
  const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')

  const nodesHandler = (events: Y.YEvent<Y.Map<unknown>>[]): void => {
    if (suppressGraphSync) return
    const state = store.graph.getSyncState()
    if (reconcileRemoteRoot !== undefined) {
      for (const event of events) {
        if (event.target === ynodes) {
          for (const [remoteStableId, change] of event.changes.keys) {
            if (change.action === 'add' || change.action === 'update') {
              const ynode = ynodes.get(remoteStableId)
              if (ynode === undefined) continue
              const parentId = (ynode.get('parentId') as string | undefined) ?? null
              if (parentId === remoteStableId) {
                // Root candidate found — reconcile even if we already have a root
                // (handles split-brain when both peers called shareCurrentDoc)
                if (state.remoteRootStableId !== remoteStableId) {
                  reconcileRemoteRoot(store, remoteStableId, ynode, ynodes)
                }
                break
              }
            }
          }
        }
      }
    }
    suppressGraphSync = true
    try {
      applyYjsToGraph(events)
    } finally {
      suppressGraphSync = false
    }
    store.requestRender()
  }
  ynodes.observeDeep(nodesHandler)

  const imagesHandler = (event: Y.YMapEvent<Uint8Array>): void => {
    if (suppressGraphSync) return
    for (const [key, change] of event.changes.keys) {
      if (change.action === 'add' || change.action === 'update') {
        const data = yimages.get(key)
        if (data) store.graph.images.set(key, new Uint8Array(data))
      } else {
        store.graph.images.delete(key)
      }
    }
    store.requestRender()
  }
  yimages.observe(imagesHandler)

  const variablesHandler = (events: Y.YEvent<Y.Map<unknown>>[]): void => {
    if (suppressGraphSync) return
    const graph = store.graph
    const state = graph.getSyncState()
    suppressGraphSync = true
    try {
      applyYjsVariablesToGraph(graph, state, yvariables, events)
    } finally {
      suppressGraphSync = false
    }
    store.requestRender()
  }
  yvariables.observeDeep(variablesHandler)

  const collectionsHandler = (events: Y.YEvent<Y.Map<unknown>>[]): void => {
    if (suppressGraphSync) return
    const graph = store.graph
    const state = graph.getSyncState()
    suppressGraphSync = true
    try {
      applyYjsCollectionsToGraph(graph, state, ycollections, events)
    } finally {
      suppressGraphSync = false
    }
    store.requestRender()
  }
  ycollections.observeDeep(collectionsHandler)

  return () => {
    ynodes.unobserveDeep(nodesHandler)
    yimages.unobserve(imagesHandler)
    yvariables.unobserveDeep(variablesHandler)
    ycollections.unobserveDeep(collectionsHandler)
  }
}

export function encodeAndApply(fromDoc: Y.Doc, toDoc: Y.Doc): void {
  const update = Y.encodeStateAsUpdate(fromDoc)
  Y.applyUpdate(toDoc, update)
}

export function cloneYnode(
  source: Y.Map<unknown>,
  targetYn: Y.Map<Y.Map<unknown>>,
  key: string
): void {
  const props = yNodeToProps(source)
  const ynode = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(props)) {
    ynode.set(k, v)
  }
  targetYn.set(key, ynode)
}

export const reconcileRemoteRoot: ReconcileRootFn = (store, remoteRootStableId, ynode, ynodes) => {
  const graph = store.graph
  const state = graph.getSyncState()
  if (state.rootMapped) {
    const currentRemote = state.remoteRootStableId
    if (currentRemote === remoteRootStableId) return
    if (currentRemote !== null && currentRemote < remoteRootStableId) return
    if (currentRemote !== null) state.remoteToLocal.delete(currentRemote)
    state.localToRemote.delete(graph.rootId)
    state.rootMapped = false
    state.remoteRootStableId = null
  }
  state.remoteRootStableId = remoteRootStableId
  state.remoteToLocal.set(remoteRootStableId, graph.rootId)
  state.localToRemote.set(graph.rootId, remoteRootStableId)
  state.rootMapped = true
  applyYnodeToGraph(graph, state, ynodes, remoteRootStableId, ynode)
  for (const stableId of state.pendingUntilRoot) {
    const pendingYnode = ynodes.get(stableId)
    if (pendingYnode !== undefined) {
      applyYnodeToGraph(graph, state, ynodes, stableId, pendingYnode)
    }
  }
  state.pendingUntilRoot.clear()
}
