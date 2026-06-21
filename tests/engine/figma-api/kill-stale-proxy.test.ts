import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'
import { FigmaAPI } from '@open-pencil/core/figma-api'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

/**
 * C-08: Stale FigmaNodeProxy silently mutates detached graph.
 *
 * FigmaNodeProxy stores [INTERNAL_GRAPH] at construction time and never
 * updates it. When setGraph is called, the FigmaAPI clears its cache Map
 * but proxies held externally still reference the old graph. Accessing
 * a stale proxy's properties reads from the old graph — no error is thrown,
 * but the data is wrong.
 *
 * How it fails: Create a proxy from graph1, call setGraph(graph2), access
 * proxy property. The proxy reads from graph1 (stale) instead of graph2.
 *
 * Fix that makes it pass: Remove [INTERNAL_GRAPH] field. Use
 * this[INTERNAL_API].graph to always access the current graph.
 */
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

    // Create a second graph WITHOUT the node
    const graph2 = new SceneGraph()
    const page2 = pageId(graph2)
    graph2.createNode('RECTANGLE', page2, {
      name: 'Different node',
      x: 20,
      y: 20,
      width: 200,
      height: 200
    })

    // Switch to graph2
    figma.setGraph(graph2, new Map())

    // The proxy should now read from graph2, where node1 doesn't exist
    // FAILS: proxy reads from graph1 (stale) and returns 'Node in graph1'
    // instead of throwing or returning undefined
    expect(() => {
      // Accessing the proxy's name should either throw (node removed)
      // or return undefined — NOT the stale value from graph1
      void proxy.name
    }).toThrow() // FAILS: no throw, returns stale 'Node in graph1'
  })

  test('proxy x position reflects current graph after setGraph', () => {
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

    // Create graph2 with a node at the same ID but different position
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

    figma.setGraph(graph2, new Map())

    // Proxy should reflect graph2's x value (999)
    // FAILS: proxy.x returns 100 (from graph1, stale)
    expect(proxy.x).toBe(999)
  })
})
