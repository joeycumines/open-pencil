import { describe, expect, test } from 'bun:test'

import { importNodeChanges } from '@open-pencil/core'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

import { canvas, doc, node } from './legacy/helpers'

function pointGeometry(x: number, y: number): Uint8Array {
  const bytes = new Uint8Array(9)
  bytes[0] = 1
  const view = new DataView(bytes.buffer)
  view.setFloat32(1, x, true)
  view.setFloat32(5, y, true)
  return bytes
}

describe('fig import scaled instance strokes', () => {
  test('preserves scaled child position after final override replay', () => {
    const componentGuid = { sessionID: 1, localID: 1 }
    const childGuid = { sessionID: 1, localID: 2 }
    const childOverrideKey = { sessionID: 99, localID: 2 }

    const graph = importNodeChanges(
      [
        doc(),
        canvas(),
        node('SYMBOL', 1, 1, {
          guid: componentGuid,
          size: { x: 100, y: 100 }
        } as Partial<NodeChange>),
        node('RECTANGLE', 2, 1, {
          guid: childGuid,
          overrideKey: childOverrideKey,
          parentIndex: { guid: componentGuid, position: '!' },
          size: { x: 10, y: 10 },
          transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 30 },
          horizontalConstraint: 'SCALE',
          verticalConstraint: 'SCALE'
        } as Partial<NodeChange>),
        node('INSTANCE', 3, 1, {
          size: { x: 200, y: 200 },
          symbolData: {
            symbolID: componentGuid,
            symbolOverrides: [
              {
                guidPath: { guids: [childOverrideKey] },
                size: { x: 15, y: 25 }
              }
            ]
          }
        } as Partial<NodeChange>)
      ],
      [],
      undefined,
      { populate: 'all' }
    )

    const instance = Array.from(graph.getAllNodes()).find(
      (sceneNode) => sceneNode.name === 'INSTANCE_3'
    )
    const component = Array.from(graph.getAllNodes()).find(
      (sceneNode) => sceneNode.name === 'SYMBOL_1'
    )
    const sourceChild = component?.childIds.map((id) => graph.getNode(id)).find(Boolean)
    const child = instance?.childIds.map((id) => graph.getNode(id)).find(Boolean)

    expect(component).toMatchObject({ width: 100, height: 100 })
    expect(sourceChild).toMatchObject({ x: 20, y: 30, width: 10, height: 10 })
    expect(instance).toMatchObject({ width: 200, height: 200 })
    expect(child).toMatchObject({ x: 40, y: 60, width: 15, height: 25 })
  })

  test('scales lazy descendants created by final component-property swaps', () => {
    const leafGuid = { sessionID: 2, localID: 1 }
    const leafChildGuid = { sessionID: 2, localID: 2 }
    const leafChildOverrideKey = { sessionID: 99, localID: 2 }
    const originalGuid = { sessionID: 2, localID: 3 }
    const replacementGuid = { sessionID: 2, localID: 4 }
    const replacementNestedGuid = { sessionID: 2, localID: 5 }
    const replacementNestedOverrideKey = { sessionID: 99, localID: 5 }
    const containerGuid = { sessionID: 2, localID: 6 }
    const swapTargetGuid = { sessionID: 2, localID: 7 }
    const swapPropertyGuid = { sessionID: 2, localID: 8 }

    const graph = importNodeChanges(
      [
        doc(),
        canvas(),
        node('SYMBOL', 10, 1, {
          guid: leafGuid,
          size: { x: 100, y: 100 }
        } as Partial<NodeChange>),
        node('RECTANGLE', 11, 1, {
          guid: leafChildGuid,
          overrideKey: leafChildOverrideKey,
          parentIndex: { guid: leafGuid, position: '!' },
          size: { x: 10, y: 10 },
          transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 30 },
          horizontalConstraint: 'SCALE',
          verticalConstraint: 'SCALE'
        } as Partial<NodeChange>),
        node('SYMBOL', 12, 1, {
          guid: originalGuid,
          size: { x: 100, y: 100 }
        } as Partial<NodeChange>),
        node('SYMBOL', 13, 1, {
          guid: replacementGuid,
          size: { x: 100, y: 100 }
        } as Partial<NodeChange>),
        node('INSTANCE', 14, 1, {
          guid: replacementNestedGuid,
          overrideKey: replacementNestedOverrideKey,
          parentIndex: { guid: replacementGuid, position: '!' },
          size: { x: 200, y: 200 },
          symbolData: { symbolID: leafGuid }
        } as Partial<NodeChange>),
        node('SYMBOL', 15, 1, {
          guid: containerGuid,
          size: { x: 100, y: 100 },
          componentPropDefs: [
            {
              id: swapPropertyGuid,
              name: 'content',
              type: 'INSTANCE_SWAP',
              initialValue: { guidValue: originalGuid }
            }
          ]
        } as Partial<NodeChange>),
        node('INSTANCE', 16, 1, {
          guid: swapTargetGuid,
          parentIndex: { guid: containerGuid, position: '!' },
          size: { x: 100, y: 100 },
          symbolData: { symbolID: originalGuid },
          componentPropRefs: [
            {
              defID: swapPropertyGuid,
              componentPropNodeField: 'OVERRIDDEN_SYMBOL_ID'
            }
          ]
        } as Partial<NodeChange>),
        node('INSTANCE', 17, 1, {
          size: { x: 100, y: 100 },
          symbolData: {
            symbolID: containerGuid,
            symbolOverrides: [
              {
                guidPath: {
                  guids: [replacementNestedOverrideKey, leafChildOverrideKey]
                },
                size: { x: 15, y: 25 }
              }
            ]
          },
          componentPropAssignments: [
            {
              defID: swapPropertyGuid,
              value: { guidValue: replacementGuid }
            }
          ]
        } as Partial<NodeChange>)
      ],
      [],
      undefined,
      { populate: 'first-page' }
    )

    const replacement = Array.from(graph.getAllNodes()).find(
      (sceneNode) => sceneNode.name === 'SYMBOL_13'
    )
    const replacementNested = replacement?.childIds
      .map((id) => graph.getNode(id))
      .find((sceneNode) => sceneNode?.type === 'INSTANCE')
    const instance = Array.from(graph.getAllNodes()).find(
      (sceneNode) => sceneNode.name === 'INSTANCE_17'
    )
    const swapTarget = instance?.childIds
      .map((id) => graph.getNode(id))
      .find((sceneNode) => sceneNode?.type === 'INSTANCE')
    const nestedInstance = swapTarget?.childIds
      .map((id) => graph.getNode(id))
      .find((sceneNode) => sceneNode?.type === 'INSTANCE')
    const child = nestedInstance?.childIds.map((id) => graph.getNode(id)).find(Boolean)

    expect(swapTarget).toMatchObject({
      componentId: replacement?.id,
      width: 100,
      height: 100
    })
    expect(nestedInstance).toMatchObject({
      componentId: replacementNested?.id,
      width: 200,
      height: 200
    })
    expect(child).toMatchObject({ x: 40, y: 60, width: 15, height: 25 })
  })

  test('preserves vector stroke weight while scaling icon geometry', () => {
    const componentGuid = { sessionID: 1, localID: 10 }
    const vectorGuid = { sessionID: 1, localID: 11 }
    const instanceGuid = { sessionID: 1, localID: 20 }

    const graph = importNodeChanges(
      [
        doc(),
        canvas(),
        node('SYMBOL', 10, 1, {
          guid: componentGuid,
          size: { x: 24, y: 24 }
        } as Partial<NodeChange>),
        node('VECTOR', 11, 1, {
          guid: vectorGuid,
          parentIndex: { guid: componentGuid, position: '!' },
          size: { x: 12, y: 12 },
          horizontalConstraint: 'SCALE',
          verticalConstraint: 'SCALE',
          strokeWeight: 2,
          strokePaints: [
            {
              type: 'SOLID',
              color: { r: 0.2, g: 0.25, b: 0.33, a: 1 },
              opacity: 1,
              visible: true,
              blendMode: 'NORMAL'
            }
          ]
        } as Partial<NodeChange>),
        node('INSTANCE', 20, 1, {
          guid: instanceGuid,
          size: { x: 16, y: 16 },
          symbolData: { symbolID: componentGuid }
        } as Partial<NodeChange>)
      ],
      [],
      undefined,
      { populate: 'all' }
    )

    const instance = Array.from(graph.getAllNodes()).find(
      (sceneNode) => sceneNode.name === 'INSTANCE_20'
    )
    const vector = instance?.childIds.map((id) => graph.getNode(id)).find(Boolean)

    expect(vector?.strokes[0]?.weight).toBe(2)
    expect(vector?.strokes[0]?.color).toEqual({ r: 0.2, g: 0.25, b: 0.33, a: 1 })
  })

  test('does not scale explicit derived vector geometry twice', () => {
    const componentGuid = { sessionID: 1, localID: 21 }
    const vectorGuid = { sessionID: 1, localID: 22 }
    const graph = importNodeChanges(
      [
        doc(),
        canvas(),
        node('SYMBOL', 21, 1, {
          guid: componentGuid,
          size: { x: 24, y: 24 }
        } as Partial<NodeChange>),
        node('VECTOR', 22, 1, {
          guid: vectorGuid,
          parentIndex: { guid: componentGuid, position: '!' },
          size: { x: 12, y: 12 },
          horizontalConstraint: 'SCALE',
          verticalConstraint: 'SCALE',
          fillGeometry: [{ commandsBlob: 0, windingRule: 'NONZERO' }]
        } as Partial<NodeChange>),
        node('INSTANCE', 23, 1, {
          size: { x: 16, y: 16 },
          symbolData: { symbolID: componentGuid },
          derivedSymbolData: [
            {
              guidPath: { guids: [vectorGuid] },
              size: { x: 8, y: 8 },
              fillGeometry: [{ commandsBlob: 1, windingRule: 'NONZERO' }]
            }
          ]
        } as Partial<NodeChange>)
      ],
      [pointGeometry(12, 12), pointGeometry(6, 6)],
      undefined,
      { populate: 'all' }
    )

    const instance = Array.from(graph.getAllNodes()).find(
      (sceneNode) => sceneNode.name === 'INSTANCE_23'
    )
    const vector = instance?.childIds.map((id) => graph.getNode(id)).find(Boolean)
    const geometry = vector?.fillGeometry[0]?.commandsBlob
    expect(geometry).toBeDefined()
    const view = new DataView(
      geometry?.buffer ?? new ArrayBuffer(0),
      geometry?.byteOffset ?? 0,
      geometry?.byteLength ?? 0
    )
    expect(view.getFloat32(1, true)).toBe(6)
    expect(view.getFloat32(5, true)).toBe(6)
  })

  test('applies explicit instance stroke scale to scaled vectors', () => {
    const componentGuid = { sessionID: 1, localID: 30 }
    const vectorGuid = { sessionID: 1, localID: 31 }

    const graph = importNodeChanges(
      [
        doc(),
        canvas(),
        node('SYMBOL', 30, 1, {
          guid: componentGuid,
          size: { x: 24, y: 24 }
        } as Partial<NodeChange>),
        node('VECTOR', 31, 1, {
          guid: vectorGuid,
          parentIndex: { guid: componentGuid, position: '!' },
          size: { x: 4, y: 8 },
          horizontalConstraint: 'SCALE',
          verticalConstraint: 'SCALE',
          strokeWeight: 2,
          strokePaints: [
            {
              type: 'SOLID',
              color: { r: 0.2, g: 0.25, b: 0.33, a: 1 },
              opacity: 1,
              visible: true,
              blendMode: 'NORMAL'
            }
          ]
        } as Partial<NodeChange>),
        node('INSTANCE', 40, 1, {
          size: { x: 16, y: 16 },
          strokeWeight: 2 / 3,
          symbolData: { symbolID: componentGuid }
        } as Partial<NodeChange>)
      ],
      [],
      undefined,
      { populate: 'all' }
    )

    const instance = Array.from(graph.getAllNodes()).find(
      (sceneNode) => sceneNode.name === 'INSTANCE_40'
    )
    const vector = instance?.childIds.map((id) => graph.getNode(id)).find(Boolean)

    expect(vector?.strokes[0]?.weight).toBeCloseTo(4 / 3, 6)
  })
})
