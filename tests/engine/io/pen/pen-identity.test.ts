import { describe, expect, spyOn, test } from 'bun:test'

import { parsePenFile, SceneGraph } from '@open-pencil/core'

import { getNodeOrThrow } from '#tests/helpers/assert'

function buildPenJSON(children: unknown[]): string {
  return JSON.stringify({ version: '1.0', children })
}

describe('pen identity layer', () => {
  test('duplicate and missing pen ids receive distinct non-null runtime ids', () => {
    const migrateSpy = spyOn(SceneGraph.prototype, 'migrateLegacySourceIds')
    const reserveSpy = spyOn(SceneGraph.prototype, 'recomputeReservedRuntimeIds')

    const json = buildPenJSON([
      {
        type: 'frame',
        id: '0:5',
        name: 'Component',
        reusable: true,
        width: 100,
        height: 100,
        fill: '#ffffff'
      },
      {
        type: 'rectangle',
        id: '0:5',
        name: 'Duplicate',
        width: 50,
        height: 50,
        fill: '#000000'
      },
      {
        type: 'rectangle',
        name: 'Missing',
        width: 50,
        height: 50,
        fill: '#ff0000'
      },
      {
        type: 'ref',
        id: 'inst',
        ref: '0:5',
        name: 'Instance',
        width: 100,
        height: 100
      }
    ])

    const graph = parsePenFile(json)

    expect(migrateSpy.mock.calls.length).toBeGreaterThan(0)
    expect(reserveSpy.mock.calls.length).toBeGreaterThan(0)

    const component = getNodeOrThrow(graph, '0:5')
    const duplicate = graph
      .getAllNodes()
      .find((n) => n.name === 'Duplicate' && n.type === 'RECTANGLE')
    const missing = graph.getAllNodes().find((n) => n.name === 'Missing' && n.type === 'RECTANGLE')
    const instance = graph.getAllNodes().find((n) => n.name === 'Instance' && n.type === 'INSTANCE')

    expect(duplicate).toBeDefined()
    expect(missing).toBeDefined()
    expect(instance).toBeDefined()

    expect(duplicate?.id).not.toBe(component.id)
    expect(duplicate?.id).toMatch(/^\d+:\d+$/)
    expect(duplicate?.source.format).toBe('pen')
    expect(missing?.id).toBeDefined()
    expect(missing?.id).not.toBe(component.id)
    expect(missing?.id).not.toBe(duplicate?.id)
    expect(missing?.id).toMatch(/^\d+:\d+$/)
    expect(missing?.source.format).toBe('pen')

    expect(instance?.componentId).toBe(component.id)
    expect(instance?.source.format).toBe('pen')
    if (instance === undefined) return
    expect(getNodeOrThrow(graph, instance.id).componentId).toBe(component.id)

    migrateSpy.mockRestore()
    reserveSpy.mockRestore()
  })

  test('all pen nodes receive a non-null stable source id', () => {
    const json = buildPenJSON([
      {
        type: 'rectangle',
        name: 'Box',
        width: 50,
        height: 50,
        fill: '#000000'
      }
    ])

    const graph = parsePenFile(json)

    for (const node of graph.getAllNodes()) {
      if (node.type === 'DOCUMENT') continue
      expect(node.source.id).toMatch(/^\d+:\d+$/)
      expect(node.source.format).toBe('pen')
    }
  })
})
