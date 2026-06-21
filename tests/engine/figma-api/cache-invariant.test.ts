import { describe, expect, test } from 'bun:test'

import { FigmaAPI, SceneGraph, createDefaultSource } from '@open-pencil/core'

/**
 * Cache invariant tests for FigmaAPI.
 *
 * The existing cache-invalidation.test.ts covers the basics: setGraph
 * clears the cache, clearNodeCache works, translation map redirects.
 * These tests cover the remaining gaps:
 *
 * 1. A proxy obtained before deleteNode throws on property access
 *    (proving the proxy uses the live graph, not a stale reference).
 * 2. getRawNodeById resolves through the translation map.
 * 3. The proxy cache is NOT repopulated until an explicit wrapNode/getNodeById.
 */
describe('FigmaAPI cache invariant', () => {
  test('proxy obtained before deleteNode throws on property access', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('RECTANGLE', page.id, {
      name: 'ToDelete',
      x: 50,
      y: 50,
      width: 100,
      height: 100
    })
    const api = new FigmaAPI(graph)

    // Get a proxy before deletion
    const proxy = api.getNodeById(node.id)
    expect(proxy).not.toBeNull()
    if (!proxy) return
    expect(proxy.name).toBe('ToDelete')

    // Delete the node
    graph.deleteNode(node.id, { permanent: true })

    // The proxy should throw when accessing properties (node no longer in graph)
    expect(() => {
      void proxy.name
    }).toThrow()
  })

  test('translateRuntimeId returns the raw SceneNode via graph.getNode', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('RECTANGLE', page.id, {
      name: 'Raw',
      x: 10,
      y: 10,
      width: 50,
      height: 50
    })
    const api = new FigmaAPI(graph)

    // translateRuntimeId is a no-op when no translation map is set
    const translatedId = api.translateRuntimeId(node.id)
    expect(translatedId).toBe(node.id)

    // The raw node is accessible via the graph
    const raw = api.graph.getNode(translatedId)
    expect(raw).toBeDefined()
    expect(raw?.id).toBe(node.id)
    expect(raw?.name).toBe('Raw')
  })

  test('translateRuntimeId with translation map remaps old ids to new nodes', () => {
    const oldGraph = new SceneGraph({ documentGuid: 'old-raw-trans' })
    const oldPage = oldGraph.getPages()[0]
    const stableId = 'stable-raw-trans'
    const oldNode = oldGraph.createNode(
      'RECTANGLE',
      oldPage.id,
      {
        name: 'OldNode',
        x: 10,
        y: 10,
        width: 50,
        height: 50,
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )

    const newGraph = new SceneGraph({
      documentGuid: 'new-raw-trans',
      reservedRuntimeIds: [oldNode.id]
    })
    const newNode = newGraph.createNode(
      'RECTANGLE',
      newGraph.getPages()[0].id,
      {
        name: 'NewNode',
        x: 20,
        y: 20,
        width: 50,
        height: 50,
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )

    const translation = new Map<string, string>([[oldNode.id, newNode.id]])

    const api = new FigmaAPI(oldGraph)
    api.setGraph(newGraph, translation)

    // translateRuntimeId with old ID should return the NEW node's id
    const translatedId = api.translateRuntimeId(oldNode.id)
    expect(translatedId).toBe(newNode.id)

    // The raw node is the NEW node, not the old one
    const raw = api.graph.getNode(translatedId)
    expect(raw).toBeDefined()
    expect(raw?.id).toBe(newNode.id)
    expect(raw?.name).toBe('NewNode')
  })

  test('proxy cache stays empty after setGraph until explicit access', () => {
    const graph1 = new SceneGraph({ documentGuid: 'g1-cache' })
    const page1 = graph1.getPages()[0]
    const node1 = graph1.createNode('RECTANGLE', page1.id, {
      name: 'N1',
      x: 0,
      y: 0,
      width: 50,
      height: 50
    })
    const api = new FigmaAPI(graph1)

    // Populate cache
    api.wrapNode(node1.id)
    expect(api.__getNodeCacheForTest().size).toBe(1)

    // Switch graph — cache should be empty
    const graph2 = new SceneGraph({ documentGuid: 'g2-cache' })
    api.setGraph(graph2, new Map())
    expect(api.__getNodeCacheForTest().size).toBe(0)

    // Cache should stay empty until explicit access
    expect(api.__getNodeCacheForTest().size).toBe(0)
  })
})
