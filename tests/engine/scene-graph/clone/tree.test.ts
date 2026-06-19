import { describe, expect, test } from 'bun:test'

import { SceneGraph, createDefaultSource } from '@open-pencil/core'

describe('SceneGraph.cloneTree', () => {
  function figSource(id: string) {
    return { ...createDefaultSource(), id, format: 'fig' as const }
  }

  test('clone mints a fresh stable source.id and preserves format', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Original',
      width: 100,
      height: 50,
      source: figSource('1:42')
    })
    const original = graph.getNode(rect.id)
    expect(original).toBeDefined()
    expect(original.source.id).toBe('1:42')

    const clone = graph.cloneTree(rect.id, page.id)
    expect(clone).not.toBeNull()
    // Clone must NOT carry the original's Figma GUID, but must keep format
    expect(clone.source.id).not.toBe('1:42')
    expect(clone.source.id).toMatch(/^\d+:\d+$/)
    expect(clone.source.orderKey).toBeNull()
    expect(clone.source.format).toBe('fig')
  })

  test('clone of clone mints another fresh source.id', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Original',
      width: 100,
      height: 50,
      source: figSource('1:99')
    })

    const clone1 = graph.cloneTree(rect.id, page.id)
    expect(clone1).not.toBeNull()
    const clone2 = graph.cloneTree(clone1.id, page.id)
    expect(clone2).not.toBeNull()
    expect(clone2.source.id).not.toBe('1:99')
    expect(clone2.source.id).toMatch(/^\d+:\d+$/)
    expect(clone2.source.id).not.toBe(clone1.source.id)
  })

  test('clone preserves visual properties', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Original',
      width: 100,
      height: 50,
      source: figSource('1:42'),
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          visible: true,
          blendMode: 'NORMAL' as const
        }
      ]
    })

    const clone = graph.cloneTree(rect.id, page.id)
    expect(clone).not.toBeNull()
    expect(clone.name).toBe('Original')
    expect(clone.width).toBe(100)
    expect(clone.height).toBe(50)
    expect(clone.fills).toEqual(rect.fills)
  })

  test('clone recursively mints fresh source.id on children', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Frame',
      width: 200,
      height: 200,
      source: figSource('2:10')
    })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Child',
      width: 50,
      height: 50,
      source: figSource('2:11')
    })

    const clone = graph.cloneTree(frame.id, page.id)
    expect(clone).not.toBeNull()
    expect(clone.source.id).not.toBe('2:10')
    expect(clone.source.id).toMatch(/^\d+:\d+$/)
    const clonedChild = graph.getChildren(clone.id)[0]
    expect(clonedChild.source.id).not.toBe('2:11')
    expect(clonedChild.source.id).toMatch(/^\d+:\d+$/)
  })

  test('clone deep-copies source.fig so mutations do not affect original', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Original',
      width: 100,
      height: 50,
      source: {
        ...createDefaultSource(),
        id: '1:42',
        orderKey: '!',
        format: 'fig',
        fig: {
          rawSize: { x: 100, y: 50 },
          rawTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          rawNodeFields: { visible: true, opacity: 1 },
          layout: null,
          symbolOverrides: [],
          componentPropAssignments: [],
          derivedSymbolData: [],
          derivedSymbolDataLayoutVersion: null,
          uniformScaleFactor: null
        }
      }
    })

    const original = graph.getNode(rect.id)
    expect(original.source.fig.rawNodeFields).toEqual({ visible: true, opacity: 1 })

    const clone = graph.cloneTree(rect.id, page.id)
    expect(clone).not.toBeNull()

    // Mutate the clone's source.fig (simulating what clearEditedSourceMetadata does)
    clone.source.fig.rawNodeFields = {}
    clone.source.fig.rawSize = null

    // Original must be unaffected
    expect(original.source.fig.rawNodeFields).toEqual({ visible: true, opacity: 1 })
    expect(original.source.fig.rawSize).toEqual({ x: 100, y: 50 })
  })
})
