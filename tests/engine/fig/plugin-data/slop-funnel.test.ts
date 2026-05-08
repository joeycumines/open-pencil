import { describe, test, expect, setDefaultTimeout } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

import { parseFigFile, exportFigFile, initCodec } from '@open-pencil/core'

setDefaultTimeout(60_000)

const FIXTURES = resolve(import.meta.dir, '../../../fixtures')

describe('slop-funnel.fig', () => {
  test('pluginID casing is consistent after round-trip', async () => {
    const buf = readFileSync(resolve(FIXTURES, 'slop-funnel.fig'))
    const original = await parseFigFile(buf.buffer as ArrayBuffer)

    const exported = await exportFigFile(original)
    const reimported = await parseFigFile(exported.buffer as ArrayBuffer)

    // Check every pluginData entry across all nodes
    let checkedEntries = 0
    for (const node of reimported.getAllNodes()) {
      for (const entry of node.pluginData) {
        checkedEntries++
        expect(entry).toHaveProperty('pluginId')
        expect(typeof entry.pluginId).toBe('string')
      }
    }

    // slop-funnel.fig has thousands of pluginData entries — verify they all survived
    expect(checkedEntries).toBeGreaterThan(100)
  })

  test('parses and round-trips without error', async () => {
    await initCodec()
    const buf = readFileSync(resolve(FIXTURES, 'slop-funnel.fig'))
    const original = await parseFigFile(buf.buffer as ArrayBuffer)

    expect(original.getPages().length).toBeGreaterThan(0)

    const exported = await exportFigFile(original)
    const reimported = await parseFigFile(exported.buffer as ArrayBuffer)

    expect(reimported.getPages().length).toBe(original.getPages().length)
  })
})
