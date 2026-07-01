import { describe, expect, test } from 'bun:test'

import type { NodeChange } from '@open-pencil/core'
import { importNodeChanges } from '@open-pencil/core/kiwi/fig/import'

import { getNodeOrThrow } from '#tests/helpers/assert'

import { minimalDocumentTree } from '../helpers'

describe('fig import duplicate GUID remediation', () => {
  test('reports duplicate GUIDs and gives reassigned nodes a defined parent', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      {
        guid: { sessionID: 10, localID: 10 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '!' },
        type: 'RECTANGLE',
        name: 'First',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 10, y: 10 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      {
        guid: { sessionID: 10, localID: 10 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '"' },
        type: 'RECTANGLE',
        name: 'Second',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 20, y: 20 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      }
    ] as NodeChange[]

    const graph = importNodeChanges(changes)

    expect(graph.importDiagnostics?.duplicateGuids).toEqual([{ guid: '10:10', count: 2 }])
    expect(graph.importDiagnostics?.reassignedGuids).toEqual([
      { original: '10:10', assigned: '1:1' }
    ])

    const first = getNodeOrThrow(graph, '10:10')
    const secondId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(secondId).toBeDefined()

    const second = getNodeOrThrow(graph, secondId as string)

    expect(first.name).toBe('First')
    expect(second.name).toBe('Second')
    expect(first.parentId).toBeDefined()
    expect(second.parentId).toBeDefined()
    expect(graph.getChildren(first.parentId as string)).toHaveLength(2)
  })
})
