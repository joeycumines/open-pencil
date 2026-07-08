import { describe, expect, test } from 'bun:test'

import type { SceneGraph } from '@open-pencil/core'
import { SceneGraph as SceneGraphCtor } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'

describe('graph:replaced breaking payload', () => {
  test('payload destructures into graph and translation', () => {
    const oldGraph = new SceneGraphCtor()
    const newGraph = new SceneGraphCtor({ documentGuid: 'payload-graph' })
    const editor = createEditor({ graph: oldGraph, skipInitialGraphSetup: true })

    let receivedGraph: SceneGraph | null = null
    let receivedTranslation: Map<string, string> | null = null

    editor.onEditorEvent('graph:replaced', ({ graph, translation }) => {
      receivedGraph = graph
      receivedTranslation = translation
    })
    editor.replaceGraph(newGraph)

    expect(receivedGraph).toBe(newGraph)
    expect(receivedTranslation).toBeInstanceOf(Map)
    expect(receivedTranslation?.get(oldGraph.rootId)).toBe(newGraph.rootId)
  })

  test('migration adapter extracts graph from payload', () => {
    const oldGraph = new SceneGraphCtor()
    const newGraph = new SceneGraphCtor({ documentGuid: 'adapter-graph' })
    const editor = createEditor({ graph: oldGraph, skipInitialGraphSetup: true })

    let migratedGraph: SceneGraph | null = null
    editor.onEditorEvent('graph:replaced', ({ graph }) => {
      migratedGraph = graph
    })
    editor.replaceGraph(newGraph)

    expect(migratedGraph).toBe(newGraph)
  })
})
