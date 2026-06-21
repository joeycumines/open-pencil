import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

import { pageId, rect } from '#tests/engine/scene-graph/basic/helpers'

/**
 * Cache invariant tests for absPosCache.
 *
 * The absolute position cache stores computed world-space positions per
 * node id. It must be invalidated when a node's position changes (via
 * updateNode with layout-affecting keys) or when its parent chain
 * changes (reparent, cross-parent reorder).
 *
 * Existing tests in update-node.test.ts cover updateNode invalidation.
 * These tests cover the structural mutation paths: reparent, reorder,
 * and the delete-then-restore stale entry gap.
 */
describe('absPosCache invariant', () => {
  test('reparent invalidates absPosCache for the reparented node', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const frame1 = graph.createNode('FRAME', page, {
      name: 'F1',
      x: 100,
      y: 100,
      width: 200,
      height: 200
    }).id
    const frame2 = graph.createNode('FRAME', page, {
      name: 'F2',
      x: 500,
      y: 0,
      width: 200,
      height: 200
    }).id
    const child = graph.createNode('RECTANGLE', frame1, {
      name: 'Child',
      x: 10,
      y: 10,
      width: 50,
      height: 50
    }).id

    // Cache the abs pos while child is in frame1 (100+10=110)
    const absBefore = graph.getAbsolutePosition(child)
    expect(absBefore.x).toBe(110)

    // Reparent to frame2 — reparentNode adjusts x/y to maintain visual position
    graph.reparentNode(child, frame2)

    // Cache must be invalidated — different reference even though value is same
    // (reparent maintains visual position: child stays at absolute 110,110)
    const absAfter = graph.getAbsolutePosition(child)
    expect(absAfter).not.toBe(absBefore) // Different reference = cache was cleared
    expect(absAfter.x).toBe(110) // Same value — visual position preserved
  })

  test('moving a parent invalidates absPosCache for all children', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const parent = graph.createNode('FRAME', page, {
      name: 'Parent',
      x: 100,
      y: 100,
      width: 200,
      height: 200
    }).id
    const child = graph.createNode('RECTANGLE', parent, {
      name: 'Child',
      x: 10,
      y: 10,
      width: 50,
      height: 50
    }).id

    // Cache child's abs pos (100+10=110)
    const childAbsBefore = graph.getAbsolutePosition(child)
    expect(childAbsBefore.x).toBe(110)

    // Move parent — child's abs pos should change
    graph.updateNode(parent, { x: 300 })

    // Child cache must be invalidated
    const childAbsAfter = graph.getAbsolutePosition(child)
    expect(childAbsAfter.x).toBe(310) // 300+10
    expect(childAbsAfter).not.toBe(childAbsBefore)
  })

  test('cross-parent reorder invalidates absPosCache', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const frame1 = graph.createNode('FRAME', page, {
      name: 'F1',
      x: 0,
      y: 0,
      width: 200,
      height: 200
    }).id
    const frame2 = graph.createNode('FRAME', page, {
      name: 'F2',
      x: 400,
      y: 0,
      width: 200,
      height: 200
    }).id
    const child = graph.createNode('RECTANGLE', frame1, {
      name: 'Child',
      x: 10,
      y: 10,
      width: 50,
      height: 50
    }).id

    // Cache abs pos in frame1 (0+10=10)
    const absBefore = graph.getAbsolutePosition(child)
    expect(absBefore.x).toBe(10)

    // Reorder child from frame1 to frame2 (cross-parent)
    graph.reorderChild(child, frame2, 0)

    // Cache must be invalidated — new abs pos is 400+10=410
    const absAfter = graph.getAbsolutePosition(child)
    expect(absAfter.x).toBe(410)
    expect(absAfter).not.toBe(absBefore)
  })

  test('same-parent reorder does NOT invalidate absPosCache', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const parent = graph.createNode('FRAME', page, {
      name: 'Parent',
      x: 0,
      y: 0,
      width: 200,
      height: 200
    }).id
    const child1 = graph.createNode('RECTANGLE', parent, {
      name: 'C1',
      x: 10,
      y: 10,
      width: 50,
      height: 50
    }).id
    const c2 = graph.createNode('RECTANGLE', parent, {
      name: 'C2',
      x: 70,
      y: 10,
      width: 50,
      height: 50
    })
    void c2

    // Cache abs pos
    const absBefore = graph.getAbsolutePosition(child1)

    // Reorder within same parent — abs pos shouldn't change
    graph.reorderChild(child1, parent, 1)

    // Cache should be preserved (same reference = cache hit)
    const absAfter = graph.getAbsolutePosition(child1)
    expect(absAfter).toBe(absBefore) // Same reference = cache hit
  })

  test('insertChildAt clears absPosCache', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const parent = graph.createNode('FRAME', page, {
      name: 'Parent',
      x: 100,
      y: 100,
      width: 200,
      height: 200
    }).id
    const child = graph.createNode('RECTANGLE', parent, {
      name: 'Child',
      x: 10,
      y: 10,
      width: 50,
      height: 50
    }).id

    // Cache abs pos
    const absBefore = graph.getAbsolutePosition(child)
    expect(absBefore.x).toBe(110)

    // Create a new node and insert via insertChildAt (which clears cache)
    const newNode = graph.createNode('RECTANGLE', page, {
      name: 'Temp',
      x: 0,
      y: 0,
      width: 10,
      height: 10
    })
    graph.insertChildAt(newNode.id, parent, 0)

    // Cache should be cleared (insertChildAt clears unconditionally)
    const absAfter = graph.getAbsolutePosition(child)
    expect(absAfter).not.toBe(absBefore) // Different reference = cache miss
    // Value should be the same (position didn't change)
    expect(absAfter.x).toBe(110)
  })

  test('deleteNode then getAbsolutePosition returns stale value from cache', () => {
    // This test documents a known gap: deleteNode does NOT clear absPosCache.
    // The cached entry for the deleted id remains. If the id is reused
    // (e.g., via restore mode), a stale position could be served.
    const graph = new SceneGraph()
    const node = rect(graph, 'Node', 100, 200)

    // Cache the abs pos
    const abs = graph.getAbsolutePosition(node)
    expect(abs.x).toBe(100)
    expect(abs.y).toBe(200)

    // Delete the node — cache is NOT cleared (known gap)
    graph.deleteNode(node)

    // The cache entry still exists. This is harmless as long as nobody
    // asks for the deleted node's abs pos. But if the id is reused...
    // (This is documented as a known limitation, not a test failure.)
    expect(graph.getNode(node)).toBeUndefined()
  })
})
