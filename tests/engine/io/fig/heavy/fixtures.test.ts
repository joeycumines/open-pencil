import { beforeAll, expect, setDefaultTimeout, test } from 'bun:test'

import type { NodeChange } from '@open-pencil/core/kiwi'
import { parseFigBuffer } from '@open-pencil/kiwi/fig/parse'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { resolveNodeType } from '#core/kiwi/fig/node-change/convert'

import { readFixtureBytes, VALID_NODE_TYPES } from '#tests/helpers/fig-fixtures'
import { HEAVY_TEST_TIMEOUT_MS, heavy } from '#tests/helpers/test-utils'

setDefaultTimeout(HEAVY_TEST_TIMEOUT_MS)

interface RawFixtureSummary {
  canvasCount: number
  componentCount: number
  invalidMappedTypes: string[]
  invalidSolidColorCount: number
  nodeChangeCount: number
  solidFillCount: number
}

function fixtureBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function colorChannelsAreValid(color: Color | undefined): boolean {
  if (color === undefined) return false
  return [color.r, color.g, color.b, color.a].every(
    (channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1
  )
}

function summarizeRawFixture(name: string): RawFixtureSummary {
  const bytes = readFixtureBytes(name)
  const { nodeChanges } = parseFigBuffer(fixtureBytesToArrayBuffer(bytes))
  const summary: RawFixtureSummary = {
    canvasCount: 0,
    componentCount: 0,
    invalidMappedTypes: [],
    invalidSolidColorCount: 0,
    nodeChangeCount: nodeChanges.length,
    solidFillCount: 0
  }

  for (const nc of nodeChanges) {
    if (nc.type === 'CANVAS') summary.canvasCount++
    const mappedType = resolveNodeType(nc)
    if (mappedType === 'COMPONENT') summary.componentCount++
    if (
      mappedType !== 'DOCUMENT' &&
      mappedType !== 'VARIABLE' &&
      !VALID_NODE_TYPES.has(mappedType)
    ) {
      summary.invalidMappedTypes.push(`${nc.name ?? '<unnamed>'}: ${mappedType}`)
    }
    collectSolidFillColorStats(nc, summary)
  }

  return summary
}

function collectSolidFillColorStats(nc: NodeChange, summary: RawFixtureSummary): void {
  for (const fill of nc.fillPaints ?? []) {
    if (fill.type !== 'SOLID') continue
    summary.solidFillCount++
    if (!colorChannelsAreValid(fill.color)) summary.invalidSolidColorCount++
  }
}

heavy('parse heavy .fig files', () => {
  let material3Summary: RawFixtureSummary
  let nuxtuiSummary: RawFixtureSummary

  beforeAll(() => {
    material3Summary = summarizeRawFixture('material3.fig')
    nuxtuiSummary = summarizeRawFixture('nuxtui.fig')
  })

  test('material3.fig decodes with pages and node changes', () => {
    expect(material3Summary.canvasCount).toBeGreaterThan(0)
    expect(material3Summary.nodeChangeCount).toBeGreaterThan(0)
  })

  test('nuxtui.fig decodes with pages and node changes', () => {
    expect(nuxtuiSummary.canvasCount).toBeGreaterThan(0)
    expect(nuxtuiSummary.nodeChangeCount).toBeGreaterThan(0)
  })

  test('material3: contains COMPONENT nodes', () => {
    expect(material3Summary.componentCount).toBeGreaterThan(0)
  })

  test('material3: raw node changes map to known OpenPencil node types', () => {
    expect(material3Summary.invalidMappedTypes).toEqual([])
  })

  test('nuxtui: raw node changes map to known OpenPencil node types', () => {
    expect(nuxtuiSummary.invalidMappedTypes).toEqual([])
  })

  test('material3: raw solid fills have valid colors', () => {
    expect(material3Summary.solidFillCount).toBeGreaterThan(0)
    expect(material3Summary.invalidSolidColorCount).toBe(0)
  })

  test('nuxtui: raw solid fills have valid colors', () => {
    expect(nuxtuiSummary.solidFillCount).toBeGreaterThan(0)
    expect(nuxtuiSummary.invalidSolidColorCount).toBe(0)
  })
})
