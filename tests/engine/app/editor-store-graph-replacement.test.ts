import { describe, expect, test } from 'bun:test'

import { effectScope } from 'vue'

import { SceneGraph, type VectorNetwork } from '@open-pencil/scene-graph'

import { createEditorStore } from '@/app/editor/session'

const vectorNetwork: VectorNetwork = {
  vertices: [
    { x: 0, y: 0 },
    { x: 16, y: 0 },
    { x: 16, y: 16 },
    { x: 0, y: 16 }
  ],
  segments: [
    { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
    { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
    { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
    { start: 3, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }
  ],
  regions: []
}

function createReplacementVector(graph: SceneGraph) {
  return graph.createNode('VECTOR', graph.getPages()[0].id, {
    x: 40,
    y: 60,
    width: 16,
    height: 16,
    vectorNetwork
  })
}

function withEditorStore(run: (store: ReturnType<typeof createEditorStore>) => void) {
  const scope = effectScope()
  try {
    const completed = scope.run(() => {
      run(createEditorStore())
      return true
    })
    if (completed !== true) {
      throw new Error('Expected editor store effect scope to run')
    }
  } finally {
    scope.stop()
  }
}

describe('app editor graph replacement modules', () => {
  test('pen resume uses the active graph after replaceGraph', () => {
    withEditorStore((store) => {
      const replacementGraph = new SceneGraph()
      const vector = createReplacementVector(replacementGraph)

      store.replaceGraph(replacementGraph)
      store.penResumeOnPath(vector.id)

      expect(replacementGraph.getNode(vector.id)).toBeUndefined()
      expect(store.state.penState?.resumingNodeId).toBe(vector.id)
      expect(store.state.activeTool).toBe('PEN')
    })
  })

  test('vector edit mode uses the active graph after replaceGraph', () => {
    withEditorStore((store) => {
      const replacementGraph = new SceneGraph()
      const vector = createReplacementVector(replacementGraph)

      store.replaceGraph(replacementGraph)
      store.enterNodeEditMode(vector.id)

      expect(store.state.nodeEditState?.nodeId).toBe(vector.id)
      expect(store.state.nodeEditState?.vertices[0]).toEqual({ x: 40, y: 60 })
      expect([...store.state.selectedIds]).toEqual([vector.id])
    })
  })
})
