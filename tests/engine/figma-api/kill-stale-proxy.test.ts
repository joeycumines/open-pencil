import { describe, expect, test } from 'bun:test'

import { SceneGraph, createDefaultSource } from '@open-pencil/core'
import { FigmaAPI } from '@open-pencil/core/figma-api'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

describe('C-08: Stale FigmaNodeProxy uses detached graph', () => {
  test('proxy held across setGraph should use new graph', () => {
    const graph1 = new SceneGraph()
    const page1 = pageId(graph1)
    const node1 = graph1.createNode('RECTANGLE', page1, {
      name: 'Node in graph1',
      x: 10,
      y: 10,
      width: 100,
      height: 100
    })

    const figma = new FigmaAPI(graph1)
    const proxy = figma.getNodeById(node1.id)

    expect(proxy).not.toBeNull()
    if (!proxy) return
    expect(proxy.name).toBe('Node in graph1')

    const graph2 = new SceneGraph()
    const page2 = pageId(graph2)
    graph2.createNode('RECTANGLE', page2, {
      name: 'Different node',
      x: 20,
      y: 20,
      width: 200,
      height: 200
    })

    figma.setGraph(graph2, new Map())

    expect(() => {
      void proxy.name
    }).toThrow()
  })

  test('proxy x position reflects current graph after explicit identity translation', () => {
    const graph1 = new SceneGraph()
    const page1 = pageId(graph1)
    const node1 = graph1.createNode('RECTANGLE', page1, {
      name: 'Box',
      x: 100,
      y: 200,
      width: 50,
      height: 50
    })

    const figma = new FigmaAPI(graph1)
    const proxy = figma.getNodeById(node1.id)
    expect(proxy).not.toBeNull()
    if (!proxy) return
    expect(proxy.x).toBe(100)

    const graph2 = new SceneGraph()
    const page2 = pageId(graph2)
    graph2.createNode('RECTANGLE', page2, {
      id: node1.id,
      name: 'Box',
      x: 999,
      y: 888,
      width: 50,
      height: 50
    })

    figma.setGraph(graph2, new Map([[node1.id, node1.id]]))

    expect(proxy.x).toBe(999)
  })

  test('held proxy translates getters and setters after setGraph translation', () => {
    const oldGraph = new SceneGraph({ documentGuid: 'old-held-proxy' })
    const oldPage = pageId(oldGraph)
    const stableId = 'stable-held-proxy-node'
    const oldNode = oldGraph.createNode(
      'RECTANGLE',
      oldPage,
      {
        name: 'Old rectangle',
        x: 10,
        width: 100,
        height: 100,
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )

    const newGraph = new SceneGraph({
      documentGuid: 'new-held-proxy',
      reservedRuntimeIds: [oldNode.id]
    })
    const newNode = newGraph.createNode(
      'RECTANGLE',
      pageId(newGraph),
      {
        name: 'New rectangle',
        x: 90,
        width: 120,
        height: 120,
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )
    expect(newNode.id).not.toBe(oldNode.id)

    const api = new FigmaAPI(oldGraph)
    const proxy = api.getNodeById(oldNode.id)
    expect(proxy).not.toBeNull()
    if (!proxy) return

    api.setGraph(newGraph, new Map([[oldNode.id, newNode.id]]))

    expect(proxy.id).toBe(newNode.id)
    expect(proxy.name).toBe('New rectangle')
    expect(proxy.x).toBe(90)

    proxy.name = 'Updated through held proxy'
    proxy.x = 123

    expect(newGraph.getNode(newNode.id)?.name).toBe('Updated through held proxy')
    expect(newGraph.getNode(newNode.id)?.x).toBe(123)
    expect(oldGraph.getNode(oldNode.id)?.name).toBe('Old rectangle')
    expect(oldGraph.getNode(oldNode.id)?.x).toBe(10)
  })

  test('held proxies translate traversal and method arguments after setGraph', () => {
    const oldGraph = new SceneGraph({ documentGuid: 'old-held-tree' })
    const oldPage = pageId(oldGraph)
    const parentStableId = 'stable-held-parent'
    const childStableId = 'stable-held-child'
    const oldParent = oldGraph.createNode(
      'FRAME',
      oldPage,
      {
        name: 'Old parent',
        source: { ...createDefaultSource(), format: 'fig', id: parentStableId }
      },
      { mode: 'restore' }
    )
    const oldChild = oldGraph.createNode(
      'RECTANGLE',
      oldPage,
      {
        name: 'Old child',
        source: { ...createDefaultSource(), format: 'fig', id: childStableId }
      },
      { mode: 'restore' }
    )

    const newGraph = new SceneGraph({
      documentGuid: 'new-held-tree',
      reservedRuntimeIds: [oldParent.id, oldChild.id]
    })
    const newParent = newGraph.createNode(
      'FRAME',
      pageId(newGraph),
      {
        name: 'New parent',
        source: { ...createDefaultSource(), format: 'fig', id: parentStableId }
      },
      { mode: 'restore' }
    )
    const newChild = newGraph.createNode(
      'RECTANGLE',
      pageId(newGraph),
      {
        name: 'New child',
        source: { ...createDefaultSource(), format: 'fig', id: childStableId }
      },
      { mode: 'restore' }
    )
    expect(newParent.id).not.toBe(oldParent.id)
    expect(newChild.id).not.toBe(oldChild.id)

    const api = new FigmaAPI(oldGraph)
    const heldParent = api.getNodeById(oldParent.id)
    const heldChild = api.getNodeById(oldChild.id)
    expect(heldParent).not.toBeNull()
    expect(heldChild).not.toBeNull()
    if (!heldParent || !heldChild) return

    api.setGraph(
      newGraph,
      new Map([
        [oldParent.id, newParent.id],
        [oldChild.id, newChild.id]
      ])
    )

    heldParent.appendChild(heldChild)

    expect(newGraph.getNode(newChild.id)?.parentId).toBe(newParent.id)
    expect(oldGraph.getNode(oldChild.id)?.parentId).toBe(oldPage)
    expect(heldParent.children.map((child) => child.id)).toEqual([newChild.id])
  })
})
