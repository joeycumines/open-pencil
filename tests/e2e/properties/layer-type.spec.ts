import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { layerTypeDriver } from '#tests/helpers/properties/layer-type-driver'

test('the layer type menu turns a frame into a group and back', async ({ page }) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const layer = layerTypeDriver(() => page)
  await layer.build()
  const trigger = page.getByRole('button', { name: 'Layer type', exact: true })
  await trigger.click()
  await page.getByRole('menuitem', { name: 'Group', exact: true }).click()
  await expect.poll(() => layer.type()).toBe('GROUP')
  await trigger.click()
  await page.getByRole('menuitem', { name: 'Frame', exact: true }).click()
  await expect.poll(() => layer.type()).toBe('FRAME')
})

test('the layer type menu turns a frame on the page into a section and back', async ({ page }) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const layer = layerTypeDriver(() => page)
  await layer.build()
  const trigger = page.getByRole('button', { name: 'Layer type', exact: true })
  await trigger.click()
  await page.getByRole('menuitem', { name: 'Section', exact: true }).click()
  await expect.poll(() => layer.type()).toBe('SECTION')
  await trigger.click()
  await expect(page.getByRole('menuitem', { name: 'Group', exact: true })).toBeDisabled()
  await page.getByRole('menuitem', { name: 'Frame', exact: true }).click()
  await expect.poll(() => layer.type()).toBe('FRAME')
})
