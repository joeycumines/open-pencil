import { describe, expect, test } from 'bun:test'

import type { NodeChange } from '@open-pencil/core'
import { importNodeChanges } from '@open-pencil/core/kiwi/fig/import'

import { guid, minimalDocumentTree } from '../helpers'

const TRANSFORM = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }

function sizedNode(
  id: number,
  parent: number,
  position: string,
  type: string,
  name: string,
  size = 100
): NodeChange {
  return {
    guid: guid(10, id),
    parentIndex: { guid: guid(10, parent), position },
    type,
    name,
    visible: true,
    opacity: 1,
    phase: 'CREATED',
    size: { x: size, y: size },
    transform: TRANSFORM
  }
}

function instanceNode(id: number, parent: number, position: string, name: string): NodeChange {
  return {
    ...sizedNode(id, parent, position, 'INSTANCE', name),
    symbolData: { symbolID: guid(10, 20) }
  }
}

describe('fig import duplicate GUID reference-safety', () => {
  test('remediated frame keeps its children, not the first occurrence', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
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
      {
        guid: { sessionID: 10, localID: 11 },
        parentIndex: { guid: { sessionID: 10, localID: 10 }, position: '"' },
        type: 'RECTANGLE',
        name: 'ChildA',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 10, y: 10 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
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

    const childrenOfA = graph.getChildren('10:10')
    expect(childrenOfA).toHaveLength(1)
    expect(childrenOfA[0].name).toBe('ChildA')

    const childrenOfB = graph.getChildren(frameBId as string)
    expect(childrenOfB).toHaveLength(1)
    expect(childrenOfB[0].name).toBe('ChildB')

    const childB = graph.getNode('10:12')
    expect(childB?.parentId).toBe(frameBId)
  })

  test('child before duplicate parent follows the nearest parent occurrence', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      sizedNode(10, 1, '!', 'FRAME', 'FrameA'),
      sizedNode(11, 10, '"', 'RECTANGLE', 'ChildA', 10),
      sizedNode(12, 10, '!', 'RECTANGLE', 'ChildB', 20),
      sizedNode(10, 1, '"', 'FRAME', 'FrameB', 200)
    ] as NodeChange[]

    const graph = importNodeChanges(changes)
    const frameBId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(frameBId).toBeDefined()

    expect(graph.getChildren('10:10').map((node) => node.name)).toEqual(['ChildA'])
    expect(graph.getChildren(frameBId as string).map((node) => node.name)).toEqual(['ChildB'])
    expect(graph.getNode('10:12')?.parentId).toBe(frameBId)
  })

  test('child immediately before duplicate parent prefers the following occurrence on ties', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      sizedNode(10, 1, '!', 'FRAME', 'FrameA'),
      sizedNode(12, 10, '!', 'RECTANGLE', 'ChildB', 20),
      sizedNode(10, 1, '"', 'FRAME', 'FrameB', 200)
    ] as NodeChange[]

    const graph = importNodeChanges(changes)
    const frameBId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(frameBId).toBeDefined()

    expect(graph.getChildren('10:10')).toHaveLength(0)
    expect(graph.getChildren(frameBId as string).map((node) => node.name)).toEqual(['ChildB'])
    expect(graph.getNode('10:12')?.parentId).toBe(frameBId)
  })

  test('child before duplicate parent stays previous when following children sort earlier', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      sizedNode(10, 1, '!', 'FRAME', 'FrameA'),
      sizedNode(12, 10, '"', 'RECTANGLE', 'TieChild', 20),
      sizedNode(10, 1, '"', 'FRAME', 'FrameB', 200),
      sizedNode(13, 10, '#', 'RECTANGLE', 'LaterHigh', 20),
      sizedNode(14, 10, '!', 'RECTANGLE', 'LaterLow', 20)
    ] as NodeChange[]

    const graph = importNodeChanges(changes)
    const frameBId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(frameBId).toBeDefined()

    expect(graph.getChildren('10:10').map((node) => node.name)).toEqual(['TieChild'])
    expect(graph.getChildren(frameBId as string).map((node) => node.name)).toEqual([
      'LaterLow',
      'LaterHigh'
    ])
    expect(graph.getNode('10:12')?.parentId).toBe('10:10')
  })

  test('removed following children do not block direct tie assignment', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      sizedNode(10, 1, '!', 'FRAME', 'FrameA'),
      sizedNode(12, 10, '"', 'RECTANGLE', 'TieChild', 20),
      sizedNode(10, 1, '"', 'FRAME', 'FrameB', 200),
      { ...sizedNode(13, 10, '!', 'RECTANGLE', 'RemovedLow', 20), phase: 'REMOVED' }
    ] as NodeChange[]

    const graph = importNodeChanges(changes)
    const frameBId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(frameBId).toBeDefined()

    expect(graph.getChildren('10:10')).toHaveLength(0)
    expect(graph.getChildren(frameBId as string).map((node) => node.name)).toEqual(['TieChild'])
    expect(graph.getNode('10:12')?.parentId).toBe(frameBId)
  })

  test('non-adjacent tie keeps child with the previous duplicate parent occurrence', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      sizedNode(10, 1, '!', 'FRAME', 'FrameA'),
      sizedNode(98, 1, '!!', 'RECTANGLE', 'BeforeSpacer'),
      sizedNode(12, 10, '!', 'RECTANGLE', 'TieChild', 20),
      sizedNode(99, 1, '#', 'RECTANGLE', 'AfterSpacer'),
      sizedNode(10, 1, '$', 'FRAME', 'FrameB', 200)
    ] as NodeChange[]

    const graph = importNodeChanges(changes)
    const frameBId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(frameBId).toBeDefined()

    expect(graph.getChildren('10:10').map((node) => node.name)).toEqual(['TieChild'])
    expect(graph.getChildren(frameBId as string)).toHaveLength(0)
    expect(graph.getNode('10:12')?.parentId).toBe('10:10')
  })

  test('instance after remediated component references the remediated component', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
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

    const inst1 = graph.getNode('10:21')
    expect(inst1?.type).toBe('INSTANCE')
    expect(inst1?.componentId).toBe('10:20')

    const inst2 = graph.getNode('10:22')
    expect(inst2?.type).toBe('INSTANCE')
    expect(inst2?.componentId).toBe(compBId)
  })

  test('instance reference follows sibling order when raw changes are not preorder', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
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
      },
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
      }
    ] as NodeChange[]

    const graph = importNodeChanges(changes)
    const compBId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(compBId).toBeDefined()

    const inst1 = graph.getNode('10:21')
    expect(inst1?.type).toBe('INSTANCE')
    expect(inst1?.componentId).toBe('10:20')

    const inst2 = graph.getNode('10:22')
    expect(inst2?.type).toBe('INSTANCE')
    expect(inst2?.componentId).toBe(compBId)
  })

  test('page instance follows remediated component nested in component set', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      {
        ...sizedNode(30, 1, '!', 'FRAME', 'Set'),
        componentPropDefs: [{ id: guid(10, 31), name: 'State', type: 'VARIANT' }]
      },
      sizedNode(20, 30, '!', 'SYMBOL', 'CompA'),
      instanceNode(22, 1, '"', 'InstB'),
      sizedNode(20, 30, '"', 'SYMBOL', 'CompB')
    ] as NodeChange[]

    const graph = importNodeChanges(changes)
    const compBId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(compBId).toBeDefined()

    const set = graph.getNode('10:30')
    expect(set?.type).toBe('COMPONENT_SET')

    const compB = graph.getNode(compBId as string)
    expect(compB?.name).toBe('CompB')

    const inst = graph.getNode('10:22')
    expect(inst?.type).toBe('INSTANCE')
    expect(inst?.componentId).toBe(compBId)
  })

  test('variable after remediated collection references the remediated collection', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
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

    const varA = graph.variables.get('10:102')
    expect(varA).toBeDefined()
    expect(varA?.collectionId).toBe('10:100')

    const varB = graph.variables.get('10:104')
    expect(varB).toBeDefined()
    expect(varB?.collectionId).toBe(remediatedId)
  })

  test('symbol override guid paths follow remediated component children', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      {
        guid: guid(10, 20),
        parentIndex: { guid: guid(10, 1), position: '!' },
        type: 'SYMBOL',
        name: 'ComponentA',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 100, y: 100 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      {
        guid: guid(10, 30),
        parentIndex: { guid: guid(10, 20), position: '!' },
        type: 'RECTANGLE',
        name: 'ChildA',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 10, y: 10 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      {
        guid: guid(10, 20),
        parentIndex: { guid: guid(10, 1), position: '"' },
        type: 'SYMBOL',
        name: 'ComponentB',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 100, y: 100 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      {
        guid: guid(10, 30),
        parentIndex: { guid: guid(10, 20), position: '!' },
        type: 'RECTANGLE',
        name: 'ChildB',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 20, y: 20 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      {
        guid: guid(10, 40),
        parentIndex: { guid: guid(10, 1), position: '#' },
        type: 'INSTANCE',
        name: 'InstanceB',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        size: { x: 100, y: 100 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        symbolData: {
          symbolID: guid(10, 20),
          symbolOverrides: [{ guidPath: { guids: [guid(10, 30)] }, visible: false }]
        }
      }
    ] as NodeChange[]

    const graph = importNodeChanges(changes)
    const instance = graph.getNode('10:40')
    expect(instance?.type).toBe('INSTANCE')
    expect(instance?.componentId).toBe(graph.importDiagnostics?.reassignedGuids[0]?.assigned)

    const instanceChild = instance?.childIds[0] ? graph.getNode(instance.childIds[0]) : undefined
    expect(instanceChild?.name).toBe('ChildB')
    expect(instanceChild?.visible).toBe(false)
  })

  test('variable mode IDs follow remediated collection payloads', () => {
    const changes = [
      ...minimalDocumentTree(10, 0),
      {
        guid: guid(10, 100),
        parentIndex: { guid: guid(10, 1), position: '!' },
        type: 'VARIABLE_SET',
        name: 'CollectionA',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        variableSetModes: [{ id: guid(10, 101), name: 'Light' }],
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      {
        guid: guid(10, 100),
        parentIndex: { guid: guid(10, 1), position: '"' },
        type: 'VARIABLE_SET',
        name: 'CollectionB',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        variableSetModes: [{ id: guid(10, 100), name: 'Dark' }],
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      {
        guid: guid(10, 104),
        parentIndex: { guid: guid(10, 100), position: '!' },
        type: 'VARIABLE',
        name: 'VarB',
        visible: true,
        opacity: 1,
        phase: 'CREATED',
        variableSetID: { guid: guid(10, 100) },
        variableResolvedType: 'FLOAT',
        variableDataValues: {
          entries: [
            {
              modeID: guid(10, 100),
              variableData: {
                value: { floatValue: 7 },
                dataType: 'FLOAT',
                resolvedDataType: 'FLOAT'
              }
            }
          ]
        },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      }
    ] as NodeChange[]

    const graph = importNodeChanges(changes)
    const remediatedCollectionId = graph.importDiagnostics?.reassignedGuids[0]?.assigned
    expect(remediatedCollectionId).toBeDefined()

    const collection = graph.variableCollections.get(remediatedCollectionId as string)
    expect(collection?.modes.map((mode) => mode.modeId)).toEqual([remediatedCollectionId])

    const variable = graph.variables.get('10:104')
    expect(variable?.collectionId).toBe(remediatedCollectionId)
    expect(variable?.valuesByMode).toEqual({ [remediatedCollectionId as string]: 7 })
  })
})
