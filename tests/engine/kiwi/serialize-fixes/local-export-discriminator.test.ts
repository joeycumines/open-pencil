import { describe, expect, test } from 'bun:test'

import { exportFigFile, parseFigFile, SceneGraph } from '@open-pencil/core'

import { pageId, toKiwi } from './helpers'

describe('local export discriminator (source.format !== fig)', () => {
  test('local text inside auto-layout gets textAutoResize=HEIGHT on export', async () => {
    const graph = new SceneGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'AutoLayout',
      layoutMode: 'HORIZONTAL',
      width: 200,
      height: 40
    })
    graph.createNode('TEXT', frame.id, {
      text: 'Hello',
      width: 100,
      height: 24
    })

    const bytes = await exportFigFile(graph)
    const parsed = await parseFigFile(bytes.buffer as ArrayBuffer)

    const parsedText = [...parsed.getAllNodes()].find((n) => n.type === 'TEXT')
    expect(parsedText).toBeDefined()
    // resolveTextAutoResize must force HEIGHT for local text inside auto-layout.
    // Before the fix, `if (node.source.id)` was always true (after
    // migrateLegacySourceIds), so local text never got HEIGHT.
    expect(parsedText?.textAutoResize).toBe('HEIGHT')
  })

  test('local text outside auto-layout preserves original textAutoResize', async () => {
    const graph = new SceneGraph()
    graph.createNode('TEXT', pageId(graph), {
      text: 'Hello',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      width: 100,
      height: 24
    })

    const bytes = await exportFigFile(graph)
    const parsed = await parseFigFile(bytes.buffer as ArrayBuffer)

    const parsedText = [...parsed.getAllNodes()].find((n) => n.type === 'TEXT')
    expect(parsedText?.textAutoResize).toBe('WIDTH_AND_HEIGHT')
  })

  test('local node with non-default miterLimit serializes miterLimit in kiwi output', () => {
    const graph = new SceneGraph()
    const rect = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'MiterRect',
      width: 100,
      height: 100,
      strokeMiterLimit: 10
    })

    const kiwiNodes = toKiwi(rect, graph)
    const rectNc = kiwiNodes.find((nc) => nc.name === 'MiterRect')
    expect(rectNc).toBeDefined()
    // Before the fix, `if (!node.source.id && ...)` was always false, so
    // local miter limits were never serialized.
    expect(rectNc?.miterLimit).toBe(10)
  })

  test('local node with default miterLimit serializes miterLimit (pre-PR behavior)', () => {
    const graph = new SceneGraph()
    const rect = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'DefaultMiterRect',
      width: 100,
      height: 100
    })

    const kiwiNodes = toKiwi(rect, graph)
    const rectNc = kiwiNodes.find((nc) => nc.name === 'DefaultMiterRect')
    expect(rectNc).toBeDefined()
    // Default strokeMiterLimit is 4, which is !== 28.96 (Figma's internal default),
    // so it WILL be serialized. This is the pre-PR behavior.
    expect(rectNc?.miterLimit).toBe(4)
  })

  test('local auto-layout direction roundtrips through export/parse', async () => {
    const graph = new SceneGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'RTL Row',
      layoutMode: 'HORIZONTAL',
      layoutDirection: 'RTL',
      width: 240,
      height: 80
    })
    graph.createNode('TEXT', frame.id, {
      text: 'test',
      textDirection: 'RTL',
      width: 120,
      height: 24
    })

    const bytes = await exportFigFile(graph)
    const parsed = await parseFigFile(bytes.buffer as ArrayBuffer)

    const parsedFrame = [...parsed.getAllNodes()].find((n) => n.name === 'RTL Row')
    const parsedText = [...parsed.getAllNodes()].find((n) => n.type === 'TEXT')
    expect(parsedFrame?.layoutDirection).toBe('RTL')
    expect(parsedText?.textDirection).toBe('RTL')
  })
})
