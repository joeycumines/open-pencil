import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

/**
 * C-07: pickRuntimeId third branch doesn't check variables/collections/modes.
 *
 * The third branch of pickRuntimeId (default mode, no existing node, not
 * reserved) returns the requested runtime ID without checking if it collides
 * with a variable ID, collection ID, or mode ID. Unlike generateNodeId which
 * checks all five namespaces, this branch only checks nodes and reservedRuntimeIds.
 *
 * How it fails: A caller passing an ID that matches a variable ID gets a
 * namespace collision — the node and variable share the same ID string.
 *
 * Fix that makes it pass: Add `!this.host.variables.has(requestedRuntimeId) &&
 * !this.host.variableCollections.has(requestedRuntimeId) && !this.hasModeId(requestedRuntimeId)`
 * to the third branch condition.
 */
describe('C-07: pickRuntimeId namespace collision with variables', () => {
  test('createNode with ID matching a variable ID should not collide', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    // Create a variable — it gets a runtime ID from generateNodeId
    const collection = graph.createCollection('Colors')
    const variable = graph.createVariable('Primary', 'COLOR', collection.id)

    const variableId = variable.id
    expect(variableId).toBeTruthy()

    // Now try to create a node with the SAME ID as the variable
    // pickRuntimeId should reject this collision, but the third branch
    // only checks nodes and reservedRuntimeIds — not variables
    const node = graph.createNode('RECTANGLE', page, {
      id: variableId,
      name: 'Box'
    })

    // The node should NOT have the same ID as the variable
    // FAILS: node.id === variableId (namespace collision)
    expect(node.id).not.toBe(variableId)
  })

  test('createNode with ID matching a collection ID should not collide', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const collection = graph.createCollection('Colors')
    const collectionId = collection.id

    // Try to create a node with the same ID as the collection
    const node = graph.createNode('RECTANGLE', page, {
      id: collectionId,
      name: 'Box'
    })

    // FAILS: node.id === collectionId (namespace collision)
    expect(node.id).not.toBe(collectionId)
  })
})
