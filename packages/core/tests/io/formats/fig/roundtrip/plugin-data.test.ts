import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/kiwi/fig/codec'

import { readFixtureArrayBuffer } from '#core-tests/helpers/fig/fixtures'

setDefaultTimeout(60_000)

describe('.fig round trip of a document with plugin data', () => {
  test('keeps every plugin data entry readable', async () => {
    const reopened = await parseFigFile(readFixtureArrayBuffer('slop-funnel.fig'))
    const exported = await exportFigFile(reopened)
    const reimported = await parseFigFile(exported.slice().buffer)

    let checkedEntries = 0
    for (const node of reimported.getAllNodes()) {
      for (const entry of node.pluginData) {
        checkedEntries++
        expect(typeof entry.pluginId).toBe('string')
      }
    }

    // The fixture carries thousands of entries; all of them must survive the round trip.
    expect(checkedEntries).toBeGreaterThan(100)
  })

  test('keeps every page', async () => {
    await initCodec()
    const original = await parseFigFile(readFixtureArrayBuffer('slop-funnel.fig'))
    expect(original.getPages().length).toBeGreaterThan(0)

    const exported = await exportFigFile(original)
    const reimported = await parseFigFile(exported.slice().buffer)

    expect(reimported.getPages().length).toBe(original.getPages().length)
  })
})
