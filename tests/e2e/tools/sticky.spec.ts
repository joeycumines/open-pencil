import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { stickyDriver } from '#tests/helpers/canvas/sticky-driver'
import { toolbarToolTestId } from '#tests/helpers/test-ids'

const editor = useEditorSetupWithClear()
const sticky = stickyDriver(() => editor.page)

const YELLOW = { r: 1, g: 226 / 255, b: 153 / 255, a: 1 }

test.beforeEach(async () => {
  await editor.page.keyboard.press('Escape')
  await sticky.showOrigin()
})

/** The page's last note, which each test places or sets up itself. */
async function lastNote() {
  const note = (await sticky.notes()).at(-1)
  if (!note) throw new Error('Missing sticky note')
  return note
}

async function clickNote(x: number, y: number) {
  const point = sticky.point(x, y)
  await editor.canvas.click(point.x, point.y)
  await editor.canvas.waitForRender()
}

test('the toolbar keeps the sticky tool hidden, and S does not pick it', async () => {
  await expect(editor.page.getByTestId(toolbarToolTestId('STICKY'))).toHaveCount(0)
  await editor.page.keyboard.press('s')
  expect((await sticky.focus()).tool).toBe('SELECT')
})

test('the sticky tool places a note centred on the click to type into', async () => {
  await sticky.showTool()
  await sticky.pickTool()
  await clickNote(300, 200)
  const placed = await lastNote()
  expect(placed).toMatchObject({ x: 180, y: 80, width: 240, height: 240, body: { text: '' } })
  const focus = await sticky.focus()
  expect(focus.selected).toEqual([placed.id])
  expect(focus.editing).not.toBeNull()

  await editor.page.keyboard.type('Hello sticky')
  await editor.page.keyboard.press('Escape')
  await editor.canvas.waitForRender()
  expect(await lastNote()).toMatchObject({ name: 'Hello sticky', body: { text: 'Hello sticky' } })
  expect(await sticky.focus()).toMatchObject({
    tool: 'SELECT',
    selected: [placed.id],
    editing: null
  })
})

test('the Sticky note section recolours a note, sizes its text, and hides its author', async () => {
  await sticky.add([{ x: 300, y: 200, text: 'Panel', author: 'Ada' }])
  await clickNote(300, 200)
  const section = editor.page.getByRole('region', { name: 'Sticky note' })

  await section.getByRole('radio', { name: 'Yellow' }).click()
  await expect.poll(async () => (await lastNote()).fill).toBe('#ffe299')

  await section.getByRole('combobox', { name: 'Text size' }).click()
  await editor.page.getByRole('option', { name: 'Large', exact: true }).click()
  await expect.poll(async () => (await lastNote()).body.fontSize).toBe(40)

  await section.getByRole('switch', { name: 'Show author' }).click()
  await expect.poll(async () => (await lastNote()).author.visible).toBe(false)
})

test('the sticky tool places notes in the colour picked last', async () => {
  await sticky.add([{ x: 150, y: 150, text: 'First' }])
  await clickNote(150, 150)
  await editor.page
    .getByRole('region', { name: 'Sticky note' })
    .getByRole('radio', { name: 'Yellow' })
    .click()
  await sticky.showTool()
  await sticky.pickTool()
  await clickNote(600, 150)
  expect((await lastNote()).fill).toBe('#ffe299')
})

test('double-clicking a note edits its body with all of it selected', async () => {
  await sticky.add([{ x: 300, y: 200, text: 'Draft', color: YELLOW }])
  const point = sticky.point(300, 200)
  await editor.canvas.dblclick(point.x, point.y)
  await editor.canvas.waitForRender()
  expect((await sticky.focus()).editing).not.toBeNull()

  await editor.page.keyboard.type('Replaced')
  await editor.page.keyboard.press('Escape')
  await editor.canvas.waitForRender()
  const edited = await lastNote()
  expect(edited).toMatchObject({ body: { text: 'Replaced' }, name: 'Replaced' })
  expect((await sticky.focus()).selected).toEqual([edited.id])
})

test("dragging a note's side makes it wide, and back square, as in FigJam", async () => {
  await sticky.add([{ x: 300, y: 200, text: 'Wide' }])
  await clickNote(300, 200)
  // The note spans 180 to 420 across, centred on 200 down.
  const edge = sticky.point(420, 200)
  await editor.canvas.drag(edge.x, edge.y, edge.x + 150, edge.y)
  await expect.poll(async () => (await lastNote()).width).toBe(416)
  await editor.canvas.drag(edge.x + 176, edge.y, edge.x - 20, edge.y)
  await expect.poll(async () => (await lastNote()).width).toBe(240)
})
