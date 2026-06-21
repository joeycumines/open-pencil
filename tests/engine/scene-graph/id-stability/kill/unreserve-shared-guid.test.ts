import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

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

    // Undo: restore node B with mode: 'restore'
    // pickRuntimeId should reuse nodeBRuntimeId because:
    // - mode === 'restore'
    // - existing === undefined (deleted)
    // - reserved === true (IF '0:88' was not unreserved)
    // - stableId === requestedRuntimeId ('0:88' === '0:88')
    //
    // But maybeUnreserveImportedId unconditionally unreserved '0:88',
    // so reserved === false → pickRuntimeId falls through to generateNodeId
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

    // The restored node should have the SAME runtime ID as before deletion
    // FAILS: restored.id !== nodeBRuntimeId (got a generated ID instead)
    expect(restored.id).toBe(nodeBRuntimeId)
  })
})
