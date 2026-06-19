import { describe, expect, test } from 'bun:test'

import type { NodeChange } from '@open-pencil/core'
import { importNodeChanges } from '@open-pencil/core/kiwi/fig/import'

import { minimalDocumentTree } from './helpers'

describe('fig import duplicate GUID reference-safety', () => {
  test('remediated frame keeps its children, not the first occurrence', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      // Frame A (first occurrence, keeps GUID 10:10)
      {
        guid: { sessionID: 10, localID: 10 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '!' },
        type: 'FRAME',
        name: 'FrameA',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 100, y: 100 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      // Child of Frame A
      {
        guid: { sessionID: 10, localID: 11 },
        parentIndex: { guid: { sessionID: 10, localID: 10 }, position: '!' },
        type: 'RECTANGLE',
        name: 'ChildA',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 10, y: 10 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      // Frame B (duplicate GUID 10:10, gets remediated to synthetic)
      {
        guid: { sessionID: 10, localID: 10 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '"' },
        type: 'FRAME',
        name: 'FrameB',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 200, y: 200 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      // Child of Frame B — parentIndex points to 10:10 (the duplicate)
      {
        guid: { sessionID: 10, localID: 12 },
        parentIndex: { guid: { sessionID: 10, localID: 10 }, position: '!' },
        type: 'RECTANGLE',
        name: 'ChildB',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 20, y: 20 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      }
    ] as NodeChange[]

    const graph = importNodeChanges(changes)

    const frameA = graph.getNode('10:10')
    const frameBId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(frameA?.name).toBe('FrameA')
    expect(frameBId).toBeDefined()
    const frameB = graph.getNode(frameBId as string)
    expect(frameB?.name).toBe('FrameB')

    // Frame A should have ChildA as its child, not ChildB
    const childrenOfA = graph.getChildren('10:10')
    expect(childrenOfA).toHaveLength(1)
    expect(childrenOfA[0].name).toBe('ChildA')

    // Frame B should have ChildB as its child, not ChildA
    const childrenOfB = graph.getChildren(frameBId as string)
    expect(childrenOfB).toHaveLength(1)
    expect(childrenOfB[0].name).toBe('ChildB')

    // ChildB's parent should be FrameB, not FrameA
    const childB = graph.getNode('10:12')
    expect(childB?.parentId).toBe(frameBId)
  })

  test('instance after remediated component references the remediated component', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      // Component A (first occurrence, type SYMBOL, keeps GUID 10:20)
      {
        guid: { sessionID: 10, localID: 20 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '!' },
        type: 'SYMBOL',
        name: 'CompA',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 100, y: 100 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      // Instance I1 — references CompA via symbolData.symbolID = 10:20
      {
        guid: { sessionID: 10, localID: 21 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '"' },
        type: 'INSTANCE',
        name: 'Inst1',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 100, y: 100 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        symbolData: { symbolID: { sessionID: 10, localID: 20 } }
      },
      // Component B (duplicate GUID 10:20, gets remediated)
      {
        guid: { sessionID: 10, localID: 20 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '#' },
        type: 'SYMBOL',
        name: 'CompB',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 200, y: 200 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      // Instance I2 — references the duplicate GUID 10:20 via symbolData.symbolID
      // Should be remapped to the remediated component B
      {
        guid: { sessionID: 10, localID: 22 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '$' },
        type: 'INSTANCE',
        name: 'Inst2',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 200, y: 200 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        symbolData: { symbolID: { sessionID: 10, localID: 20 } }
      }
    ] as NodeChange[]

    const graph = importNodeChanges(changes)

    const compA = graph.getNode('10:20')
    expect(compA?.name).toBe('CompA')

    const compBId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(compBId).toBeDefined()
    const compB = graph.getNode(compBId as string)
    expect(compB?.name).toBe('CompB')

    // Instance I1 should reference CompA (10:20)
    const inst1 = graph.getNode('10:21')
    expect(inst1?.type).toBe('INSTANCE')
    expect(inst1?.componentId).toBe('10:20')

    // Instance I2 should reference the remediated CompB
    const inst2 = graph.getNode('10:22')
    expect(inst2?.type).toBe('INSTANCE')
    expect(inst2?.componentId).toBe(compBId)
  })

  test('variable after remediated collection references the remediated collection', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      // VariableSet A (first occurrence, keeps GUID 10:100)
      {
        guid: { sessionID: 10, localID: 100 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '!' },
        type: 'VARIABLE_SET',
        name: 'CollectionA',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        variableSetModes: [{ id: { sessionID: 10, localID: 101 }, name: 'Light' }],
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      // Variable V1 — references CollectionA via variableSetID.guid = 10:100
      {
        guid: { sessionID: 10, localID: 102 },
        parentIndex: { guid: { sessionID: 10, localID: 100 }, position: '!' },
        type: 'VARIABLE',
        name: 'VarA',
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
                value: { colorValue: { r: 1, g: 0, b: 0, a: 1 } },
                dataType: 'COLOR',
                resolvedDataType: 'COLOR'
              }
            }
          ]
        },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      // VariableSet B (duplicate GUID 10:100, gets remediated)
      {
        guid: { sessionID: 10, localID: 100 },
        parentIndex: { guid: { sessionID: 10, localID: 1 }, position: '"' },
        type: 'VARIABLE_SET',
        name: 'CollectionB',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        variableSetModes: [{ id: { sessionID: 10, localID: 103 }, name: 'Dark' }],
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      // Variable V2 — references the duplicate GUID 10:100 via variableSetID.guid
      // Should be remapped to the remediated CollectionB
      {
        guid: { sessionID: 10, localID: 104 },
        parentIndex: { guid: { sessionID: 10, localID: 100 }, position: '!' },
        type: 'VARIABLE',
        name: 'VarB',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        variableSetID: { guid: { sessionID: 10, localID: 100 } },
        variableResolvedType: 'COLOR',
        variableDataValues: {
          entries: [
            {
              modeID: { sessionID: 10, localID: 103 },
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

    const collectionA = graph.variableCollections.get('10:100')
    expect(collectionA?.name).toBe('CollectionA')

    const remediatedId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(remediatedId).toBeDefined()
    const collectionB = graph.variableCollections.get(remediatedId as string)
    expect(collectionB?.name).toBe('CollectionB')

    // Variable V1 should be in CollectionA
    const varA = graph.variables.get('10:102')
    expect(varA).toBeDefined()
    expect(varA?.collectionId).toBe('10:100')

    // Variable V2 should be in the remediated CollectionB
    const varB = graph.variables.get('10:104')
    expect(varB).toBeDefined()
    expect(varB?.collectionId).toBe(remediatedId)
  })
})
