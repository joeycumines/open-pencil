import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { layoutGuidesDriver } from '#tests/helpers/properties/layout-guides-driver'

// Each case repeats a selection made in Figma desktop 126.

const COLUMNS = {
  pattern: 'COLUMNS' as const,
  count: 5,
  gutterSize: 20,
  offset: 0,
  visible: true,
  color: { r: 1, g: 0, b: 0, a: 0.1 }
}

async function setup(page: Page, guides: (typeof COLUMNS)[][]) {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const scene = layoutGuidesDriver(() => page)
  return { scene, ...(await scene.build(guides)) }
}

const heading = (page: Page) => page.getByRole('heading', { name: 'Layout guide', exact: true })

test('frames with the same guides list them, and an edit changes every frame in one Undo', async ({
  page
}) => {
  const { scene, frames } = await setup(page, [[COLUMNS], [COLUMNS]])
  await scene.select(frames)
  await expect(page.locator('[data-property="layout-guide-pattern"]')).toHaveText('5 columns')
  await page.locator('[data-property="layout-guide-settings"]').click()
  const count = page.getByRole('spinbutton', { name: 'Count', exact: true })
  await expect(count).toBeVisible()
  await count.dblclick()
  await count.fill('8')
  await count.press('Enter')
  await expect.poll(() => scene.guides(frames)).toEqual([['COLUMNS 8'], ['COLUMNS 8']])
  await heading(page).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => scene.guides(frames)).toEqual([['COLUMNS 5'], ['COLUMNS 5']])
})

test('frames with different guides show none, and Add gives each one 10 px grid', async ({
  page
}) => {
  const { scene, frames } = await setup(page, [[COLUMNS], []])
  await scene.select(frames)
  await expect(heading(page)).toBeVisible()
  await expect(page.locator('[data-property="layout-guide-settings"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add layout guide' }).click()
  await expect.poll(() => scene.guides(frames)).toEqual([['GRID 5 10'], ['GRID 5 10']])
})

test('switching a guide to rows keeps its count and names the new pattern', async ({ page }) => {
  const { scene, frames } = await setup(page, [[COLUMNS]])
  await scene.select(frames)
  await page.locator('[data-property="layout-guide-pattern"]').click()
  await page.getByRole('option', { name: 'Rows', exact: true }).click()
  await expect.poll(() => scene.guides(frames)).toEqual([['ROWS 5']])
  await expect(page.locator('[data-property="layout-guide-pattern"]')).toHaveText('5 rows')
})

test('a selection with a layer that is not a frame has no layout guides', async ({ page }) => {
  const { scene, frames, rect } = await setup(page, [[COLUMNS]])
  await scene.select([frames[0], rect])
  await expect(page.getByRole('heading', { name: 'Fill', exact: true })).toBeVisible()
  await expect(heading(page)).toHaveCount(0)
})
