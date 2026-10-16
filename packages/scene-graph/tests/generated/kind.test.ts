import { describe, expect, test } from 'bun:test'

import {
  createSticky,
  generatedFrameKind,
  generatedFrameText,
  layerResizes,
  layerRotates,
  SceneGraph,
  stickySublayers
} from '@open-pencil/scene-graph'

describe('generated frame kinds', () => {
  test('a sticky note edits its body in place, stays upright, and scales by its own handles', () => {
    const graph = new SceneGraph()
    const sticky = createSticky(graph, graph.getPages()[0].id, { text: 'Hi' })
    expect(generatedFrameText(graph, sticky)?.id).toBe(stickySublayers(graph, sticky)?.body.id)
    expect([layerRotates(sticky), layerResizes(sticky)]).toEqual([false, false])
    expect(generatedFrameKind(sticky)?.namedByText).toBe(true)
    expect(generatedFrameKind(sticky)?.complete(graph, sticky)).toBe(true)
  })

  test('any other layer has no kind and turns and resizes freely', () => {
    const rectangle = { type: 'RECTANGLE' as const }
    expect(generatedFrameKind(rectangle)).toBeUndefined()
    expect([layerRotates(rectangle), layerResizes(rectangle)]).toEqual([true, true])
  })
})
