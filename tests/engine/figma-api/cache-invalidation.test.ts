import { describe, expect, test } from 'bun:test'

import { FigmaAPI, SceneGraph, createDefaultSource } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'

describe('FigmaAPI cache lifecycle', () => {
  test('getNodeById returns null after a node is deleted', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, { name: 'Rect' })
    const api = new FigmaAPI(graph)

    expect(api.getNodeById(rect.id)).not.toBeNull()
    graph.deleteNode(rect.id, { permanent: true })

    expect(api.getNodeById(rect.id)).toBeNull()
  })

  test('clearNodeCache empties the internal node cache', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, { name: 'Rect' })
    const api = new FigmaAPI(graph)

    api.wrapNode(rect.id)
    expect(api.__getNodeCacheForTest().has(rect.id)).toBeTrue()

    api.clearNodeCache()
    expect(api.__getNodeCacheForTest().size).toBe(0)
  })

  test('setGraph replaces graph, resets page, clears node cache and selection', () => {
    const oldGraph = new SceneGraph({ documentGuid: 'old-cache' })
    const oldPage = oldGraph.getPages()[0]
    const stableId = 'stable-for-cache-test'
    const oldRect = oldGraph.createNode(
      'RECTANGLE',
      oldPage.id,
      {
        name: 'Rect',
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )

    const newGraph = new SceneGraph({
      documentGuid: 'new-cache',
      reservedRuntimeIds: [oldRect.id]
    })
    newGraph.createNode(
      'RECTANGLE',
      newGraph.getPages()[0].id,
      {
        name: 'Rect',
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )

    const editor = createEditor({ graph: oldGraph, skipInitialGraphSetup: true })
    const api = new FigmaAPI(oldGraph)
    api.wrapNode(oldRect.id)
    expect(api.__getNodeCacheForTest().has(oldRect.id)).toBeTrue()

    editor.onEditorEvent('graph:replaced', ({ graph, translation }) => {
      api.setGraph(graph, translation)
    })
    editor.replaceGraph(newGraph)

    expect(api.graph).toBe(newGraph)
    expect(api.__getNodeCacheForTest().size).toBe(0)
    expect(api.currentPage.id).toBe(newGraph.getPages()[0].id)
  })

  test('setGraph translation map redirects old runtime ids to new nodes', () => {
    const oldGraph = new SceneGraph({ documentGuid: 'old-trans' })
    const oldPage = oldGraph.getPages()[0]
    const stableId = 'stable-trans'
    const oldRect = oldGraph.createNode(
      'RECTANGLE',
      oldPage.id,
      {
        name: 'Rect',
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )

    const newGraph = new SceneGraph({
      documentGuid: 'new-trans',
      reservedRuntimeIds: [oldRect.id]
    })
    const newRect = newGraph.createNode(
      'RECTANGLE',
      newGraph.getPages()[0].id,
      {
        name: 'Rect',
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )

    const translation = new Map<string, string>([
      [oldGraph.rootId, newGraph.rootId],
      [oldRect.id, newRect.id]
    ])

    const api = new FigmaAPI(oldGraph)
    api.setGraph(newGraph, translation)

    expect(api.getNodeById(oldRect.id)).not.toBeNull()
    expect(api.getNodeById(oldRect.id)?.id).toBe(newRect.id)
    expect(api.translateRuntimeId(oldRect.id)).toBe(newRect.id)
    expect(api.wrapNode(oldRect.id).id).toBe(newRect.id)
  })
})
