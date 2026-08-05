import { beforeAll, expect, setDefaultTimeout, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, type SceneGraph } from '@open-pencil/core'

import { readFixtureArrayBuffer, uint8ArrayToArrayBuffer } from '#tests/helpers/fig-fixtures'
import { heavy } from '#tests/helpers/test-utils'

const SLOP_FUNNEL_TIMEOUT_MS = 180_000

setDefaultTimeout(SLOP_FUNNEL_TIMEOUT_MS)

function pluginDataSnapshot(graph: SceneGraph): string[] {
  const entries: string[] = []
  for (const node of graph.getAllNodes()) {
    const sourceId = node.source.id ?? node.id
    for (const entry of node.pluginData) {
      // Imported null is the codec representation of this owned key's AUTO
      // default; FIG export intentionally writes its canonical semantic value.
      const value =
        entry.pluginId === 'open-pencil' && entry.key === 'textDirection'
          ? entry.value || 'AUTO'
          : entry.value
      entries.push(JSON.stringify([sourceId, entry.pluginId, entry.key, value]))
    }
  }
  return entries.sort()
}

heavy('slop-funnel.fig', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('preserves plugin data across one canonical round trip', async () => {
    const original = await parseFigFile(readFixtureArrayBuffer('slop-funnel.fig'))
    const before = pluginDataSnapshot(original)
    expect(before.length).toBeGreaterThan(100)

    const exported = await exportFigFile(original)
    const reimported = await parseFigFile(uint8ArrayToArrayBuffer(exported))

    expect(pluginDataSnapshot(reimported)).toEqual(before)
    expect(reimported.getPages().length).toBe(original.getPages().length)
  })
})
