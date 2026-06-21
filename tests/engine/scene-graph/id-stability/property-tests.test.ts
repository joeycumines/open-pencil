import { describe, expect, test } from 'bun:test'

import * as fc from 'fast-check'

import { SceneGraph } from '@open-pencil/core'
import type { NodeType } from '@open-pencil/core'

/**
 * Property-based tests for the identity system.
 * These tests generate random operation sequences and verify invariants
 * that must hold for any valid sequence of operations.
 */

const NODE_TYPES: NodeType[] = ['RECTANGLE', 'ELLIPSE', 'FRAME', 'TEXT']

describe('property-based identity tests', () => {
  test('all stable IDs are unique after random create sequences', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constantFrom(...NODE_TYPES),
            x: fc.integer({ min: 0, max: 1000 }),
            y: fc.integer({ min: 0, max: 1000 })
          }),
          { maxLength: 50 }
        ),
        (nodes) => {
          const graph = new SceneGraph()
          const page = graph.getPages()[0]

          for (const { type, x, y } of nodes) {
            graph.createNode(type, page.id, {
              name: 'Node',
              x,
              y,
              width: 100,
              height: 100
            })
          }

          const stableIds = [...graph.getAllNodes()].map((n) => graph.getStableId(n))
          const uniqueIds = new Set(stableIds)
          expect(stableIds.length).toBe(uniqueIds.size)
        }
      ),
      { numRuns: 100 }
    )
  })

  test('pickRuntimeId restore mode preserves the original stable ID when the slot is free', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes(':')),
        (stableId) => {
          const graph = new SceneGraph()
          const page = graph.getPages()[0]

          const node = graph.createNode('RECTANGLE', page.id, {
            name: 'Test',
            width: 100,
            height: 100,
            source: {
              id: stableId,
              format: null,
              orderKey: null,
              fig: {
                rawSize: null,
                rawTransform: null,
                rawNodeFields: {},
                layout: null,
                symbolOverrides: [],
                componentPropAssignments: [],
                derivedSymbolData: [],
                derivedSymbolDataLayoutVersion: null,
                uniformScaleFactor: null
              }
            }
          })

          const originalStableId = graph.getStableId(node)

          graph.deleteNode(node.id, { permanent: false })

          const restored = graph.createNode(
            'RECTANGLE',
            page.id,
            {
              name: 'Restored',
              width: 100,
              height: 100,
              source: {
                id: stableId,
                format: null,
                orderKey: null,
                fig: {
                  rawSize: null,
                  rawTransform: null,
                  rawNodeFields: {},
                  layout: null,
                  symbolOverrides: [],
                  componentPropAssignments: [],
                  derivedSymbolData: [],
                  derivedSymbolDataLayoutVersion: null,
                  uniformScaleFactor: null
                }
              }
            },
            { mode: 'restore' }
          )

          expect(graph.getStableId(restored)).toBe(originalStableId)
        }
      ),
      { numRuns: 50 }
    )
  })

  test('generateNodeId never returns an ID colliding with variables or collections', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 5 }),
        (varNames) => {
          const graph = new SceneGraph()
          const collection = graph.createCollection('Test')

          for (const name of varNames) {
            graph.createVariable(name, 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 })
          }

          for (let i = 0; i < 100; i++) {
            const id = graph.generateNodeId()
            expect(graph.variables.has(id)).toBe(false)
            expect(graph.variableCollections.has(id)).toBe(false)
          }
        }
      ),
      { numRuns: 20 }
    )
  })

  test('override keys use stable IDs that resolve to instance children', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (numChildren) => {
        const graph = new SceneGraph()
        const page = graph.getPages()[0]

        const component = graph.createNode('COMPONENT', page.id, {
          name: 'Component',
          width: 200,
          height: 200
        })

        for (let i = 0; i < numChildren; i++) {
          graph.createNode('RECTANGLE', component.id, {
            name: `Child ${i}`,
            width: 50,
            height: 50,
            x: i * 50,
            y: 0
          })
        }

        const instance = graph.createNode('INSTANCE', page.id, {
          name: 'Instance',
          width: 200,
          height: 200,
          componentId: component.id,
          x: 300,
          y: 0
        })
        graph.populateInstanceChildren(instance.id, component.id)

        // Each instance child should have a stable ID that resolves via the index
        const instanceChildren = graph.getChildren(instance.id)
        for (const child of instanceChildren) {
          const stableId = graph.getStableId(child)
          const runtimeId = graph.identity.stableIdToRuntimeId(stableId)
          expect(runtimeId).toBeDefined()
          const resolvedNode = graph.getNode(runtimeId as string)
          expect(resolvedNode).toBeDefined()
        }
      }),
      { numRuns: 20 }
    )
  })
})
