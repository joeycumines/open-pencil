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
