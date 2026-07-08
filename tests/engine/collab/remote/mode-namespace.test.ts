import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { createDefaultSource } from '@open-pencil/core'
import type { SceneGraph, VariableCollection } from '@open-pencil/scene-graph'

import {
  applyCollectionToGraph,
  applyVariableToGraph,
  applyYjsCollectionsToGraph,
  applyYjsVariablesToGraph
} from '@/app/collab/yjs-sync'

import {
  createRemoteCollectionMap,
  createRemoteVariableMap,
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '#tests/engine/collab/helpers'
import { bindHostGraphEvents } from '#tests/engine/collab/pending/helpers'

function createRestoreProbe(graph: ReturnType<typeof createTestStore>['graph'], id: string) {
  const page = graph.getPages()[0]
  return graph.createNode('RECTANGLE', page.id, { id, name: `Probe ${id}` }, { mode: 'restore' })
}

function figSource(id: string) {
  return { ...createDefaultSource(), id, format: 'fig' as const }
}

function expectRestoreBlocked(graph: SceneGraph, id: string): void {
  expect(graph.getImportedRuntimeIds()).toContain(id)
  expect(createRestoreProbe(graph, id).id).not.toBe(id)
}

function expectRestoreAvailable(graph: SceneGraph, id: string): void {
  expect(graph.getImportedRuntimeIds()).not.toContain(id)
  expect(createRestoreProbe(graph, id).id).toBe(id)
}

function addImportedCollection(
  graph: SceneGraph,
  collectionSourceId: string,
  modeSourceId: string
): VariableCollection {
  const collection: VariableCollection = {
    id: 'host-imported-collection-runtime',
    name: 'Host Imported Tokens',
    modes: [
      {
        modeId: 'host-imported-mode-runtime',
        name: 'Default',
        source: figSource(modeSourceId)
      }
    ],
    defaultModeId: 'host-imported-mode-runtime',
    variableIds: [],
    source: figSource(collectionSourceId)
  }
  graph.addCollection(collection)
  return collection
}

function replaceCollectionSources(
  graph: SceneGraph,
  collectionId: string,
  collectionSourceId: string,
  modeSourceId: string
): void {
  const collection = graph.variableCollections.get(collectionId)
  if (collection === undefined) throw new Error(`missing collection ${collectionId}`)
  graph.addCollection({
    ...collection,
    variableIds: [...collection.variableIds],
    modes: collection.modes.map((mode) => ({ ...mode, source: figSource(modeSourceId) })),
    source: figSource(collectionSourceId)
  })
}

function replaceVariableSource(graph: SceneGraph, variableId: string, sourceId: string): void {
  const variable = graph.variables.get(variableId)
  if (variable === undefined) throw new Error(`missing variable ${variableId}`)
  graph.addVariable({
    ...variable,
    valuesByMode: structuredClone(variable.valuesByMode),
    source: figSource(sourceId)
  })
}

describe('remote collection mode namespace', () => {
  test('remote collection modes reserve the node runtime namespace', () => {
    const store = createTestStore()
    const graph = store.graph
    const page = graph.getPages()[0]
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'remote:collection'
    const initialModeStableId = 'remote:mode:initial'
    const ycol = createRemoteCollectionMap(collectionStableId, initialModeStableId)
    ycollections.set(collectionStableId, ycol)

    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)
    const collectionId = state.collectionToLocal.get(collectionStableId)
    expect(collectionId).toBeDefined()
    if (collectionId === undefined) return
    const collection = graph.variableCollections.get(collectionId)
    expect(collection).toBeDefined()
    if (collection === undefined) return
    const initialModeId = collection.modes[0].modeId

    const whileInitialModeExists = graph.createNode('RECTANGLE', page.id, {
      id: initialModeId,
      name: 'Initial mode collision probe'
    })
    expect(whileInitialModeExists.id).not.toBe(initialModeId)

    const replacementModeStableId = 'remote:mode:replacement'
    ycol.set('defaultModeId', replacementModeStableId)
    ycol.set(
      'modes',
      JSON.stringify([
        {
          modeId: replacementModeStableId,
          name: 'Replacement',
          sourceId: replacementModeStableId,
          sourceFormat: null
        }
      ])
    )
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const updatedCollection = graph.variableCollections.get(collectionId)
    expect(updatedCollection).toBeDefined()
    if (updatedCollection === undefined) return
    const replacementModeId = updatedCollection.modes[0].modeId
    expect(state.modeToLocal.get(collectionStableId)?.has(initialModeStableId)).toBe(false)
    const afterInitialModeRemoval = graph.createNode('RECTANGLE', page.id, {
      id: initialModeId,
      name: 'Removed mode reuse probe'
    })
    const whileReplacementModeExists = graph.createNode('RECTANGLE', page.id, {
      id: replacementModeId,
      name: 'Replacement mode collision probe'
    })

    expect(afterInitialModeRemoval.id).toBe(initialModeId)
    expect(whileReplacementModeExists.id).not.toBe(replacementModeId)

    ycol.set('defaultModeId', initialModeStableId)
    ycol.set(
      'modes',
      JSON.stringify([
        {
          modeId: initialModeStableId,
          name: 'Initial restored',
          sourceId: initialModeStableId,
          sourceFormat: null
        }
      ])
    )
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const restoredCollection = graph.variableCollections.get(collectionId)
    expect(restoredCollection).toBeDefined()
    if (restoredCollection === undefined) return
    const restoredModeId = restoredCollection.modes[0].modeId
    const whileRestoredModeExists = graph.createNode('RECTANGLE', page.id, {
      id: restoredModeId,
      name: 'Restored mode collision probe'
    })

    expect(restoredModeId).not.toBe(initialModeId)
    expect(whileRestoredModeExists.id).not.toBe(restoredModeId)
  })

  test('remote fig collection and mode sources reserve imported runtime ids', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'remote:fig-source-collection'
    const modeStableId = 'remote:fig-source-mode'
    const collectionSourceId = 'fig-collection-source'
    const modeSourceId = 'fig-mode-source'
    const ycol = createRemoteCollectionMap(collectionStableId, modeStableId)
    ycol.set('sourceId', collectionSourceId)
    ycol.set('sourceFormat', 'fig')
    ycol.set(
      'modes',
      JSON.stringify([
        { modeId: modeStableId, name: 'Default', sourceId: modeSourceId, sourceFormat: 'fig' }
      ])
    )
    ycollections.set(collectionStableId, ycol)

    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    expect(graph.getImportedRuntimeIds()).toContain(collectionSourceId)
    expect(graph.getImportedRuntimeIds()).toContain(modeSourceId)
    expect(createRestoreProbe(graph, collectionSourceId).id).not.toBe(collectionSourceId)
    expect(createRestoreProbe(graph, modeSourceId).id).not.toBe(modeSourceId)
  })

  test('remote fig collection source replacement and deletion release stale sources', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'remote:fig-source-replacement'
    const initialModeStableId = 'remote:fig-source-initial-mode'
    const initialCollectionSourceId = 'fig-collection-source:old'
    const initialModeSourceId = 'fig-mode-source:old'
    const replacementCollectionSourceId = 'fig-collection-source:new'
    const replacementModeStableId = 'remote:fig-source-replacement-mode'
    const replacementModeSourceId = 'fig-mode-source:new'
    const ycol = createRemoteCollectionMap(collectionStableId, initialModeStableId)
    ycol.set('sourceId', initialCollectionSourceId)
    ycol.set('sourceFormat', 'fig')
    ycol.set(
      'modes',
      JSON.stringify([
        {
          modeId: initialModeStableId,
          name: 'Initial',
          sourceId: initialModeSourceId,
          sourceFormat: 'fig'
        }
      ])
    )
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    ycol.set('sourceId', replacementCollectionSourceId)
    ycol.set('defaultModeId', replacementModeStableId)
    ycol.set(
      'modes',
      JSON.stringify([
        {
          modeId: replacementModeStableId,
          name: 'Replacement',
          sourceId: replacementModeSourceId,
          sourceFormat: 'fig'
        }
      ])
    )
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    expect(createRestoreProbe(graph, initialCollectionSourceId).id).toBe(initialCollectionSourceId)
    expect(createRestoreProbe(graph, initialModeSourceId).id).toBe(initialModeSourceId)
    expect(createRestoreProbe(graph, replacementCollectionSourceId).id).not.toBe(
      replacementCollectionSourceId
    )
    expect(createRestoreProbe(graph, replacementModeSourceId).id).not.toBe(replacementModeSourceId)

    let collectionEvents: Y.YEvent<Y.Map<unknown>>[] = []
    ycollections.observeDeep((nextEvents) => {
      for (const event of nextEvents) void event.changes.keys
      collectionEvents = nextEvents
    })
    ycollections.delete(collectionStableId)
    applyYjsCollectionsToGraph(graph, state, ycollections, yvariables, collectionEvents)

    expect(createRestoreProbe(graph, replacementCollectionSourceId).id).toBe(
      replacementCollectionSourceId
    )
    expect(createRestoreProbe(graph, replacementModeSourceId).id).toBe(replacementModeSourceId)
  })

  test('remote fig variable sources reserve and release imported runtime ids', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'remote:fig-variable-collection'
    const modeStableId = 'remote:fig-variable-mode'
    const variableStableId = 'remote:fig-variable'
    const initialVariableSourceId = 'fig-variable-source:old'
    const replacementVariableSourceId = 'fig-variable-source:new'
    const ycol = createRemoteCollectionMap(collectionStableId, modeStableId, [variableStableId])
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)
    const yvar = createRemoteVariableMap(variableStableId, collectionStableId, {
      [modeStableId]: 4
    })
    yvar.set('sourceId', initialVariableSourceId)
    yvar.set('sourceFormat', 'fig')
    yvariables.set(variableStableId, yvar)
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    expect(graph.getImportedRuntimeIds()).toContain(initialVariableSourceId)
    expect(createRestoreProbe(graph, initialVariableSourceId).id).not.toBe(initialVariableSourceId)

    yvar.set('sourceId', replacementVariableSourceId)
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    expect(createRestoreProbe(graph, initialVariableSourceId).id).toBe(initialVariableSourceId)
    expect(createRestoreProbe(graph, replacementVariableSourceId).id).not.toBe(
      replacementVariableSourceId
    )

    let variableEvents: Y.YEvent<Y.Map<unknown>>[] = []
    yvariables.observeDeep((nextEvents) => {
      for (const event of nextEvents) void event.changes.keys
      variableEvents = nextEvents
    })
    yvariables.delete(variableStableId)
    applyYjsVariablesToGraph(graph, state, yvariables, variableEvents)

    expect(createRestoreProbe(graph, replacementVariableSourceId).id).toBe(
      replacementVariableSourceId
    )
  })

  test('remote fig sources share ref counts with local nodes across replacement and deletion', () => {
    const store = createTestStore()
    const graph = store.graph
    const page = graph.getPages()[0]
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'remote:fig-shared-refcount-collection'
    const modeStableId = 'remote:fig-shared-refcount-mode'
    const variableStableId = 'remote:fig-shared-refcount-variable'
    const sharedSourceId = 'fig-shared-source:all-remote-domains'
    const replacementCollectionSourceId = 'fig-shared-source:collection-replacement'
    const replacementModeSourceId = 'fig-shared-source:mode-replacement'
    const replacementVariableSourceId = 'fig-shared-source:variable-replacement'
    const sharedNode = graph.createNode('RECTANGLE', page.id, {
      name: 'Shared local source node',
      source: figSource(sharedSourceId)
    })
    const ycol = createRemoteCollectionMap(collectionStableId, modeStableId, [variableStableId])
    ycol.set('sourceId', sharedSourceId)
    ycol.set('sourceFormat', 'fig')
    ycol.set(
      'modes',
      JSON.stringify([
        { modeId: modeStableId, name: 'Default', sourceId: sharedSourceId, sourceFormat: 'fig' }
      ])
    )
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)
    const yvar = createRemoteVariableMap(variableStableId, collectionStableId, {
      [modeStableId]: 4
    })
    yvar.set('sourceId', sharedSourceId)
    yvar.set('sourceFormat', 'fig')
    yvariables.set(variableStableId, yvar)
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    expect(graph.getImportedRuntimeIds()).toContain(sharedSourceId)

    graph.deleteNode(sharedNode.id, { permanent: true })
    expect(graph.getImportedRuntimeIds()).toContain(sharedSourceId)
    expect(createRestoreProbe(graph, sharedSourceId).id).not.toBe(sharedSourceId)

    yvar.set('sourceId', replacementVariableSourceId)
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)
    expect(graph.getImportedRuntimeIds()).toContain(sharedSourceId)
    expect(createRestoreProbe(graph, replacementVariableSourceId).id).not.toBe(
      replacementVariableSourceId
    )

    ycol.set('sourceId', replacementCollectionSourceId)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)
    expect(graph.getImportedRuntimeIds()).toContain(sharedSourceId)
    expect(createRestoreProbe(graph, replacementCollectionSourceId).id).not.toBe(
      replacementCollectionSourceId
    )

    ycol.set(
      'modes',
      JSON.stringify([
        {
          modeId: modeStableId,
          name: 'Default',
          sourceId: replacementModeSourceId,
          sourceFormat: 'fig'
        }
      ])
    )
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)
    expect(graph.getImportedRuntimeIds()).not.toContain(sharedSourceId)
    expect(graph.getImportedRuntimeIds()).toContain(replacementModeSourceId)
    expect(createRestoreProbe(graph, sharedSourceId).id).toBe(sharedSourceId)

    let variableEvents: Y.YEvent<Y.Map<unknown>>[] = []
    yvariables.observeDeep((nextEvents) => {
      for (const event of nextEvents) void event.changes.keys
      variableEvents = nextEvents
    })
    yvariables.delete(variableStableId)
    applyYjsVariablesToGraph(graph, state, yvariables, variableEvents)
    expect(createRestoreProbe(graph, replacementVariableSourceId).id).toBe(
      replacementVariableSourceId
    )

    let collectionEvents: Y.YEvent<Y.Map<unknown>>[] = []
    ycollections.observeDeep((nextEvents) => {
      for (const event of nextEvents) void event.changes.keys
      collectionEvents = nextEvents
    })
    ycollections.delete(collectionStableId)
    applyYjsCollectionsToGraph(graph, state, ycollections, yvariables, collectionEvents)

    expect(createRestoreProbe(graph, replacementCollectionSourceId).id).toBe(
      replacementCollectionSourceId
    )
    expect(createRestoreProbe(graph, replacementModeSourceId).id).toBe(replacementModeSourceId)
  })

  test('imported fig variable sources stay reserved through full peer propagation', () => {
    const hostStore = createTestStore()
    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    const initialCollectionSource = 'fig-peer-source:collection:initial'
    const initialModeSource = 'fig-peer-source:mode:initial'
    const initialVariableSource = 'fig-peer-source:variable:initial'
    const sharedReplacementSource = 'fig-peer-source:shared-replacement'
    const replacementCollectionSource = 'fig-peer-source:collection:replacement'
    const replacementModeSource = 'fig-peer-source:mode:replacement'
    const collection = addImportedCollection(
      hostStore.graph,
      initialCollectionSource,
      initialModeSource
    )
    const variable = {
      id: 'host-imported-variable-runtime',
      name: 'Host Imported Gap',
      type: 'FLOAT' as const,
      collectionId: collection.id,
      valuesByMode: { [collection.defaultModeId]: 8 },
      description: '',
      hiddenFromPublishing: false,
      source: figSource(initialVariableSource)
    }
    hostStore.graph.addVariable(variable)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)

    expectRestoreBlocked(joinerStore.graph, initialCollectionSource)
    expectRestoreBlocked(joinerStore.graph, initialModeSource)
    expectRestoreBlocked(joinerStore.graph, initialVariableSource)

    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)
    replaceVariableSource(hostStore.graph, variable.id, sharedReplacementSource)
    replaceCollectionSources(
      hostStore.graph,
      collection.id,
      sharedReplacementSource,
      sharedReplacementSource
    )
    encodeAndApply(hostYdoc, joinerYdoc)

    expectRestoreAvailable(joinerStore.graph, initialVariableSource)
    expectRestoreAvailable(joinerStore.graph, initialCollectionSource)
    expectRestoreAvailable(joinerStore.graph, initialModeSource)
    expectRestoreBlocked(joinerStore.graph, sharedReplacementSource)

    hostStore.graph.removeVariable(variable.id)
    encodeAndApply(hostYdoc, joinerYdoc)
    expectRestoreBlocked(joinerStore.graph, sharedReplacementSource)

    replaceCollectionSources(
      hostStore.graph,
      collection.id,
      replacementCollectionSource,
      sharedReplacementSource
    )
    encodeAndApply(hostYdoc, joinerYdoc)
    expectRestoreBlocked(joinerStore.graph, sharedReplacementSource)
    expectRestoreBlocked(joinerStore.graph, replacementCollectionSource)

    replaceCollectionSources(
      hostStore.graph,
      collection.id,
      replacementCollectionSource,
      replacementModeSource
    )
    encodeAndApply(hostYdoc, joinerYdoc)
    expectRestoreAvailable(joinerStore.graph, sharedReplacementSource)
    expectRestoreBlocked(joinerStore.graph, replacementCollectionSource)
    expectRestoreBlocked(joinerStore.graph, replacementModeSource)

    hostStore.graph.removeCollection(collection.id)
    encodeAndApply(hostYdoc, joinerYdoc)
    unbind()

    expectRestoreAvailable(joinerStore.graph, replacementCollectionSource)
    expectRestoreAvailable(joinerStore.graph, replacementModeSource)
  })
})
