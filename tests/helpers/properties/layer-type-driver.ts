import type { Page } from '@playwright/test'

/** Builds a frame holding a rectangle, selected, and reads back the layer's type. */
export function layerTypeDriver(page: () => Page) {
  let id: string | undefined

  return {
    async build() {
      id = await page().evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const frame = store.createShape('FRAME', 100, 100, 200, 150)
        store.createShape('RECTANGLE', 20, 20, 40, 40, frame)
        store.select([frame])
        return frame
      })
    },

    type() {
      if (!id) throw new Error('Build the scene first')
      return page().evaluate(
        (nodeId) => window.openPencil?.getStore?.().graph.getNode(nodeId)?.type,
        id
      )
    }
  }
}
