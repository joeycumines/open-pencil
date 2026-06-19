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

describe('createNode restore kill conditions', () => {
  test('KC-002: interleaved creation cannot occupy a restore slot', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const original = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '42:7',
        name: 'Original',
        source: figSource('42:7')
      },
      { mode: 'restore' }
    )

    expect(original.id).toBe('42:7')
    const originalSourceId = original.source.id

    graph.deleteNode(original.id, { permanent: true })
    expect(graph.getNode('42:7')).toBeUndefined()

    const interleaved = graph.createNode('ELLIPSE', page, {
      id: '42:7',
      name: 'Interleaved',
      source: figSource('7:2')
    })
    expect(interleaved.id).toBe('42:7')

    const restored = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '42:7',
        name: 'Restored',
        source: figSource(originalSourceId)
      },
      { mode: 'restore' }
    )

    expect(restored.id).not.toBe(interleaved.id)
    expect(restored.source.id).toBe(originalSourceId)
    expect(graph.getNode(restored.id)).toBeDefined()
    expect(graph.getNode(interleaved.id)).toBeDefined()
  })

  test('restore reuses an occupied slot only when type and source.id match', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const original = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '99:5',
        name: 'Original',
        source: figSource('99:5')
      },
      { mode: 'restore' }
    )

    const sameIdentity = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '99:5',
        name: 'SameIdentity',
        source: figSource(original.source.id)
      },
      { mode: 'restore' }
    )
    expect(sameIdentity.id).toBe(original.id)

    const differentType = graph.createNode(
      'ELLIPSE',
      page,
      {
        id: '99:5',
        name: 'DifferentType',
        source: figSource(original.source.id)
      },
      { mode: 'restore' }
    )
    expect(differentType.id).not.toBe(original.id)
    expect(differentType.source.id).toBe(original.source.id)

    const differentSource = graph.createNode(
      'RECTANGLE',
      page,
      {
        id: '99:5',
        name: 'DifferentSource',
        source: figSource('8:2')
      },
      { mode: 'restore' }
    )
    expect(differentSource.id).not.toBe(original.id)
    expect(differentSource.source.id).toBe('8:2')
  })
})
