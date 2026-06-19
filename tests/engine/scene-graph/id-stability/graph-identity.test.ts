import { describe, expect, test } from 'bun:test'

import { SceneGraph, createDefaultSource } from '@open-pencil/core'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

describe('SceneGraph identity layer', () => {
  test('new graph has random session id greater than 1 and a dedicated document guid', () => {
    const graph = new SceneGraph()

    expect(graph.sessionID).toBeGreaterThan(1)
    expect(graph.documentGuid).toMatch(/^0:\d+$/)

    const root = graph.getNode(graph.rootId)
    expect(root).toBeDefined()
    expect(root?.source.id).toMatch(/^\d+:\d+$/)
    expect(root?.source.id).not.toBe(graph.documentGuid)
  })

  test('two graphs never share the same session id in practice', () => {
    const ids = new Set<number>()
    for (let i = 0; i < 20; i++) {
      ids.add(new SceneGraph().sessionID)
    }
    expect(ids.size).toBe(20)
  })

  test('locally created nodes have a stable source.id and a runtime id', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const node = graph.createNode('RECTANGLE', page, { name: 'Box' })

    expect(node.id).toMatch(/^\d+:\d+$/)
    expect(node.source.id).toMatch(/^\d+:\d+$/)
    expect(node.source.id).toBeTruthy()
    expect(graph.getStableId(node)).toBe(node.source.id)
    expect(graph.stableIdToRuntimeId(node.source.id)).toBe(node.id)
  })

  test('createNode restore mode reuses an occupied slot when identity matches', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const first = graph.createNode('RECTANGLE', page, {
      id: '42:7',
      source: {
        format: null,
        id: null,
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
    })
    expect(first.id).toBe('42:7')
    expect(first.source.id).toMatch(/^\d+:\d+$/)

    const stableId = first.source.id

    const restored = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '42:7',
        name: 'Restored',
        source: first.source
      },
      { mode: 'restore' }
    )
    expect(restored.id).toBe(first.id)
    expect(restored.name).toBe('Restored')
    expect(restored.source.id).toBe(stableId)

    const different = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '42:7',
        source: {
          format: null,
          id: '99:99',
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
      },
      { mode: 'restore' }
    )
    expect(different.id).not.toBe(first.id)
    expect(different.source.id).toBe('99:99')
  })

  test('restore into occupied slot preserves children and repairs parent linkage', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const otherParent = graph.createNode('FRAME', page, { name: 'OtherParent' })

    // Use a FRAME (a container) so it can hold children — RECTANGLE is not a
    // container and cannot, so it could not prove that restore preserves children.
    const first = graph.createNode('FRAME', page, {
      id: '42:7',
      name: 'First',
      source: createDefaultSource()
    })
    expect(first.id).toBe('42:7')
    const stableId = first.source.id
    expect(stableId).toMatch(/^\d+:\d+$/)

    // Give `first` a child so we can prove restore does not wipe children.
    const firstChild = graph.createNode('RECTANGLE', first.id, { name: 'FirstChild' })
    expect(first.childIds).toContain(firstChild.id)

    // Restore into the SAME occupied slot (same type + stable id) -> in-place update.
    const restored = graph.createNode(
      'FRAME',
      page,
      {
        id: '42:7',
        name: 'Restored',
        source: first.source
      },
      { mode: 'restore' }
    )

    // In-place: same object reference and id reused (pre-fix returned a fresh node).
    expect(restored).toBe(first)
    expect(restored.id).toBe('42:7')
    expect(restored.name).toBe('Restored')
    expect(restored.source.id).toBe(stableId)

    // Tree invariants (pre-fix all failed):
    //  - no duplicate child id in the parent
    //  - existing children are preserved (pre-fix childIds was reset to [])
    //  - getChildren has the node exactly once
    const pageNode = graph.getNode(page)
    if (pageNode === undefined) throw new Error('page missing')
    expect(pageNode.childIds.filter((cid) => cid === restored.id).length).toBe(1)
    expect(restored.childIds).toContain(firstChild.id)
    expect(restored.childIds.length).toBe(1)
    expect(graph.getChildren(page).filter((n) => n.id === restored.id).length).toBe(1)

    // Restore-moving the node to a different parent must remove it from the old
    // parent and add it exactly once to the new parent (pre-fix left a dangling
    // reference in the old parent and wiped children).
    const moved = graph.createNode(
      'FRAME',
      otherParent.id,
      {
        id: '42:7',
        name: 'Moved',
        source: first.source
      },
      { mode: 'restore' }
    )
    expect(moved).toBe(first)
    expect(moved.parentId).toBe(otherParent.id)

    const pageAfter = graph.getNode(page)
    const otherAfter = graph.getNode(otherParent.id)
    if (pageAfter === undefined || otherAfter === undefined) {
      throw new Error('parents missing after move')
    }
    expect(pageAfter.childIds.includes(restored.id)).toBe(false)
    expect(otherAfter.childIds.filter((cid) => cid === restored.id).length).toBe(1)
    // children survive the move too
    expect(moved.childIds).toContain(firstChild.id)
  })

  test('createNode skips reserved imported ids', () => {
    const graph = new SceneGraph({ reservedRuntimeIds: ['99:5'] })
    const page = pageId(graph)

    const local = graph.createNode('RECTANGLE', page, { name: 'Local' })
    const stableId = local.source.id

    const withReservedRuntime = graph.createNode('RECTANGLE', page, {
      id: '99:5',
      source: {
        format: null,
        id: stableId,
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
    })

    expect(withReservedRuntime.id).not.toBe('99:5')
    expect(withReservedRuntime.source.id).toBe(stableId)
  })

  test('updateNode ignores id changes, locks source.id, and locks source.format only after it is set', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const node = graph.createNode('RECTANGLE', page, { name: 'Box' })
    const originalId = node.id
    const originalSourceId = node.source.id

    const emitted: Array<{ id: string; changes: Partial<ReturnType<typeof graph.getNode>> }> = []
    const unbind = graph.onNodeEvents({
      updated: (id, changes) => {
        emitted.push({ id, changes })
      }
    })

    graph.updateNode(node.id, {
      id: 'evilmalicious',
      name: 'Renamed',
      source: {
        format: 'fig',
        id: 'stolen',
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
    })

    unbind()

    expect(node.id).toBe(originalId)
    expect(node.source.id).toBe(originalSourceId)
    expect(node.source.format).toBe('fig')
    expect(node.name).toBe('Renamed')
    expect(emitted.length).toBe(1)
    expect('id' in emitted[0].changes).toBe(false)

    graph.updateNode(node.id, {
      source: { ...node.source, format: 'pen' }
    })
    expect(node.source.format).toBe('fig')
  })

  test('permanent delete of imported node unreserves its source id', () => {
    const graph = new SceneGraph({
      reservedRuntimeIds: ['0:123']
    })
    const page = pageId(graph)

    const imported = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '0:123',
        source: {
          format: 'fig',
          id: '0:123',
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
      },
      { mode: 'restore' }
    )
    expect(graph.getImportedRuntimeIds().has('0:123')).toBe(true)

    graph.deleteNode(imported.id, { permanent: true })
    expect(graph.getNode(imported.id)).toBeUndefined()
    expect(graph.getImportedRuntimeIds().has('0:123')).toBe(false)
  })

  test('non-permanent delete keeps imported id reserved', () => {
    const graph = new SceneGraph({
      reservedRuntimeIds: ['0:456']
    })
    const page = pageId(graph)

    const imported = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '0:456',
        source: {
          format: 'fig',
          id: '0:456',
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
      },
      { mode: 'restore' }
    )

    graph.deleteNode(imported.id, { permanent: false })
    expect(graph.getNode(imported.id)).toBeUndefined()
    expect(graph.getImportedRuntimeIds().has('0:456')).toBe(true)
  })

  test('migrateLegacySourceIds assigns stable ids to legacy nodes', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const node = graph.createNode('RECTANGLE', page, { name: 'Modern' })
    const root = graph.getNode(graph.rootId)
    if (!root) throw new Error('missing root')

    const stableBefore = node.source.id

    root.source = { ...root.source, id: null }
    node.source = { ...node.source, id: null }

    graph.migrateLegacySourceIds()

    expect(root.source.id).toMatch(/^\d+:\d+$/)
    expect(node.source.id).toMatch(/^\d+:\d+$/)
    expect(node.source.id).not.toBe(stableBefore)
    expect(graph.getStableId(node)).toBe(node.source.id)
  })

  test('migrateLegacySourceIds is idempotent', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const node = graph.createNode('RECTANGLE', page, { name: 'Box' })
    node.source = { ...node.source, id: null }

    graph.migrateLegacySourceIds()
    const stableId = node.source.id

    graph.migrateLegacySourceIds()
    expect(node.source.id).toBe(stableId)
  })

  test('documentGuid is in session 0 and independent of root stable id', () => {
    const graph = new SceneGraph()

    expect(graph.documentGuid).toMatch(/^0:\d+$/)
    expect(graph.getNode(graph.rootId)?.source.id).not.toBe(graph.documentGuid)
  })

  test('imported node with free guid keeps source id and runtime id', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const imported = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '0:999',
        source: {
          format: 'fig',
          id: '0:999',
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
      },
      { mode: 'restore' }
    )

    expect(imported.id).toBe('0:999')
    expect(imported.source.id).toBe('0:999')
    expect(imported.source.format).toBe('fig')
  })

  test('reserved id prevents local node but allows imported restore', () => {
    const graph = new SceneGraph({ reservedRuntimeIds: ['0:777'] })
    const page = pageId(graph)

    const local = graph.createNode('RECTANGLE', page, {
      id: '0:777',
      source: {
        format: null,
        id: 'synthetic',
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
    })
    expect(local.id).not.toBe('0:777')
    expect(local.source.id).toBe('synthetic')

    const imported = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '0:777',
        source: {
          format: 'fig',
          id: '0:777',
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
      },
      { mode: 'restore' }
    )
    expect(imported.id).toBe('0:777')
  })

  test('variables share the same runtime namespace as nodes and receive source ids', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Tokens')
    const variable = graph.createVariable('Primary', 'COLOR', collection.id)

    expect(collection.source?.id).toMatch(/^\d+:\d+$/)
    expect(collection.modes[0].source?.id).toMatch(/^\d+:\d+$/)
    expect(variable.source?.id).toMatch(/^\d+:\d+$/)

    const knownIds = new Set([
      graph.rootId,
      graph.getPages()[0].id,
      collection.id,
      collection.modes[0].modeId,
      variable.id
    ])
    expect(knownIds.size).toBe(5)
  })

  // --- Hardening tests: address all concerns from reviews 01-06 ---

  test('restore into occupied slot preserves instance index for INSTANCE nodes', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const component = graph.createNode('COMPONENT', page, { name: 'Button' })
    const instance = graph.createNode('INSTANCE', page, {
      componentId: component.id,
      name: 'ButtonInstance'
    })
    const stableId = instance.source.id
    expect(stableId).toBeTruthy()
    expect(graph.getInstances(component.id).map((n) => n.id)).toContain(instance.id)

    // Simulate the edge case where the index entry was cleared by a prior
    // operation but the node remained in the graph.
    graph.instanceIndex.get(component.id)?.delete(instance.id)
    expect(graph.getInstances(component.id).map((n) => n.id)).not.toContain(instance.id)

    // Restore in-place — registerInstanceIndex should re-establish the entry.
    const restored = graph.createNode(
      'INSTANCE',
      page,
      {
        id: instance.id,
        componentId: component.id,
        name: 'RestoredButton',
        source: instance.source
      },
      { mode: 'restore' }
    )

    expect(restored).toBe(instance)
    expect(graph.getInstances(component.id).map((n) => n.id)).toContain(restored.id)
  })

  test('restore into occupied slot emits node:updated and node:reparented, not node:created', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const otherParent = graph.createNode('FRAME', page, { name: 'OtherParent' })

    const first = graph.createNode('FRAME', page, {
      id: '42:7',
      name: 'First',
      source: createDefaultSource()
    })

    const events: string[] = []
    const unbind = graph.onNodeEvents({
      created: () => events.push('created'),
      updated: () => events.push('updated'),
      reparented: () => events.push('reparented')
    })

    // Restore in-place with SAME parent (no reparent)
    graph.createNode(
      'FRAME',
      page,
      { id: '42:7', name: 'Restored', source: first.source },
      { mode: 'restore' }
    )

    // Restore in-place with DIFFERENT parent (reparent)
    graph.createNode(
      'FRAME',
      otherParent.id,
      { id: '42:7', name: 'Moved', source: first.source },
      { mode: 'restore' }
    )

    unbind()

    // No 'created' — the node already existed in both restores
    expect(events.filter((e) => e === 'created')).toHaveLength(0)
    // 'updated' for both restores (via updateNode)
    expect(events.filter((e) => e === 'updated')).toHaveLength(2)
    // 'reparented' only for the second restore (parent changed)
    expect(events.filter((e) => e === 'reparented')).toHaveLength(1)
  })

  test('restore into occupied slot preserves and updates source metadata', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const originalSource = {
      format: 'fig' as const,
      id: 'figma-123',
      orderKey: null,
      fig: {
        rawSize: { width: 100, height: 200 },
        rawTransform: [1, 0, 0, 1, 10, 20],
        rawNodeFields: { name: 'OriginalName' },
        layout: null,
        symbolOverrides: [],
        componentPropAssignments: [],
        derivedSymbolData: [],
        derivedSymbolDataLayoutVersion: null,
        uniformScaleFactor: null
      }
    }

    const first = graph.createNode('RECTANGLE', page, {
      id: '42:7',
      source: originalSource,
      name: 'Original'
    })
    expect(first.source.format).toBe('fig')
    expect(first.source.id).toBe('figma-123')

    // Restore with updated fig data (rawSize changed, other fields preserved)
    const restored = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '42:7',
        name: 'Restored',
        source: {
          ...originalSource,
          fig: {
            ...originalSource.fig,
            rawSize: { width: 300, height: 400 }
          }
        }
      },
      { mode: 'restore' }
    )

    expect(restored).toBe(first)
    // source.format is immutable once set (by design — guardSourceChanges)
    expect(restored.source.format).toBe('fig')
    // source.id is preserved (same stable id — pickRuntimeId guarantee)
    expect(restored.source.id).toBe('figma-123')
    // source.fig.rawSize is updated from the restore overrides
    expect(restored.source.fig.rawSize).toEqual({ width: 300, height: 400 })
    // Other fig fields are preserved from the restore source
    expect(restored.source.fig.rawTransform).toEqual([1, 0, 0, 1, 10, 20])
    expect(restored.source.fig.rawNodeFields).toEqual({ name: 'OriginalName' })
  })

  test('default mode never triggers in-place restoration for occupied ids', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const first = graph.createNode('RECTANGLE', page, {
      id: '42:7',
      source: createDefaultSource(),
      name: 'First'
    })
    expect(first.id).toBe('42:7')

    const events: string[] = []
    const unbind = graph.onNodeEvents({
      created: () => events.push('created'),
      updated: () => events.push('updated'),
      reparented: () => events.push('reparented')
    })

    // Default mode with the SAME id, type, and stable id — must NOT trigger
    // restoreNodeInPlace. pickRuntimeId generates a fresh id, and a new node
    // is created with node:created.
    const second = graph.createNode('RECTANGLE', page, {
      id: '42:7',
      source: first.source,
      name: 'Second'
    })

    unbind()

    // A new node was created (not in-place updated)
    expect(second.id).not.toBe(first.id)
    expect(events.filter((e) => e === 'created')).toHaveLength(1)
    expect(events.filter((e) => e === 'updated')).toHaveLength(0)
    expect(events.filter((e) => e === 'reparented')).toHaveLength(0)
  })
})
