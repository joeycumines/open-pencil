import { beforeAll, describe, expect, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import type { GUID, SourceMetadata } from '@open-pencil/core'
import { parseFigBuffer } from '@open-pencil/kiwi/fig/parse'

function figSource(id: string, format: SourceMetadata['format'] = 'fig'): SourceMetadata {
  return {
    id,
    format,
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
}

function guidKey(guid: GUID | undefined): string | null {
  return guid ? `${guid.sessionID}:${guid.localID}` : null
}

/**
 * Regression test: two distinct nodes sharing the same source.id
 * (as happens with component-instance children) must receive
 * different GUIDs on export, preventing silent data loss on reimport.
 */
describe('export: GUID collision prevention', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('two nodes with same source.id get different GUIDs on export', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    // Create two nodes that share the same Figma source.id
    // (simulates component master + instance child)
    graph.createNode('RECTANGLE', page.id, {
      name: 'Master Child',
      width: 100,
      height: 50,
      source: figSource('1:94')
    })

    graph.createNode('RECTANGLE', page.id, {
      name: 'Instance Child',
      width: 100,
      height: 50,
      source: figSource('1:94')
    })

    const figBytes = await exportFigFile(graph)
    expect(graph.exportDiagnostics?.reusedGuids).toContain('1:94')
    const collision = graph.exportDiagnostics?.mintedGuids.find(
      (entry) => entry.reason === 'collision' && entry.sourceId === '1:94'
    )
    expect(collision?.assigned).toMatch(/^\d+:\d+$/)
    expect(collision?.assigned).not.toBe('1:94')

    const reimported = await parseFigFile(figBytes.buffer as ArrayBuffer)

    // Both nodes must survive reimport — no silent last-write-wins
    const allNodes = [...reimported.getAllNodes()]
    const rects = allNodes.filter(
      (n) => n.type === 'RECTANGLE' && (n.name === 'Master Child' || n.name === 'Instance Child')
    )
    expect(rects.length).toBe(2)
  })

  test('cloned node does not collide with original GUID', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Original',
      width: 100,
      height: 50,
      source: figSource('1:200')
    })

    // Clone the node — cloneTree clears the imported source id, and the
    // identity layer mints a fresh stable id for the new local node.
    const clone = graph.cloneTree(rect.id, page.id)
    expect(clone).not.toBeNull()
    if (!clone) throw new Error('Expected clone to exist')
    expect(clone.source.id).toMatch(/^\d+:\d+$/)
    expect(clone.source.id).not.toBe(rect.source.id)

    const figBytes = await exportFigFile(graph)
    const reimported = await parseFigFile(figBytes.buffer as ArrayBuffer)

    const allNodes = [...reimported.getAllNodes()]
    const rects = allNodes.filter((n) => n.type === 'RECTANGLE')
    // Both original and clone must survive
    expect(rects.length).toBe(2)
  })

  test('export roundtrip preserves three nodes with identical source.id', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    for (let i = 0; i < 3; i++) {
      graph.createNode('RECTANGLE', page.id, {
        name: `Rect ${i}`,
        width: 50,
        height: 50,
        source: figSource('1:500')
      })
    }

    const figBytes = await exportFigFile(graph)
    const collisions =
      graph.exportDiagnostics?.mintedGuids.filter(
        (entry) => entry.reason === 'collision' && entry.sourceId === '1:500'
      ) ?? []
    expect(graph.exportDiagnostics?.reusedGuids).toContain('1:500')
    expect(collisions).toHaveLength(2)

    const reimported = await parseFigFile(figBytes.buffer as ArrayBuffer)

    const allNodes = [...reimported.getAllNodes()]
    const rects = allNodes.filter((n) => n.type === 'RECTANGLE')
    expect(rects.length).toBe(3)
  })

  test('nodes with session-0 source.id do not collide with document GUID', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    // The document GUID is always {sessionID:0, localID:0}.
    // Imported nodes with source.id in the 0:* namespace must not reuse
    // that slot — the export must reserve the document GUID first.
    graph.createNode('RECTANGLE', page.id, {
      name: 'S0 Node A',
      width: 100,
      height: 50,
      source: figSource('0:94')
    })

    graph.createNode('RECTANGLE', page.id, {
      name: 'S0 Node B',
      width: 100,
      height: 50,
      source: figSource('0:94')
    })

    const figBytes = await exportFigFile(graph)
    expect(graph.exportDiagnostics?.reusedGuids).toContain('0:94')
    expect(
      graph.exportDiagnostics?.mintedGuids.some(
        (entry) => entry.reason === 'collision' && entry.sourceId === '0:94'
      )
    ).toBe(true)

    const reimported = await parseFigFile(figBytes.buffer as ArrayBuffer)

    const allNodes = [...reimported.getAllNodes()]
    const rects = allNodes.filter(
      (n) => n.type === 'RECTANGLE' && (n.name === 'S0 Node A' || n.name === 'S0 Node B')
    )
    // Both nodes must survive — the document GUID (0:0) must not swallow them
    expect(rects.length).toBe(2)
  })

  test('invalid fig page source.id mints a finite canvas GUID and diagnostic', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    page.source = { ...page.source, format: 'fig', id: 'not-a-guid' }

    const figBytes = await exportFigFile(graph)
    const parsed = parseFigBuffer(
      figBytes.buffer.slice(figBytes.byteOffset, figBytes.byteOffset + figBytes.byteLength)
    )
    const canvas = parsed.nodeChanges.find((nc) => nc.type === 'CANVAS' && nc.name === page.name)
    const canvasGuid = canvas?.guid
    expect(canvasGuid).toBeDefined()
    expect(Number.isFinite(canvasGuid?.sessionID)).toBe(true)
    expect(Number.isFinite(canvasGuid?.localID)).toBe(true)

    const minted = graph.exportDiagnostics?.mintedGuids.find(
      (entry) => entry.sourceId === 'not-a-guid'
    )
    expect(minted).toMatchObject({ reason: 'missing', assigned: guidKey(canvasGuid) })
  })

  test('non-fig page source.id is not reused as a canvas GUID', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    page.source = figSource('4:463', 'pen')

    const figBytes = await exportFigFile(graph)
    const parsed = parseFigBuffer(
      figBytes.buffer.slice(figBytes.byteOffset, figBytes.byteOffset + figBytes.byteLength)
    )
    const canvas = parsed.nodeChanges.find((nc) => nc.type === 'CANVAS' && nc.name === page.name)
    const canvasGuid = canvas?.guid
    expect(guidKey(canvasGuid)).not.toBe('4:463')

    const minted = graph.exportDiagnostics?.mintedGuids.find(
      (entry) => entry.assigned === guidKey(canvasGuid)
    )
    expect(minted).toMatchObject({ reason: 'missing', sourceId: null })
  })

  test('node collision fallback skips GUIDs already reused by canvas entries', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    page.source = figSource('1:6')

    graph.createNode('RECTANGLE', page.id, {
      name: 'Node A',
      width: 100,
      height: 50,
      source: figSource('0:5')
    })
    graph.createNode('RECTANGLE', page.id, {
      name: 'Node B',
      width: 100,
      height: 50,
      source: figSource('0:5')
    })

    const figBytes = await exportFigFile(graph)
    const collision = graph.exportDiagnostics?.mintedGuids.find(
      (entry) => entry.reason === 'collision' && entry.sourceId === '0:5'
    )
    expect(collision?.assigned).not.toBe('1:6')

    const parsed = parseFigBuffer(
      figBytes.buffer.slice(figBytes.byteOffset, figBytes.byteOffset + figBytes.byteLength)
    )
    const guidKeys = parsed.nodeChanges
      .map((nc) => guidKey(nc.guid))
      .filter((key): key is string => key !== null)
    expect(new Set(guidKeys).size).toBe(guidKeys.length)
  })

  test('local variable source ids are minted instead of reused', async () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Local')
    const variable = graph.createVariable('Color', 'COLOR', collection.id)

    await exportFigFile(graph)

    const localIds = [
      collection.source?.id,
      collection.modes[0]?.source?.id,
      variable.source?.id
    ].filter((id): id is string => id !== null && id !== undefined)
    for (const id of localIds) {
      expect(graph.exportDiagnostics?.reusedGuids).not.toContain(id)
    }
    const missingMintCount =
      graph.exportDiagnostics?.mintedGuids.filter(
        (entry) => entry.reason === 'missing' && entry.sourceId === null
      ).length ?? 0
    expect(missingMintCount).toBeGreaterThanOrEqual(localIds.length)
  })

  test('imported variable source ids are reserved before canvas GUID minting', async () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Imported')
    const variable = graph.createVariable('Color', 'COLOR', collection.id)
    const mode = collection.modes[0]
    if (!mode) throw new Error('Expected default variable mode')

    collection.source = figSource('0:2')
    mode.source = figSource('0:3')
    variable.source = figSource('0:4')

    await exportFigFile(graph)

    expect(graph.exportDiagnostics?.reusedGuids).toEqual(
      expect.arrayContaining(['0:2', '0:3', '0:4'])
    )
    expect(
      graph.exportDiagnostics?.mintedGuids.some(
        (entry) => entry.reason === 'collision' && ['0:2', '0:3', '0:4'].includes(entry.sourceId)
      )
    ).toBe(false)
  })

  test('export preserves raw component prop definition parent and variable refs', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('COMPONENT', page.id, {
      name: 'Exported Component',
      width: 100,
      height: 100,
      componentPropertyDefinitions: [
        {
          id: '90:1',
          name: 'Icon',
          type: 'INSTANCE_SWAP',
          defaultValue: '90:2'
        }
      ],
      source: {
        id: '90:10',
        format: 'fig',
        orderKey: null,
        fig: {
          rawSize: null,
          rawTransform: null,
          rawNodeFields: {
            componentPropDefs: [
              {
                id: { sessionID: 90, localID: 1 },
                parentPropDefId: { sessionID: 90, localID: 3 },
                varValue: { value: { alias: { guid: { sessionID: 90, localID: 4 } } } }
              }
            ]
          },
          layout: null,
          symbolOverrides: [],
          componentPropAssignments: [],
          derivedSymbolData: [],
          derivedSymbolDataLayoutVersion: null,
          uniformScaleFactor: null
        }
      }
    })

    const figBytes = await exportFigFile(graph)
    const parsed = parseFigBuffer(
      figBytes.buffer.slice(figBytes.byteOffset, figBytes.byteOffset + figBytes.byteLength)
    )
    const component = parsed.nodeChanges.find((nc) => nc.name === 'Exported Component')

    expect(component?.componentPropDefs?.[0]).toMatchObject({
      id: { sessionID: 90, localID: 1 },
      name: 'Icon',
      parentPropDefId: { sessionID: 90, localID: 3 },
      varValue: { value: { alias: { guid: { sessionID: 90, localID: 4 } } } }
    })
  })

  test('cross-page cloned frames survive export roundtrip', async () => {
    const graph = new SceneGraph()
    const page1 = graph.getPages()[0]
    page1.name = 'Page 1'
    const frame = graph.createNode('FRAME', page1.id, {
      name: 'A',
      width: 200,
      height: 100
    })
    graph.createNode('TEXT', frame.id, {
      name: 'Label',
      text: 'Hello',
      width: 100,
      height: 20
    })

    const clone = graph.cloneTree(frame.id, page1.id)
    expect(clone).not.toBeNull()
    if (!clone) throw new Error('Expected clone to exist')
    const page2 = graph.addPage('Page 2')
    graph.reparentNode(clone.id, page2.id)

    const figBytes = await exportFigFile(graph)
    const reimported = await parseFigFile(figBytes.buffer as ArrayBuffer)
    const pages = reimported.getPages()

    expect(pages.map((page) => page.name)).toEqual(['Page 1', 'Page 2'])
    for (const page of pages) {
      const [child] = reimported.getChildren(page.id)
      expect(child?.name).toBe('A')
      expect(child?.type).toBe('FRAME')
      expect(child ? reimported.getChildren(child.id).map((node) => node.name) : []).toEqual([
        'Label'
      ])
    }
  })
})
