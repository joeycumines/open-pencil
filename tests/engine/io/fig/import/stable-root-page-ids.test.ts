import { describe, expect, test } from 'bun:test'

import type { NodeChange } from '@open-pencil/core'
import { importNodeChanges } from '@open-pencil/core/kiwi/fig/import'

function makeMinimalFig(sessionID: number, localIDOffset = 0): NodeChange[] {
  return [
    {
      guid: { sessionID, localID: localIDOffset },
      type: 'DOCUMENT',
      name: 'Document',
      visible: true,
      opacity: 1,
      phase: 'CREATED',
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    },
    {
      guid: { sessionID, localID: localIDOffset + 1 },
      parentIndex: {
        guid: { sessionID, localID: localIDOffset },
        position: '!'
      },
      type: 'CANVAS',
      name: 'Page A',
      visible: true,
      opacity: 1,
      phase: 'CREATED',
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    },
    {
      guid: { sessionID, localID: localIDOffset + 2 },
      parentIndex: {
        guid: { sessionID, localID: localIDOffset },
        position: '"'
      },
      type: 'CANVAS',
      name: 'Page B',
      visible: true,
      opacity: 1,
      phase: 'CREATED',
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    },
    {
      guid: { sessionID, localID: localIDOffset + 10 },
      parentIndex: {
        guid: { sessionID, localID: localIDOffset + 1 },
        position: '!'
      },
      type: 'RECTANGLE',
      name: 'Box',
      visible: true,
      opacity: 1,
      phase: 'CREATED',
      size: { x: 100, y: 100 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    }
  ] as NodeChange[]
}

describe('fig import stable root and page ids', () => {
  test('two imports of the same .fig produce identical rootId and page IDs', () => {
    const first = importNodeChanges(makeMinimalFig(20, 100))
    const second = importNodeChanges(makeMinimalFig(20, 100))

    expect(first.rootId).toBe('20:100')
    expect(second.rootId).toBe('20:100')
    expect(first.documentGuid).toBe('20:100')
    expect(second.documentGuid).toBe('20:100')

    const firstPages = first.getPages().map((p) => ({ id: p.id, name: p.name }))
    const secondPages = second.getPages().map((p) => ({ id: p.id, name: p.name }))

    expect(firstPages).toEqual([
      { id: '20:101', name: 'Page A' },
      { id: '20:102', name: 'Page B' }
    ])
    expect(secondPages).toEqual(firstPages)
  })

  test('documents preserve imported root format and source id', () => {
    const graph = importNodeChanges(makeMinimalFig(42, 0))
    const root = graph.getNode(graph.rootId)

    expect(root?.type).toBe('FRAME')
    expect(root?.source.format).toBe('fig')
    expect(root?.source.id).toBe('42:0')
  })

  test('pages preserve imported canvas source format and id', () => {
    const graph = importNodeChanges(makeMinimalFig(42, 0))
    const pages = graph.getPages()

    expect(pages[0]?.source.format).toBe('fig')
    expect(pages[0]?.source.id).toBe('42:1')
    expect(pages[1]?.source.format).toBe('fig')
    expect(pages[1]?.source.id).toBe('42:2')
  })

  test('import without a DOCUMENT node falls back to generated root id', () => {
    const changes = makeMinimalFig(20, 100).filter((nc) => nc.type !== 'DOCUMENT')
    const graph = importNodeChanges(changes as NodeChange[])

    expect(graph.rootId).not.toBe('20:100')
    expect(graph.documentGuid).not.toBe('20:100')
  })
})
