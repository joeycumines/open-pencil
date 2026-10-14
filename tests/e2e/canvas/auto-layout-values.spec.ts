import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { autoLayoutValuesDriver } from '#tests/helpers/canvas/auto-layout-values/driver'

// The pills Figma desktop 126 shows over a gap and a padding: as wide as the value, centred.

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')

test('a gap and a padding show their values in pills that fit them', async () => {
  const scene = autoLayoutValuesDriver(() => editor.page)
  await scene.build()
  for (const [name, x] of [
    ['gap', 37 + 80 + 4],
    ['padding', 18]
  ] as const) {
    const point = scene.point(x, 50)
    await editor.canvas.hover(point.x, point.y)
    editor.canvas.assertNoErrors()
    const buffer = await editor.canvas.screenshotCanvasRegion(700, 400)
    expect(buffer).toMatchSnapshot(`auto-layout-${name}-value.png`, {
      maxDiffPixelRatio: 0,
      threshold: 0
    })
  }
})
