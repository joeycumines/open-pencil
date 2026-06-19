import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

describe('permanent delete releases imported GUIDs', () => {
  test('permanent delete unreserves the GUID so a later restore mints a new runtime id', () => {
    const graph = new SceneGraph({ reservedRuntimeIds: ['0:123'] })
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

    expect(imported.id).toBe('0:123')
    expect(graph.getImportedRuntimeIds().has('0:123')).toBe(true)

    graph.deleteNode(imported.id, { permanent: true })

    expect(graph.getNode(imported.id)).toBeUndefined()
    expect(graph.getImportedRuntimeIds().has('0:123')).toBe(false)

    const replacement = graph.createNode('RECTANGLE', page, {
      id: '0:123',
      source: {
        format: null,
        id: 'replacement-stable',
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

    expect(replacement.id).toBe('0:123')

    const restored = graph.createNode(
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

    expect(restored.id).not.toBe('0:123')
    expect(restored.source.id).toBe('0:123')
  })
})
