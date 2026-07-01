import { describe, expect, test } from 'bun:test'

import {
  SceneGraph,
  createDefaultSource,
  type Variable,
  type VariableCollection
} from '@open-pencil/core'

import { deserializeSceneGraph, serializeSceneGraph } from '#core/kiwi/fig/parse/transfer'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

function figSource(id: string) {
  return {
    format: 'fig' as const,
    id,
    orderKey: null,
    fig: {
      rawSize: null,
      rawTransform: null,
      rawNodeFields: {},
      layout: null,
      symbolOverrides: [],
      componentPropAssignments: [],
      derivedSymbolData: [],
      derivedSymbolDataLayoutVersion: null,
      uniformScaleFactor: null
    }
  }
}

function variableWithSource(id: string, collectionId: string, sourceId: string): Variable {
  return {
    id,
    name: id,
    type: 'FLOAT',
    collectionId,
    valuesByMode: {},
    description: '',
    hiddenFromPublishing: false,
    source: figSource(sourceId)
  }
}

function collectionWithModeSource(collectionId: string, modeSourceId: string): VariableCollection {
  return {
    id: collectionId,
    name: collectionId,
    modes: [
      { modeId: `${collectionId}:base-mode`, name: 'Base', source: createDefaultSource() },
      { modeId: `${collectionId}:imported-mode`, name: 'Imported', source: figSource(modeSourceId) }
    ],
    defaultModeId: `${collectionId}:base-mode`,
    variableIds: [],
    source: createDefaultSource()
  }
}

function restoreProbe(graph: SceneGraph, sourceId: string, name: string) {
  return graph.createNode(
    'RECTANGLE',
    pageId(graph),
    { id: sourceId, name, source: figSource(sourceId) },
    { mode: 'restore' }
  )
}

/**
 * C-07: pickRuntimeId third branch doesn't check variables/collections/modes.
 *
 * The third branch of pickRuntimeId (default mode, no existing node, not
 * reserved) returns the requested runtime ID without checking if it collides
 * with a variable ID, collection ID, or mode ID. Unlike generateNodeId which
 * checks all five namespaces, this branch only checks nodes and reservedRuntimeIds.
 *
 * How it fails: A caller passing an ID that matches a variable ID gets a
 * namespace collision — the node and variable share the same ID string.
 *
 * Fix that makes it pass: Add `!this.host.variables.has(requestedRuntimeId) &&
 * !this.host.variableCollections.has(requestedRuntimeId) && !this.hasModeId(requestedRuntimeId)`
 * to the third branch condition.
 */
