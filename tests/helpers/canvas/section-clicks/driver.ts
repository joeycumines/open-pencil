import type { Page } from '@playwright/test'

import type * as SectionScene from '#tests/helpers/canvas/section-clicks/scene'

/** The view offset the scene is shown at, at zoom 1, so canvas points are scene points plus it. */
const PAN = 50

/** Builds the section-click scene and reads back what pointer input selected. */
export function sectionClicksDriver(page: () => Page) {
  return {
    build() {
      return page().evaluate(async (pan) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const fixtureURL = '/tests/helpers/canvas/section-clicks/scene.ts'
        const scene: typeof SectionScene = await import(fixtureURL)
        scene.createSectionClickScene(store.graph, store.state.currentPageId)
        store.state.zoom = 1
        store.state.panX = pan
        store.state.panY = pan
        store.clearSelection()
        store.requestRender()
      }, PAN)
    },

    clearSelection() {
      return page().evaluate(() => window.openPencil?.getStore?.().clearSelection())
    },

    /** The selected layers' names. */
    selection() {
      return page().evaluate(() => {
        const store = window.openPencil?.getStore?.()
        return [...(store?.state.selectedIds ?? [])].map((id) => store?.graph.getNode(id)?.name)
      })
    },

    /** The page point over a scene point. */
    async point(x: number, y: number) {
      const box = await page().getByTestId('canvas-element').boundingBox()
      if (!box) throw new Error('Canvas has no bounding box')
      return { x: box.x + PAN + x, y: box.y + PAN + y }
    }
  }
}
