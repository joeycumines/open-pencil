import type { Page } from '@playwright/test'

import type { LayoutGrid } from '@open-pencil/scene-graph'

/** Builds frames with layout guides and a rectangle, selects them, and reads their guides back. */
export function layoutGuidesDriver(page: () => Page) {
  return {
    /** One frame per guide list, side by side, and a rectangle below them. */
    build(guides: LayoutGrid[][]) {
      return page().evaluate((guides) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const frames = guides.map((layoutGrids, index) => {
          const id = store.createShape('FRAME', 100 + index * 260, 100, 200, 150)
          store.updateNode(id, { layoutGrids })
          return id
        })
        const rect = store.createShape('RECTANGLE', 100, 400, 100, 100)
        return { frames, rect }
      }, guides)
    },

    select(ids: string[]) {
      return page().evaluate((ids) => window.openPencil?.getStore?.().select(ids), ids)
    },

    /** Each layer's guides, as "PATTERN count sectionSize". */
    guides(ids: string[]) {
      return page().evaluate(
        (ids) =>
          ids.map((id) =>
            window.openPencil
              ?.getStore?.()
              .graph.getNode(id)
              ?.layoutGrids.map((grid) =>
                `${grid.pattern} ${grid.count ?? ''} ${grid.sectionSize ?? ''}`.trim()
              )
          ),
        ids
      )
    }
  }
}
