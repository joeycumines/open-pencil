import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as Y from 'yjs'

import { SceneGraph, parseFigFile, initCodec } from '@open-pencil/core'

import { createTestStore, createTestYjsSync, makeHostRootState } from '#tests/engine/collab/helpers'
import { assertSubQuadratic, runAtScales } from '#tests/helpers/complexity'
import { heavy, HEAVY_TEST_TIMEOUT_MS } from '#tests/helpers/test-utils'

/**
 * Complexity regression tests.
 *
 * These tests mechanically prevent O(n²) regressions in hot paths that
 * were fixed during the node-id-stability work. Each test runs an
 * operation at multiple scales and asserts sub-quadratic growth via
 * `assertSubQuadratic`.
 *
 * Gated behind BUN_HEAVY_TESTS because they create tens of thousands
 * of nodes and can take several seconds.
 */
heavy('Complexity regression tests', () => {
  // Use larger starting scales to reduce timing noise from small-N overhead.
  // At 5k+ nodes, constant-factor overhead is amortized enough that the
  // ratio meaningfully reflects algorithmic complexity.
  const SCALES = [5_000, 10_000, 20_000]
  const LARGE_SCALES = [5_000, 20_000, 50_000]

  /**
   * Helper: create a graph with `n` rectangle nodes on the first page.
   * Returns the graph and an array of stable IDs for lookup tests.
   */
  function createGraphWithNNodes(n: number): { graph: SceneGraph; stableIds: string[] } {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const stableIds: string[] = []
    for (let i = 0; i < n; i++) {
      const node = graph.createNode('RECTANGLE', page.id, {
        name: `Node${i}`,
        width: 50,
        height: 50
      })
      stableIds.push(graph.getStableId(node))
    }
    return { graph, stableIds }
  }

  test('createNode is sub-quadratic at scale', () => {
    const results = runAtScales(SCALES, (n) => {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      for (let i = 0; i < n; i++) {
        graph.createNode('RECTANGLE', page.id, { name: `R${i}`, width: 50, height: 50 })
      }
    })
    // createNode involves identity registration, event emission, and
    // parent childIds update — O(1) amortized but with non-trivial
    // constant. Use 4.0 to catch O(n²) without flaking on O(n) noise.
    assertSubQuadratic(results, 4.0)
  })

  test('findRuntimeIdByStableId is sub-quadratic (O(1) index)', () => {
    const results = runAtScales(LARGE_SCALES, (n) => {
      const { graph, stableIds } = createGraphWithNNodes(n)
      // Look up every stable ID — should be O(1) per lookup via the index
      for (const sid of stableIds) {
        graph.identity.findRuntimeIdByStableId(sid)
      }
    })
    // O(n) total — n lookups × O(1) each via the index.
    assertSubQuadratic(results, 3.0)
  })

  test('stableIdToRuntimeId fallback (deprecated) is sub-quadratic with index', () => {
    const results = runAtScales(LARGE_SCALES, (n) => {
      const { graph, stableIds } = createGraphWithNNodes(n)
      // The deprecated method still uses the O(1) index first
      for (const sid of stableIds) {
        graph.stableIdToRuntimeId(sid)
      }
    })
    // O(n) total — n lookups × O(1) each. The deprecated method adds a
    // Map.has + nodes.has check per call, so use 3.0 threshold.
    assertSubQuadratic(results, 3.0)
  })

  test('getStableId is sub-quadratic at scale', () => {
    const results = runAtScales(LARGE_SCALES, (n) => {
      const { graph } = createGraphWithNNodes(n)
      // Iterate all nodes and get their stable IDs — should be O(n)
      for (const node of graph.getAllNodes()) {
        graph.getStableId(node)
      }
    })
    // O(n) with iterator overhead — allow 3.0 threshold
    assertSubQuadratic(results, 3.0)
  })

  test('initial collab sync is sub-quadratic', () => {
    const results = runAtScales(SCALES, (n) => {
      const { graph } = createGraphWithNNodes(n)
      const store = createTestStore(graph)
      const ydoc = new Y.Doc()
      const sync = createTestYjsSync(store, ydoc)
      makeHostRootState(store)
      sync.syncAllNodesToYjs()
    })
    assertSubQuadratic(results, 4.0)
  })

  test(
    'material3.fig import completes within timeout (regression guard)',
    async () => {
      await initCodec()
      const fixturePath = resolve(import.meta.dir, '../../fixtures/material3.fig')
      const buf = readFileSync(fixturePath)

      const start = performance.now()
      const graph = await parseFigFile(buf.buffer.slice(0) as ArrayBuffer)
      const ms = performance.now() - start

      // material3.fig is 55 MB. Import should complete well under 30s.
      // This is a regression guard, not a precision benchmark.
      expect(graph.nodes.size).toBeGreaterThan(0)
      expect(ms).toBeLessThan(30_000)
    },
    HEAVY_TEST_TIMEOUT_MS * 2
  )

  test('deleteNode batch is sub-quadratic', () => {
    // Deleting n nodes should be O(n), not O(n²). The identity system's
    // maybeUnreserveImportedId was previously O(n) per delete (O(n²) total).
    const results = runAtScales(SCALES, (n) => {
      const { graph } = createGraphWithNNodes(n)
      const page = graph.getPages()[0]
      const childIds = [...page.childIds]
      for (const id of childIds) {
        graph.deleteNode(id)
      }
    })
    assertSubQuadratic(results, 3.0)
  })
})
