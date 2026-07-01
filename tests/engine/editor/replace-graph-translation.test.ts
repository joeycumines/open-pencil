import { describe, expect, test } from 'bun:test'

import { SceneGraph, createDefaultSource } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'

describe('replaceGraph translation map', () => {
  test('maps root and stable-id nodes between old and new graphs', () => {
    const oldGraph = new SceneGraph({ documentGuid: 'old-doc' })
    const oldPage = oldGraph.getPages()[0]
    const stableRectId = 'stable-rect-001'
    const oldRect = oldGraph.createNode(
      'RECTANGLE',
      oldPage.id,
      {
        name: 'Rect',
        source: { ...createDefaultSource(), format: 'fig', id: stableRectId }
      },
      { mode: 'restore' }
    )

    const newGraph = new SceneGraph({
      documentGuid: 'new-doc',
      reservedRuntimeIds: [oldRect.id]
    })
    const newPage = newGraph.getPages()[0]
    const newRect = newGraph.createNode(
      'RECTANGLE',
      newPage.id,
      {
        name: 'Rect',
        source: { ...createDefaultSource(), format: 'fig', id: stableRectId }
      },
      { mode: 'restore' }
    )

    const editor = createEditor({ graph: oldGraph, skipInitialGraphSetup: true })
    let captured = new Map<string, string>()
    editor.onEditorEvent('graph:replaced', ({ translation }) => {
      captured = translation
    })
    editor.replaceGraph(newGraph)

    expect(captured.size).toBeGreaterThan(0)
    expect(captured.get(oldGraph.rootId)).toBe(newGraph.rootId)
    expect(captured.get(oldRect.id)).toBe(newRect.id)
    expect(oldRect.id).not.toBe(newRect.id)
  })

  test('only guarantees root translation for legacy graphs without source ids', () => {
    const oldGraph = new SceneGraph({ documentGuid: 'legacy-old' })
    const oldPage = oldGraph.getPages()[0]
    const oldRect = oldGraph.createNode('RECTANGLE', oldPage.id, { name: 'Legacy Rect' })
    oldRect.source = { ...oldRect.source, id: null }

    const newGraph = new SceneGraph({ documentGuid: 'legacy-new' })
    const newPage = newGraph.getPages()[0]
    const newRect = newGraph.createNode('RECTANGLE', newPage.id, { name: 'Legacy Rect' })
    newRect.source = { ...newRect.source, id: null }

    const editor = createEditor({ graph: oldGraph, skipInitialGraphSetup: true })
    let captured = new Map<string, string>()
    editor.onEditorEvent('graph:replaced', ({ translation }) => {
      captured = translation
    })
    editor.replaceGraph(newGraph)

    expect(captured.size).toBeGreaterThan(0)
    expect(captured.get(oldGraph.rootId)).toBe(newGraph.rootId)
    expect(captured.has(oldRect.id)).toBeFalse()
  })

  test('includes stable-node identity mappings when runtime ids are preserved', () => {
    const oldGraph = new SceneGraph({ documentGuid: 'stable-same-runtime-old' })
    const oldPage = oldGraph.getPages()[0]
    const stableRectId = 'stable-same-runtime-rect'
    const oldRect = oldGraph.createNode(
      'RECTANGLE',
      oldPage.id,
      {
        name: 'Rect',
        source: { ...createDefaultSource(), format: 'fig', id: stableRectId }
      },
      { mode: 'restore' }
    )

    const newGraph = new SceneGraph({ documentGuid: 'stable-same-runtime-new' })
    const newPage = newGraph.getPages()[0]
    const newRect = newGraph.createNode(
      'RECTANGLE',
      newPage.id,
      {
        id: oldRect.id,
        name: 'Rect',
        source: { ...createDefaultSource(), format: 'fig', id: stableRectId }
      },
      { mode: 'restore' }
    )
    expect(newRect.id).toBe(oldRect.id)

    const editor = createEditor({ graph: oldGraph, skipInitialGraphSetup: true })
    let captured = new Map<string, string>()
    editor.onEditorEvent('graph:replaced', ({ translation }) => {
      captured = translation
    })
    editor.replaceGraph(newGraph)

    expect(captured.get(oldGraph.rootId)).toBe(newGraph.rootId)
    expect(captured.get(oldRect.id)).toBe(newRect.id)
  })
})
