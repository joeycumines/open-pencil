import { describe, expect, test } from 'bun:test'

import { SceneGraph, type Variable, type VariableCollection } from '@open-pencil/core'

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

function collectionWithSource(sourceId: string): VariableCollection {
  return {
    id: `collection:${sourceId}`,
    name: `Collection ${sourceId}`,
    modes: [{ modeId: `mode:${sourceId}`, name: 'Default', source: figSource(`mode:${sourceId}`) }],
    defaultModeId: `mode:${sourceId}`,
    variableIds: [],
    source: figSource(sourceId)
  }
}

function variableWithSource(id: string, collectionId: string, sourceId: string): Variable {
  return {
    id,
    name: `Variable ${id}`,
    type: 'FLOAT',
    collectionId,
    valuesByMode: {},
    description: '',
    hiddenFromPublishing: false,
    source: figSource(sourceId)
  }
}

/**
 * C-06: maybeUnreserveImportedId unconditionally unreserves shared source.ids.
 *
 * When two nodes share the same Figma GUID (source.id), deleting one with
 * permanent: true calls maybeUnreserveImportedId, which removes the GUID from
 * reservedRuntimeIds without checking if other nodes still reference it.
 * This breaks undo for the surviving node — when undo tries to restore the
 * deleted node, pickRuntimeId's restore-mode guard (which checks `reserved`)
 * fails because the GUID was unreserved, and the node gets a different runtime ID.
 *
 * How it fails: After deleting node B (which shares source.id '0:99' with
 * node A), '0:99' is unreserved. Undo of node B's delete fails to restore
 * the original runtime ID because the reserved check fails.
 *
 * Fix that makes it pass: maybeUnreserveImportedId checks if any other node
 * still references the same source.id before unreserving.
 */
