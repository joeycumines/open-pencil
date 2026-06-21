import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import type { SceneNode } from '@open-pencil/core'

import { collectAllNodes } from '#tests/helpers/fig-traversal'

setDefaultTimeout(60_000)

/**
 * H-07: Remediated GUID round-trip test.
 *
 * When a .fig file contains duplicate GUIDs, the importer remediates them
 * by assigning synthetic GUIDs. This test verifies that the remediated
 * graph survives a subsequent export → reimport cycle without data loss
 * or corruption.
 *
 * The test creates two nodes sharing the same source.id (simulating a
 * duplicate-GUID .fig file), exports to .fig (where the exporter detects
 * the collision and mints a new GUID for the second node), reimports,
 * then exports and reimports again to verify stability.
 */
describe('roundtrip: remediated GUIDs survive double round-trip', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('duplicate source.id nodes survive export → import → export → import', async () => {
    // Create a graph with two nodes sharing the same source.id
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    // Both nodes share source.id "1:100" — simulating a duplicate GUID scenario
    const sharedSourceId = '1:100'
    graph.createNode('RECTANGLE', page.id, {
      name: 'Node A',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      source: {
        id: sharedSourceId,
        format: 'fig',
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
    graph.createNode('RECTANGLE', page.id, {
      name: 'Node B',
      x: 200,
      y: 0,
      width: 100,
      height: 100,
      source: {
        id: sharedSourceId,
        format: 'fig',
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

    // First export — the exporter detects the collision and mints a new GUID for Node B
    const bytes1 = await exportFigFile(graph)
    expect(bytes1.length).toBeGreaterThan(0)

    // First import — both nodes should be present
    const reImported1 = await parseFigFile(bytes1)
    const nodes1 = collectAllNodes(reImported1).filter((n) => n.type === 'RECTANGLE')
    expect(nodes1.length).toBe(2)

    // Both nodes should have different source.ids after export remediation
    const sourceIds1 = nodes1.map((n) => n.source.id).filter((id): id is string => id !== null)
    expect(new Set(sourceIds1).size).toBe(2)

    // Both nodes should have unique source.ids
    expect(sourceIds1[0]).not.toBe(sourceIds1[1])

    // Verify node names survive
    const names1 = nodes1.map((n) => n.name).sort()
    expect(names1).toContain('Node A')
    expect(names1).toContain('Node B')

    // Second export — the remediated graph should export cleanly
    const bytes2 = await exportFigFile(reImported1)
    expect(bytes2.length).toBeGreaterThan(0)

    // Second import — verify consistency with first import
    const reImported2 = await parseFigFile(bytes2)
    const nodes2 = collectAllNodes(reImported2).filter((n) => n.type === 'RECTANGLE')
    expect(nodes2.length).toBe(2)

    // Source.ids should be stable across the second round-trip
    const sourceIds2 = nodes2.map((n) => n.source.id).filter((id): id is string => id !== null)
    expect(new Set(sourceIds2).size).toBe(2)

    // The set of source.ids should be the same after both round-trips
    expect(new Set(sourceIds2)).toEqual(new Set(sourceIds1))

    // Node names should be preserved
    const names2 = nodes2.map((n) => n.name).sort()
    expect(names2).toEqual(names1)

    // Verify positions are preserved
    const positionsMatch = nodes1.every((n1) => {
      const n2 = nodes2.find((n) => n.name === n1.name)
      return n2 !== undefined && n2.x === n1.x && n2.y === n1.y
    })
    expect(positionsMatch).toBe(true)
  })

  test('mixed fig-imported and locally-created nodes survive round-trip', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    // A fig-imported node (has source.format = 'fig')
    graph.createNode('RECTANGLE', page.id, {
      name: 'Imported',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      source: {
        id: '1:200',
        format: 'fig',
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

    // A locally-created node (source.format = null, source.id = generated)
    graph.createNode('ELLIPSE', page.id, {
      name: 'Local',
      x: 200,
      y: 0,
      width: 100,
      height: 100
    })

    // Export and reimport
    const bytes = await exportFigFile(graph)
    const reImported = await parseFigFile(bytes)
    const nodes = collectAllNodes(reImported).filter(
      (n) => n.type === 'RECTANGLE' || n.type === 'ELLIPSE'
    )
    expect(nodes.length).toBe(2)

    // Both should have source.ids after round-trip
    const allHaveIds = nodes.every((n) => n.source.id !== null)
    expect(allHaveIds).toBe(true)

    // The fig-imported node should retain format = 'fig'
    const imported = nodes.find((n) => n.name === 'Imported') as SceneNode | undefined
    expect(imported).toBeDefined()
    expect(imported?.source.format).toBe('fig')

    // The locally-created node should also have format = 'fig' after round-trip
    // (it went through a .fig export/import cycle, so it's now fig-imported)
    const local = nodes.find((n) => n.name === 'Local') as SceneNode | undefined
    expect(local).toBeDefined()
    expect(local?.source.format).toBe('fig')

    // Export diagnostics should be populated
    expect(graph.exportDiagnostics).toBeDefined()
    expect(graph.exportDiagnostics?.reusedGuids.length).toBeGreaterThanOrEqual(0)
    expect(graph.exportDiagnostics?.mintedGuids.length).toBeGreaterThanOrEqual(0)
  })
})
