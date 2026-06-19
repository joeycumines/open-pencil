import { describe, expect, test } from 'bun:test'

import type { NodeChange } from '@open-pencil/core'
import { importNodeChanges } from '@open-pencil/core/kiwi/fig/import'

import { getNodeOrThrow } from '#tests/helpers/assert'

import { minimalDocumentTree } from './helpers'

describe('fig import missing GUID remediation', () => {
  test('counts missing GUIDs and assigns reassigned nodes a defined parent', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
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

    const assigned = remediation?.assigned
    expect(assigned).toMatch(/^1:\d+$/)

    const rect = getNodeOrThrow(graph, assigned as string)
    expect(rect.name).toBe('MissingGuidRect')
    expect(rect.parentId).toBeDefined()
    expect(graph.getChildren(rect.parentId as string)).toHaveLength(1)
  })
})