describe('C-06: maybeUnreserveImportedId unconditionally unreserves shared GUIDs', () => {
  test('deleting one node with shared GUID should not unreserve if other nodes reference it', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    // Create two nodes with the SAME Figma GUID '0:99'
    // First node gets runtime ID '0:99' (available)
    const nodeA = graph.createNode('RECTANGLE', page, {
      name: 'A',
      width: 50,
      height: 50,
      source: figSource('0:99')
    })
    expect(nodeA.id).toBe('0:99')
    expect(nodeA.source.id).toBe('0:99')

    // Second node with same GUID — gets a different runtime ID (collision)
    const nodeB = graph.createNode('RECTANGLE', page, {
      name: 'B',
      width: 50,
      height: 50,
      x: 100,
      source: figSource('0:99')
    })
    expect(nodeB.source.id).toBe('0:99')
    expect(nodeB.id).not.toBe('0:99') // different runtime ID due to collision

    // Recompute reserved IDs so '0:99' is in the reserved set
    graph.identity.recomputeReservedRuntimeIds()

    // '0:99' should be reserved (both nodes reference it)
    const reservedBefore = graph.identity.getImportedRuntimeIds()
    expect(reservedBefore.has('0:99')).toBe(true)

    // Delete node B with permanent: true
    graph.deleteNode(nodeB.id, { permanent: true })

    // '0:99' should STILL be reserved because node A still references it
    // FAILS: maybeUnreserveImportedId unconditionally unreserves '0:99'
    const reservedAfter = graph.identity.getImportedRuntimeIds()
    expect(reservedAfter.has('0:99')).toBe(true) // FAILS: '0:99' is unreserved
  })

  test('create-time reference counts keep a shared GUID reserved without recompute', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const nodeA = graph.createNode('RECTANGLE', page, {
      name: 'A',
      width: 50,
      height: 50,
      source: figSource('0:77')
    })
    const nodeB = graph.createNode('RECTANGLE', page, {
      name: 'B',
      width: 50,
      height: 50,
      x: 100,
      source: figSource('0:77')
    })

    expect(graph.identity.getImportedRuntimeIds().has('0:77')).toBe(true)

    graph.deleteNode(nodeB.id, { permanent: true })
    expect(graph.identity.getImportedRuntimeIds().has('0:77')).toBe(true)

    graph.deleteNode(nodeA.id, { permanent: true })
    expect(graph.identity.getImportedRuntimeIds().has('0:77')).toBe(false)
  })

  test('variable replacement releases the previous imported GUID reference', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const collection = collectionWithSource('collection:variable-replace')
    graph.addCollection(collection)
    const node = graph.createNode('RECTANGLE', page, {
      name: 'A',
      width: 50,
      height: 50,
      source: figSource('0:variable-old')
    })

    graph.addVariable(variableWithSource('variable:replace', collection.id, '0:variable-old'))
    graph.deleteNode(node.id, { permanent: true })
    expect(graph.identity.getImportedRuntimeIds().has('0:variable-old')).toBe(true)

    graph.addVariable(variableWithSource('variable:replace', collection.id, '0:variable-new'))
    expect(graph.identity.getImportedRuntimeIds().has('0:variable-old')).toBe(false)
    expect(graph.identity.getImportedRuntimeIds().has('0:variable-new')).toBe(true)

    graph.removeVariable('variable:replace')
    expect(graph.identity.getImportedRuntimeIds().has('0:variable-new')).toBe(false)
  })

  test('collection and mode references keep shared GUIDs reserved until removed', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const collectionNode = graph.createNode('RECTANGLE', page, {
      name: 'Collection ref',
      width: 50,
      height: 50,
      source: figSource('0:collection-ref')
    })
    const modeNode = graph.createNode('RECTANGLE', page, {
      name: 'Mode ref',
      width: 50,
      height: 50,
      x: 100,
      source: figSource('0:mode-ref')
    })
    const collection: VariableCollection = {
      id: 'collection:refs',
      name: 'Refs',
      modes: [
        { modeId: 'mode:base', name: 'Base', source: figSource('0:mode-base') },
        { modeId: 'mode:shared', name: 'Shared', source: figSource('0:mode-ref') }
      ],
      defaultModeId: 'mode:base',
      variableIds: [],
      source: figSource('0:collection-ref')
    }
    graph.addCollection(collection)

    graph.deleteNode(collectionNode.id, { permanent: true })
    graph.deleteNode(modeNode.id, { permanent: true })
    expect(graph.identity.getImportedRuntimeIds().has('0:collection-ref')).toBe(true)
    expect(graph.identity.getImportedRuntimeIds().has('0:mode-ref')).toBe(true)

    graph.removeMode(collection.id, 'mode:shared')
    expect(graph.identity.getImportedRuntimeIds().has('0:mode-ref')).toBe(false)
    expect(graph.identity.getImportedRuntimeIds().has('0:collection-ref')).toBe(true)

    graph.removeCollection(collection.id)
    expect(graph.identity.getImportedRuntimeIds().has('0:collection-ref')).toBe(false)
  })

  test('node, variable, collection, and mode refs release a shared GUID only after the last ref', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const sharedSourceId = '0:shared-across-all-domains'
    const replacementProbeName = `Probe ${sharedSourceId}`

    const node = graph.createNode('RECTANGLE', page, {
      name: 'Shared source node',
      width: 50,
      height: 50,
      source: figSource(sharedSourceId)
    })
    const collection: VariableCollection = {
      id: 'collection:shared-all-domains',
      name: 'Shared all domains',
      modes: [
        { modeId: 'mode:base-shared-all-domains', name: 'Base', source: figSource('0:base-mode') },
        { modeId: 'mode:shared-all-domains', name: 'Shared', source: figSource(sharedSourceId) }
      ],
      defaultModeId: 'mode:base-shared-all-domains',
      variableIds: [],
      source: figSource(sharedSourceId)
    }
    graph.addCollection(collection)
    graph.addVariable(
      variableWithSource('variable:shared-all-domains', collection.id, sharedSourceId)
    )

    expect(graph.identity.getImportedRuntimeIds().has(sharedSourceId)).toBe(true)

    graph.deleteNode(node.id, { permanent: true })
    expect(graph.identity.getImportedRuntimeIds().has(sharedSourceId)).toBe(true)
    expect(
      graph.createNode(
        'RECTANGLE',
        page,
        { id: sharedSourceId, name: replacementProbeName },
        { mode: 'restore' }
      ).id
    ).not.toBe(sharedSourceId)

    graph.removeVariable('variable:shared-all-domains')
    expect(graph.identity.getImportedRuntimeIds().has(sharedSourceId)).toBe(true)

    graph.removeMode(collection.id, 'mode:shared-all-domains')
    expect(graph.identity.getImportedRuntimeIds().has(sharedSourceId)).toBe(true)

    graph.removeCollection(collection.id)
    expect(graph.identity.getImportedRuntimeIds().has(sharedSourceId)).toBe(false)
    expect(
      graph.createNode(
        'RECTANGLE',
        page,
        { id: sharedSourceId, name: replacementProbeName },
        { mode: 'restore' }
      ).id
    ).toBe(sharedSourceId)
  })

  test('restore mode with matching source cannot bypass live variable collection and mode refs', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const sharedSourceId = '0:same-source-restore-live-ref'
    const collection: VariableCollection = {
      id: 'collection:same-source-restore-live-ref',
      name: 'Same source restore live ref',
      modes: [
        { modeId: 'mode:same-source-base', name: 'Base', source: figSource('0:same-source-base') },
        { modeId: 'mode:same-source-shared', name: 'Shared', source: figSource(sharedSourceId) }
      ],
      defaultModeId: 'mode:same-source-base',
      variableIds: [],
      source: figSource(sharedSourceId)
    }
    graph.addCollection(collection)
    graph.addVariable(
      variableWithSource('variable:same-source-live', collection.id, sharedSourceId)
    )

    const expectRestoreBlocked = () => {
      const probe = graph.createNode(
        'RECTANGLE',
        page,
        {
          id: sharedSourceId,
          name: 'Same source restore probe',
          source: figSource(sharedSourceId)
        },
        { mode: 'restore' }
      )
      expect(probe.id).not.toBe(sharedSourceId)
      graph.deleteNode(probe.id, { permanent: true })
    }

    expectRestoreBlocked()
    graph.removeVariable('variable:same-source-live')
    expectRestoreBlocked()
    graph.removeMode(collection.id, 'mode:same-source-shared')
    expectRestoreBlocked()

    graph.removeCollection(collection.id)
    expect(
      graph.createNode(
        'RECTANGLE',
        page,
        { id: sharedSourceId, name: 'Reusable after live refs', source: figSource(sharedSourceId) },
        { mode: 'restore' }
      ).id
    ).toBe(sharedSourceId)
  })

  test('public unreserve cannot desynchronize live imported-source refs from restore guards', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const sharedSourceId = '0:public-unreserve-live-ref'
    graph.addCollection(collectionWithSource(sharedSourceId))

    expect(graph.identity.getImportedRuntimeIds().has(sharedSourceId)).toBe(true)

    graph.unreserveRuntimeId(sharedSourceId)
    expect(graph.identity.getImportedRuntimeIds().has(sharedSourceId)).toBe(true)

    const blocked = graph.createNode(
      'RECTANGLE',
      page,
      { id: sharedSourceId, name: 'Public unreserve probe', source: figSource(sharedSourceId) },
      { mode: 'restore' }
    )
    expect(blocked.id).not.toBe(sharedSourceId)
    graph.deleteNode(blocked.id, { permanent: true })

    graph.removeCollection(`collection:${sharedSourceId}`)
    expect(graph.identity.getImportedRuntimeIds().has(sharedSourceId)).toBe(false)
    expect(
      graph.createNode(
        'RECTANGLE',
        page,
        {
          id: sharedSourceId,
          name: 'Reusable after public unreserve',
          source: figSource(sharedSourceId)
        },
        { mode: 'restore' }
      ).id
    ).toBe(sharedSourceId)
  })

  test('restore of a suspended source uses a safe runtime ID while a live variable shares it', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const sourceId = '0:suspended-plus-live-variable'
    const collection = collectionWithSource('collection:suspended-plus-live-variable')
    graph.addCollection(collection)
    graph.addVariable(variableWithSource('variable:suspended-plus-live', collection.id, sourceId))
    const node = graph.createNode('RECTANGLE', page, {
      id: sourceId,
      name: 'Suspended while variable stays live',
      source: figSource(sourceId)
    })
    expect(node.id).not.toBe(sourceId)

    graph.deleteNode(node.id, { permanent: false })
    const restored = graph.createNode(
      'RECTANGLE',
      page,
      { id: node.id, name: 'Restored with live variable', source: figSource(sourceId) },
      { mode: 'restore' }
    )
    expect(restored.id).not.toBe(sourceId)
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(true)

    graph.removeVariable('variable:suspended-plus-live')
    graph.deleteNode(restored.id, { permanent: true })
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(false)
    expect(
      graph.createNode(
        'RECTANGLE',
        page,
        {
          id: sourceId,
          name: 'Reusable after suspended and variable refs',
          source: figSource(sourceId)
        },
        { mode: 'restore' }
      ).id
    ).toBe(sourceId)
  })

  test('restore after non-permanent delete consumes the suspended GUID reservation', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const sourceId = '0:suspended-restore-refcount'
    const node = graph.createNode('RECTANGLE', page, {
      id: sourceId,
      name: 'Suspended source',
      source: figSource(sourceId)
    })

    graph.deleteNode(node.id, { permanent: false })
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(true)

    const restored = graph.createNode(
      'RECTANGLE',
      page,
      { id: sourceId, name: 'Restored suspended source', source: figSource(sourceId) },
      { mode: 'restore' }
    )
    expect(restored.id).toBe(sourceId)

    graph.deleteNode(restored.id, { permanent: true })
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(false)
    expect(
      graph.createNode(
        'RECTANGLE',
        page,
        { id: sourceId, name: 'Reusable after delete' },
        { mode: 'restore' }
      ).id
    ).toBe(sourceId)
  })

  test('recompute keeps suspended GUID reservations unavailable until restore consumes them', () => {
    const graph = new SceneGraph({ sessionID: 31415 })
    const page = pageId(graph)
    const sourceId = '0:suspended-recompute-reservation'
    const node = graph.createNode('RECTANGLE', page, {
      id: sourceId,
      name: 'Suspended before recompute',
      source: figSource(sourceId)
    })

    graph.deleteNode(node.id, { permanent: false })
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(true)

    graph.identity.recomputeReservedRuntimeIds()
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(true)

    const intruder = graph.createNode('RECTANGLE', page, {
      id: sourceId,
      name: 'Must not steal suspended imported runtime id'
    })
    expect(intruder.id).not.toBe(sourceId)

    const restored = graph.createNode(
      'RECTANGLE',
      page,
      { id: sourceId, name: 'Restored after recompute', source: figSource(sourceId) },
      { mode: 'restore' }
    )
    expect(restored.id).toBe(sourceId)

    graph.deleteNode(restored.id, { permanent: true })
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(false)
  })

  test('shared suspended node sources restore source-runtime ID after generated duplicate first', () => {
    const graph = new SceneGraph({ sessionID: 27182 })
    const page = pageId(graph)
    const sourceId = '0:shared-suspended-restore-order'
    const sourceRuntimeNode = graph.createNode('RECTANGLE', page, {
      id: sourceId,
      name: 'Source runtime',
      source: figSource(sourceId)
    })
    const generatedRuntimeNode = graph.createNode('RECTANGLE', page, {
      name: 'Generated runtime',
      source: figSource(sourceId)
    })
    expect(sourceRuntimeNode.id).toBe(sourceId)
    expect(generatedRuntimeNode.id).not.toBe(sourceId)

    graph.deleteNode(sourceRuntimeNode.id, { permanent: false })
    graph.deleteNode(generatedRuntimeNode.id, { permanent: false })
    graph.identity.recomputeReservedRuntimeIds()
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(true)

    const restoredGenerated = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: generatedRuntimeNode.id,
        name: 'Generated runtime restored first',
        source: figSource(sourceId)
      },
      { mode: 'restore' }
    )
    expect(restoredGenerated.id).toBe(generatedRuntimeNode.id)

    const restoredSource = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: sourceRuntimeNode.id,
        name: 'Source runtime restored second',
        source: figSource(sourceId)
      },
      { mode: 'restore' }
    )
    expect(restoredSource.id).toBe(sourceRuntimeNode.id)

    graph.deleteNode(restoredGenerated.id, { permanent: true })
    graph.deleteNode(restoredSource.id, { permanent: true })
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(false)
  })

  test('restore with non-suspended same-source runtime does not consume original suspension', () => {
    const graph = new SceneGraph({ sessionID: 27184 })
    const page = pageId(graph)
    const sourceId = '0:suspended-nonmatching-restore'
    const sourceRuntimeNode = graph.createNode('RECTANGLE', page, {
      id: sourceId,
      name: 'Source runtime',
      source: figSource(sourceId)
    })

    graph.deleteNode(sourceRuntimeNode.id, { permanent: false })
    const unrelatedSameSourceRestore = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '99:not-suspended-runtime',
        name: 'Same source unrelated restore',
        source: figSource(sourceId)
      },
      { mode: 'restore' }
    )
    expect(unrelatedSameSourceRestore.id).toBe('99:not-suspended-runtime')

    const restoredSource = graph.createNode(
      'RECTANGLE',
      page,
      { id: sourceRuntimeNode.id, name: 'Source runtime restored', source: figSource(sourceId) },
      { mode: 'restore' }
    )
    expect(restoredSource.id).toBe(sourceRuntimeNode.id)

    graph.deleteNode(unrelatedSameSourceRestore.id, { permanent: true })
    graph.deleteNode(restoredSource.id, { permanent: true })
    expect(graph.identity.getImportedRuntimeIds().has(sourceId)).toBe(false)
  })

  test('undo of delete with shared GUID restores correct runtime ID', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    // Create two nodes sharing GUID '0:88'
    graph.createNode('RECTANGLE', page, {
      name: 'A',
      width: 50,
      height: 50,
      source: figSource('0:88')
    })
    const nodeB = graph.createNode('RECTANGLE', page, {
      name: 'B',
      width: 50,
      height: 50,
      x: 100,
      source: figSource('0:88')
    })

    // Recompute reserved IDs
    graph.identity.recomputeReservedRuntimeIds()

    const nodeBRuntimeId = nodeB.id
    const nodeBStableId = nodeB.source.id
    expect(nodeBStableId).toBeDefined()
    if (nodeBStableId === undefined) return

    // Delete node B permanently
    graph.deleteNode(nodeB.id, { permanent: true })
    expect(graph.getNode(nodeB.id)).toBeUndefined()

    const restored = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: nodeBRuntimeId,
        name: 'B',
        width: 50,
        height: 50,
        x: 100,
        source: figSource(nodeBStableId)
      },
      { mode: 'restore' }
    )

    expect(restored.id).toBe(nodeBRuntimeId)
  })
})
