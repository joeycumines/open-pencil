import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

/**
 * C-04: Variable bindings silently stripped when fills/strokes are updated.
 *
 * removeStaleBindings in node/tree.ts marks whole-array bindings (e.g.,
 * boundVariables.fills) as stale when the fills array is updated. This
 * means when a collab sync brings an updated fills array, the variable
 * binding is stripped even though it should be preserved.
 *
 * How it fails: A node with boundVariables.fills = 'var-id' has its fills
 * updated via updateNode. removeStaleBindings sees `k === 'fills'` and
 * returns true (stale), stripping the binding. The binding is lost.
 *
 * Fix that makes it pass: Change `if (k === field) return true` to
 * `if (k === field) return false` — whole-array bindings should NOT be
 * stripped when the array is updated. Only out-of-range indexed bindings
 * (e.g., fills/5 when there are only 3 fills) should be stripped.
 */
describe('C-04: Variable bindings stripped on fills update', () => {
  test('whole-array fills binding is preserved when fills are updated', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    // Create a variable
    const collection = graph.createCollection('Colors')
    const variable = graph.createVariable('Primary', 'COLOR', collection.id)

    // Create a node with a bound fills variable
    const node = graph.createNode('RECTANGLE', page, {
      name: 'Box',
      width: 100,
      height: 100,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ],
      boundVariables: { fills: variable.id }
    })

    expect(node.boundVariables.fills).toBe(variable.id)

    // Update fills (simulating a collab sync bringing updated fills)
    graph.updateNode(node.id, {
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 1, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ]
    })

    // The whole-array binding should be preserved
    // FAILS: removeStaleBindings stripped it because k === 'fills' returns true
    const updated = graph.getNode(node.id)!
    expect(updated.boundVariables.fills).toBe(variable.id)
  })

  test('out-of-range indexed binding IS stripped when fills shrink', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const collection = graph.createCollection('Colors')
    const variable = graph.createVariable('Primary', 'COLOR', collection.id)

    // Create a node with 3 fills and an indexed binding at index 2
    const node = graph.createNode('RECTANGLE', page, {
      name: 'Box',
      width: 100,
      height: 100,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        },
        {
          type: 'SOLID',
          color: { r: 0, g: 1, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        },
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 1, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ],
      boundVariables: { 'fills/2': variable.id }
    })

    // Shrink fills to 2 — index 2 is now out of range
    graph.updateNode(node.id, {
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        },
        {
          type: 'SOLID',
          color: { r: 0, g: 1, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ]
    })

    // Out-of-range indexed binding SHOULD be stripped (correct behavior)
    const updated = graph.getNode(node.id)!
    expect(updated.boundVariables['fills/2']).toBeUndefined()
  })
})
