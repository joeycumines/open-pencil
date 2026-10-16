import { describe, expect, test } from 'bun:test'

import { DESIGN_JSX_ELEMENTS, elementTag } from '#design-jsx/elements'
import { createDesignJSXRenderer } from '#design-jsx/index'

import { SceneGraph } from '@open-pencil/scene-graph'

const renderer = createDesignJSXRenderer<never>({
  icon: () => Promise.resolve(null),
  svg: () => null,
  createArtwork: () => {
    throw new Error('No artwork in these tests')
  },
  layout: () => {
    // Element types do not depend on layout.
  }
})

const LAYER_ELEMENTS = DESIGN_JSX_ELEMENTS.filter((element) => element.nodeType !== undefined)

describe('design JSX elements', () => {
  test.each(LAYER_ELEMENTS.map((element) => [element.name, element.nodeType]))(
    '<%s /> builds a %s',
    async (name, nodeType) => {
      const graph = new SceneGraph()
      const [result] = await renderer.renderJSX(graph, `<${name} />`)
      expect(graph.getNode(result.id)?.type).toBe(nodeType)
      expect(result.warnings ?? []).toEqual([])
    }
  )

  test('every layer type an element writes is written by that element', () => {
    for (const element of DESIGN_JSX_ELEMENTS) {
      for (const type of element.writes ?? []) expect(elementTag(type)).toBe(element.name)
    }
  })
})
