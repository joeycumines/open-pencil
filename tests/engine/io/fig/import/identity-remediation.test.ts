import { describe, expect, test } from 'bun:test'

import type { NodeChange } from '@open-pencil/core'
import { importNodeChanges } from '@open-pencil/core/kiwi/fig/import'

function buildDocumentTree(): NodeChange[] {
  return [
    {
      guid: { sessionID: 10, localID: 0 },
      type: 'DOCUMENT',
      name: 'Document',
      visible: true,
      opacity: 1,
      phase: 'CREATED',
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    },
    {
      guid: { sessionID: 10, localID: 1 },
      parentIndex: { guid: { sessionID: 10, localID: 0 }, position: '!' },
      type: 'CANVAS',
      name: 'Page',
      visible: true,
      opacity: 1,
      phase: 'CREATED',
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    }
  ]
}

describe('fig import identity remediation (KC-005)', () => {
  test('detects and reassigns duplicate node GUIDs', () => {
    const changes = [
      ...buildDocumentTree(),
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

    expect(graph.getNode('10:10')?.name).toBe('First')
    expect(graph.getNode('1:1')?.name).toBe('Second')
    expect(graph.getNode('10:10')?.source.id).toBe('10:10')
    expect(graph.getNode('1:1')?.source.id).toBe('1:1')

    const page = graph.getPages()[0]
    const children = graph.getChildren(page.id)
    expect(children).toHaveLength(2)
  })

  test('detects and remediates missing node GUIDs', () => {
    const changes = [
      ...buildDocumentTree(),
      {
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '!' },
        type: 'RECTANGLE',
        name: 'MissingGuidRect',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 10, y: 10 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      } as NodeChange
    ]

    const graph = importNodeChanges(changes)

    expect(graph.importDiagnostics?.missingGuidCount).toBe(1)
    const remediation = graph.importDiagnostics?.reassignedGuids.find((r) => r.original === null)
    expect(remediation).toBeDefined()
    const assigned = remediation?.assigned ?? ''
    expect(assigned).toMatch(/^1:\d+$/)

    const rect = graph.getNode(assigned)
    expect(rect?.name).toBe('MissingGuidRect')
    expect(rect?.source.id).toBe(assigned)
  })

  test('counts duplicate GUIDs across more than two occurrences', () => {
    const changes = [
      ...buildDocumentTree(),
      ...(['A', 'B', 'C'] as const).map(
        (name, index) =>
          ({
            guid: { sessionID: 10, localID: 20 },
            parentIndex: {
              guid: { sessionID: 10, localID: 1 },
              position: String.fromCharCode(33 + index)
            },
            type: 'RECTANGLE',
            name,
            visible: true,
            opacity: 1,
            phase: 'CREATED',
            size: { x: 10, y: 10 },
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
          }) satisfies NodeChange
      )
    ] as NodeChange[]

    const graph = importNodeChanges(changes)

    expect(graph.importDiagnostics?.duplicateGuids).toEqual([{ guid: '10:20', count: 3 }])
    expect(graph.importDiagnostics?.reassignedGuids).toHaveLength(2)

    expect(graph.getNode('10:20')?.name).toBe('A')
    const syntheticIds = new Set(graph.importDiagnostics?.reassignedGuids.map((r) => r.assigned))
    expect(syntheticIds.size).toBe(2)
  })

  test('remediation IDs are deterministic and do not collide with imported IDs', () => {
    const changes = [
      ...buildDocumentTree(),
      {
        guid: { sessionID: 1, localID: 1 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '!' },
        type: 'RECTANGLE',
        name: 'Imported1:1',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 10, y: 10 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      {
        guid: { sessionID: 1, localID: 1 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '"' },
        type: 'RECTANGLE',
        name: 'Imported1:1Dup',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 10, y: 10 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      {
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '#' },
        type: 'RECTANGLE',
        name: 'MissingGuidRect',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 10, y: 10 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      } as NodeChange
    ] as NodeChange[]

    const graph = importNodeChanges(changes)

    // The duplicate of 1:1 must skip 1:1 (reserved imported id).
    // The missing GUID rect must skip both 1:1 and the synthetic assigned to the duplicate.
    const duplicate = graph.importDiagnostics?.reassignedGuids.find((r) => r.original === '1:1')
    const missing = graph.importDiagnostics?.reassignedGuids.find((r) => r.original === null)

    expect(duplicate?.assigned).not.toBe('1:1')
    expect(missing?.assigned).not.toBe('1:1')
    expect(missing?.assigned).not.toBe(duplicate?.assigned)

    expect(graph.getNode('1:1')?.name).toBe('Imported1:1')
    expect(graph.getNode(duplicate?.assigned ?? '')?.name).toBe('Imported1:1Dup')
    expect(graph.getNode(missing?.assigned ?? '')?.name).toBe('MissingGuidRect')

    const assignedIds = new Set(graph.importDiagnostics?.reassignedGuids.map((r) => r.assigned))
    expect(assignedIds.size).toBe(graph.importDiagnostics?.reassignedGuids.length)
  })

  test('imports variables and collections with stable source ids', () => {
    const changes = [
      ...buildDocumentTree(),
      {
        guid: { sessionID: 10, localID: 100 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '!' },
        type: 'VARIABLE_SET',
        name: 'Tokens',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        variableSetModes: [{ id: { sessionID: 10, localID: 101 }, name: 'Light' }],
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      {
        guid: { sessionID: 10, localID: 102 },
        parentIndex: { guid: { sessionID: 10, localID: 100 }, position: '!' },
        type: 'VARIABLE',
        name: 'Primary',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        variableSetID: { guid: { sessionID: 10, localID: 100 } },
        variableResolvedType: 'COLOR',
        variableDataValues: {
          entries: [
            {
              modeID: { sessionID: 10, localID: 101 },
              variableData: {
                value: { colorValue: { r: 0, g: 0, b: 1, a: 1 } },
                dataType: 'COLOR',
                resolvedDataType: 'COLOR'
              }
            }
          ]
        },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      }
    ] as NodeChange[]

    const graph = importNodeChanges(changes)

    const collection = graph.variableCollections.get('10:100')
    expect(collection).toBeDefined()
    expect(collection?.source?.id).toBe('10:100')
    expect(collection?.modes[0].source?.id).toBe('10:101')

    const variable = graph.variables.get('10:102')
    expect(variable).toBeDefined()
    expect(variable?.source?.id).toBe('10:102')
    expect(variable?.collectionId).toBe('10:100')
  })
})
