import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { sectionClicksDriver } from '#tests/helpers/canvas/section-clicks/driver'

// Each case repeats a click in Figma desktop 126 on a section holding two frames.

let scene: ReturnType<typeof sectionClicksDriver>
let canvas: CanvasHelper

test.beforeEach(async ({ page }) => {
  await page.goto('/?test')
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  scene = sectionClicksDriver(() => page)
  await scene.build()
})

test('a click on a section’s empty area selects it, a drag there marquee-selects inside it', async () => {
  await canvas.click(750, 450)
  await expect.poll(() => scene.selection()).toEqual(['Section'])
  await scene.clearSelection()
  await canvas.drag(80, 100, 550, 300)
  await expect.poll(() => scene.selection()).toEqual(['Empty', 'Full'])
})

test('a right-click selects the frame or section whose empty area is under it', async ({
  page
}) => {
  const clicked = scene
  for (const [x, y, name] of [
    [450, 180, 'Full'],
    [150, 155, 'Empty'],
    [700, 400, 'Section']
  ] as const) {
    await clicked.clearSelection()
    const point = await clicked.point(x, y)
    await page.mouse.click(point.x, point.y, { button: 'right' })
    await expect.poll(() => clicked.selection()).toEqual([name])
    await page.keyboard.press('Escape')
  }
})
