import { describe, expect, test } from 'bun:test'

import { SceneGraph, createDefaultSource } from '@open-pencil/core'

describe('SceneGraph.cloneTree', () => {
  function figSource(id: string) {
    return { ...createDefaultSource(), id, format: 'fig' as const }
  }

  function firstChild(graph: SceneGraph, parentId: string) {
    const child = graph.getChildren(parentId)[0]
    if (!child) throw new Error(`expected ${parentId} to have a child`)
    return child
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

  test('clone remaps instance child override keys to cloned child stable ids', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, {
      name: 'Button',
      width: 100,
      height: 40
    })
    graph.createNode('RECTANGLE', component.id, { name: 'Bg', width: 100, height: 40 })

    const instance = graph.createInstance(component.id, page.id)
    if (!instance) throw new Error('instance failed')
    const instanceChild = firstChild(graph, instance.id)
    const originalChildStableId = graph.identity.getStableId(instanceChild)
    instanceChild.width = 140
    instance.overrides[`${originalChildStableId}:width`] = 140

    const clone = graph.cloneTree(instance.id, page.id)
    if (!clone) throw new Error('clone failed')
    const clonedChild = firstChild(graph, clone.id)
    const clonedChildStableId = graph.identity.getStableId(clonedChild)

    expect(clone.overrides[`${originalChildStableId}:width`]).toBeUndefined()
    expect(clone.overrides[`${clonedChildStableId}:width`]).toBe(140)

    graph.syncInstances(component.id)

    expect(clonedChild.width).toBe(140)
  })

  test('clone remaps component references when component and instance are cloned together', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, { name: 'Bundle' })
    const component = graph.createNode('COMPONENT', frame.id, {
      name: 'Button',
      width: 100,
      height: 40
    })
    graph.createNode('RECTANGLE', component.id, { name: 'Bg', width: 100, height: 40 })
    const instance = graph.createInstance(component.id, frame.id)
    if (!instance) throw new Error('instance failed')

    const clone = graph.cloneTree(frame.id, page.id)
    if (!clone) throw new Error('clone failed')
    const clonedComponent = graph.getChildren(clone.id).find((node) => node.type === 'COMPONENT')
    const clonedInstance = graph.getChildren(clone.id).find((node) => node.type === 'INSTANCE')
    if (!clonedComponent || !clonedInstance) throw new Error('clone did not preserve bundle')
    const clonedComponentChild = firstChild(graph, clonedComponent.id)
    const clonedInstanceChild = firstChild(graph, clonedInstance.id)

    expect(clonedInstance.componentId).toBe(clonedComponent.id)
    expect(clonedInstanceChild.componentId).toBe(clonedComponentChild.id)
    expect(graph.getInstances(clonedComponent.id).map((node) => node.id)).toContain(
      clonedInstance.id
    )
  })

  test('clone remaps nested instance override records recursively', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const innerComponent = graph.createNode('COMPONENT', page.id, {
      name: 'Inner',
      width: 60,
      height: 20
    })
    graph.createNode('RECTANGLE', innerComponent.id, { name: 'Inner Bg', width: 60, height: 20 })
    const outerComponent = graph.createNode('COMPONENT', page.id, {
      name: 'Outer',
      width: 120,
      height: 48
    })
    const nestedInstanceInComponent = graph.createInstance(innerComponent.id, outerComponent.id)
    if (!nestedInstanceInComponent) throw new Error('nested instance failed')

    const outerInstance = graph.createInstance(outerComponent.id, page.id)
    if (!outerInstance) throw new Error('outer instance failed')
    const nestedInstance = firstChild(graph, outerInstance.id)
    const nestedChild = firstChild(graph, nestedInstance.id)
    const nestedInstanceStableId = graph.identity.getStableId(nestedInstance)
    const nestedChildStableId = graph.identity.getStableId(nestedChild)
    nestedChild.width = 84
    outerInstance.overrides[`${nestedInstanceStableId}:overrides`] = {
      [`${nestedChildStableId}:width`]: 84
    }

    const clone = graph.cloneTree(outerInstance.id, page.id)
    if (!clone) throw new Error('clone failed')
    const clonedNestedInstance = firstChild(graph, clone.id)
    const clonedNestedChild = firstChild(graph, clonedNestedInstance.id)
    const clonedNestedInstanceStableId = graph.identity.getStableId(clonedNestedInstance)
    const clonedNestedChildStableId = graph.identity.getStableId(clonedNestedChild)
    const clonedNestedOverrides = clone.overrides[`${clonedNestedInstanceStableId}:overrides`]

    expect(clone.overrides[`${nestedInstanceStableId}:overrides`]).toBeUndefined()
    expect(clonedNestedOverrides).toEqual({ [`${clonedNestedChildStableId}:width`]: 84 })

    graph.syncInstances(outerComponent.id)

    expect(clonedNestedChild.width).toBe(84)
  })

  test('clone remaps nested runtime override records recursively', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const innerComponent = graph.createNode('COMPONENT', page.id, {
      name: 'Inner',
      width: 60,
      height: 20
    })
    graph.createNode('RECTANGLE', innerComponent.id, { name: 'Inner Bg', width: 60, height: 20 })
    const outerComponent = graph.createNode('COMPONENT', page.id, {
      name: 'Outer',
      width: 120,
      height: 48
    })
    const nestedInstanceInComponent = graph.createInstance(innerComponent.id, outerComponent.id)
    if (!nestedInstanceInComponent) throw new Error('nested instance failed')

    const outerInstance = graph.createInstance(outerComponent.id, page.id)
    if (!outerInstance) throw new Error('outer instance failed')
    const nestedInstance = firstChild(graph, outerInstance.id)
    const nestedChild = firstChild(graph, nestedInstance.id)
    nestedChild.width = 84
    outerInstance.overrides[`${nestedInstance.id}:overrides`] = {
      [`${nestedChild.id}:width`]: 84
    }

    const clone = graph.cloneTree(outerInstance.id, page.id)
    if (!clone) throw new Error('clone failed')
    const clonedNestedInstance = firstChild(graph, clone.id)
    const clonedNestedChild = firstChild(graph, clonedNestedInstance.id)
    const clonedNestedInstanceStableId = graph.identity.getStableId(clonedNestedInstance)
    const clonedNestedChildStableId = graph.identity.getStableId(clonedNestedChild)

    expect(clone.overrides[`${nestedInstance.id}:overrides`]).toBeUndefined()
    expect(clone.overrides[`${clonedNestedInstanceStableId}:overrides`]).toEqual({
      [`${clonedNestedChildStableId}:width`]: 84
    })

    graph.syncInstances(outerComponent.id)

    expect(clonedNestedChild.width).toBe(84)
  })
})
