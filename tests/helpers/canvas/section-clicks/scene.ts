import type { Fill, SceneGraph } from '@open-pencil/scene-graph'

const WHITE: Fill[] = [
  { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }
]

/** The section Figma desktop 126 was clicked on: an empty frame and one holding a rectangle. */
export function createSectionClickScene(graph: SceneGraph, pageId: string) {
  const section = graph.createNode('SECTION', pageId, {
    name: 'Section',
    width: 800,
    height: 500,
    fills: WHITE
  })
  graph.createNode('FRAME', section.id, {
    name: 'Empty',
    x: 50,
    y: 80,
    width: 200,
    height: 150,
    fills: WHITE
  })
  const full = graph.createNode('FRAME', section.id, {
    name: 'Full',
    x: 300,
    y: 80,
    width: 200,
    height: 150,
    fills: WHITE
  })
  graph.createNode('RECTANGLE', full.id, { name: 'Child', x: 10, y: 10, width: 40, height: 40 })
}