describe('C-07: pickRuntimeId namespace collision with variables', () => {
  test('createNode with ID matching a variable ID should not collide', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    // Create a variable — it gets a runtime ID from generateNodeId
    const collection = graph.createCollection('Colors')
    const variable = graph.createVariable('Primary', 'COLOR', collection.id)

    const variableId = variable.id
    expect(variableId).toBeTruthy()

    // Now try to create a node with the SAME ID as the variable
    // pickRuntimeId should reject this collision, but the third branch
    // only checks nodes and reservedRuntimeIds — not variables
    const node = graph.createNode('RECTANGLE', page, {
      id: variableId,
      name: 'Box'
    })

    // The node should NOT have the same ID as the variable
    // FAILS: node.id === variableId (namespace collision)
    expect(node.id).not.toBe(variableId)
  })

  test('createNode with ID matching a collection ID should not collide', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const collection = graph.createCollection('Colors')
    const collectionId = collection.id

    // Try to create a node with the same ID as the collection
    const node = graph.createNode('RECTANGLE', page, {
      id: collectionId,
      name: 'Box'
    })

    // FAILS: node.id === collectionId (namespace collision)
    expect(node.id).not.toBe(collectionId)
  })

  test('createNode with ID matching a freshly created collection mode should not collide', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const collection = graph.createCollection('Colors')
    const modeId = collection.modes[0].modeId

    const node = graph.createNode('RECTANGLE', page, {
      id: modeId,
      name: 'Box'
    })

    expect(node.id).not.toBe(modeId)
  })

  test('createNode rejects added mode IDs until the mode is removed', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const collection = graph.createCollection('Colors')
    const modeId = 'mode:dark'

    graph.addMode(collection.id, modeId, 'Dark')
    const whileModeExists = graph.createNode('RECTANGLE', page, {
      id: modeId,
      name: 'Box while mode exists'
    })
    expect(whileModeExists.id).not.toBe(modeId)

    graph.removeMode(collection.id, modeId)
    const afterModeRemoval = graph.createNode('RECTANGLE', page, {
      id: modeId,
      name: 'Box after mode removal'
    })
    expect(afterModeRemoval.id).toBe(modeId)
  })

  test('transfer deserialization rebuilds mode and stable ID caches', () => {
    const source = new SceneGraph({ sessionID: 2468 })
    const collection = source.createCollection('Colors')
    const modeId = collection.modes[0].modeId
    const root = source.getNode(source.rootId)
    if (!root) throw new Error('source graph root is missing')
    const rootStableId = source.getStableId(root)

    const restored = deserializeSceneGraph(serializeSceneGraph(source))
    const page = pageId(restored)
    const node = restored.createNode('RECTANGLE', page, {
      id: modeId,
      name: 'Box after transfer'
    })

    expect(restored.stableIdToRuntimeId(rootStableId)).toBe(restored.rootId)
    expect(node.id).not.toBe(modeId)
  })

  test('generated source IDs skip collection and mode namespaces', () => {
    const graph = new SceneGraph({ sessionID: 2468 })
    const page = pageId(graph)

    graph.addCollection({
      id: '2468:3',
      name: 'Imported tokens',
      modes: [{ modeId: '2468:4', name: 'Imported mode', source: createDefaultSource() }],
      defaultModeId: '2468:4',
      variableIds: [],
      source: createDefaultSource()
    })

    const node = graph.createNode('RECTANGLE', page, { name: 'Box' })

    expect(node.source.id).not.toBe('2468:3')
    expect(node.source.id).not.toBe('2468:4')
    expect(node.id).not.toBe('2468:3')
    expect(node.id).not.toBe('2468:4')
  })

  test('generated source IDs skip reserved imported runtime IDs', () => {
    const graph = new SceneGraph({
      sessionID: 9753,
      reservedRuntimeIds: ['9753:1', '9753:3']
    })

    const sourceIds = [...graph.getAllNodes()].map((node) => node.source.id)

    expect(sourceIds).not.toContain('9753:1')
    expect(sourceIds).not.toContain('9753:3')
  })

  test('restore-mode preferred runtime ID waits for an imported variable source to release it', () => {
    const graph = new SceneGraph({ sessionID: 8642 })
    const sourceId = '0:restore-blocked-by-variable-source'
    const collection = graph.createCollection('Variable source reservation')
    graph.addVariable(variableWithSource('variable:restore-blocker', collection.id, sourceId))

    const blocked = restoreProbe(graph, sourceId, 'Blocked by variable source')
    expect(blocked.id).not.toBe(sourceId)
    expect(blocked.source).toMatchObject({ format: 'fig', id: sourceId })
    expect(graph.stableIdToRuntimeId(sourceId)).toBe(blocked.id)
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(true)

    graph.deleteNode(blocked.id, { permanent: true })
    graph.removeVariable('variable:restore-blocker')
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(false)

    const restored = restoreProbe(graph, sourceId, 'Restored after variable source release')
    expect(restored.id).toBe(sourceId)
    expect(restored.source).toMatchObject({ format: 'fig', id: sourceId })
    expect(graph.stableIdToRuntimeId(sourceId)).toBe(restored.id)
  })

  test('restore-mode preferred runtime ID waits for an imported collection mode source to release it', () => {
    const graph = new SceneGraph({ sessionID: 8643 })
    const sourceId = '0:restore-blocked-by-mode-source'
    const collection = collectionWithModeSource('collection:mode-source-reservation', sourceId)
    graph.addCollection(collection)

    const blocked = restoreProbe(graph, sourceId, 'Blocked by mode source')
    expect(blocked.id).not.toBe(sourceId)
    expect(blocked.source).toMatchObject({ format: 'fig', id: sourceId })
    expect(graph.stableIdToRuntimeId(sourceId)).toBe(blocked.id)
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(true)

    graph.deleteNode(blocked.id, { permanent: true })
    graph.removeMode(collection.id, `${collection.id}:imported-mode`)
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(false)

    const restored = restoreProbe(graph, sourceId, 'Restored after mode source release')
    expect(restored.id).toBe(sourceId)
    expect(restored.source).toMatchObject({ format: 'fig', id: sourceId })
    expect(graph.stableIdToRuntimeId(sourceId)).toBe(restored.id)
  })

  test('restore-mode preferred runtime ID waits for shared live node source refs to release it', () => {
    const graph = new SceneGraph({ sessionID: 8644 })
    const sourceId = '0:restore-blocked-by-node-source-ref'
    const page = pageId(graph)
    const liveImportedNode = graph.createNode('RECTANGLE', page, {
      id: 'runtime:live-imported-source-ref',
      name: 'Live imported source ref',
      source: figSource(sourceId)
    })

    expect(liveImportedNode.id).toBe('runtime:live-imported-source-ref')
    expect(graph.stableIdToRuntimeId(sourceId)).toBe(liveImportedNode.id)

    const blocked = restoreProbe(graph, sourceId, 'Blocked by live node source ref')
    expect(blocked.id).not.toBe(sourceId)
    expect(blocked.source).toMatchObject({ format: 'fig', id: sourceId })
    expect(graph.stableIdToRuntimeId(sourceId)).toBe(liveImportedNode.id)
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(true)

    graph.deleteNode(blocked.id, { permanent: true })
    graph.deleteNode(liveImportedNode.id, { permanent: true })
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(false)

    const restored = restoreProbe(graph, sourceId, 'Restored after live node source release')
    expect(restored.id).toBe(sourceId)
    expect(restored.source).toMatchObject({ format: 'fig', id: sourceId })
    expect(graph.stableIdToRuntimeId(sourceId)).toBe(restored.id)
  })
})
