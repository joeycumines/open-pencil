import { describe, expect, test } from 'bun:test'

import { SceneGraph, createDefaultSource } from '@open-pencil/core'
import { FigmaAPI } from '@open-pencil/core/figma-api'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

describe('FigmaAPI runtime translation across graph replacements', () => {
  test('held proxy composes translations across repeated setGraph calls', () => {
    const graph1 = new SceneGraph({ documentGuid: 'held-proxy-one' })
    const stableId = 'stable-held-proxy-repeated'
    const node1 = graph1.createNode(
      'RECTANGLE',
      pageId(graph1),
      {
        name: 'Graph one',
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )

    const graph2 = new SceneGraph({
      documentGuid: 'held-proxy-two',
      reservedRuntimeIds: [node1.id]
    })
    const node2 = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      {
        name: 'Graph two',
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )

    const graph3 = new SceneGraph({
      documentGuid: 'held-proxy-three',
      reservedRuntimeIds: [node1.id, node2.id]
    })
    const node3 = graph3.createNode(
      'RECTANGLE',
      pageId(graph3),
      {
        name: 'Graph three',
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )
    expect(node2.id).not.toBe(node1.id)
    expect(node3.id).not.toBe(node1.id)
    expect(node3.id).not.toBe(node2.id)

    const api = new FigmaAPI(graph1)
    const proxy = api.getNodeById(node1.id)
    expect(proxy).not.toBeNull()
    if (!proxy) return

    api.setGraph(graph2, new Map([[node1.id, node2.id]]))
    expect(proxy.id).toBe(node2.id)
    expect(proxy.name).toBe('Graph two')

    api.setGraph(graph3, new Map([[node2.id, node3.id]]))
    expect(proxy.id).toBe(node3.id)
    expect(proxy.name).toBe('Graph three')

    proxy.name = 'Updated graph three'
    expect(graph3.getNode(node3.id)?.name).toBe('Updated graph three')
    expect(graph2.getNode(node2.id)?.name).toBe('Graph two')
    expect(graph1.getNode(node1.id)?.name).toBe('Graph one')
  })

  test('held proxy survives repeated replacement when current runtime id is preserved', () => {
    const graph1 = new SceneGraph({ documentGuid: 'held-proxy-identity-one' })
    const stableId = 'stable-held-proxy-identity-edge'
    const node1 = graph1.createNode(
      'RECTANGLE',
      pageId(graph1),
      {
        name: 'Graph one identity edge',
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )

    const graph2 = new SceneGraph({
      documentGuid: 'held-proxy-identity-two',
      reservedRuntimeIds: [node1.id]
    })
    const node2 = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      {
        name: 'Graph two identity edge',
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )
    expect(node2.id).not.toBe(node1.id)

    const graph3 = new SceneGraph({
      documentGuid: 'held-proxy-identity-three',
      reservedRuntimeIds: [node1.id]
    })
    const node3 = graph3.createNode(
      'RECTANGLE',
      pageId(graph3),
      {
        id: node2.id,
        name: 'Graph three identity edge',
        source: { ...createDefaultSource(), format: 'fig', id: stableId }
      },
      { mode: 'restore' }
    )
    expect(node3.id).toBe(node2.id)

    const api = new FigmaAPI(graph1)
    const proxy = api.getNodeById(node1.id)
    expect(proxy).not.toBeNull()
    if (!proxy) return

    api.setGraph(graph2, new Map([[node1.id, node2.id]]))
    expect(proxy.id).toBe(node2.id)

    api.setGraph(graph3, new Map([[node2.id, node3.id]]))
    expect(proxy.id).toBe(node3.id)
    expect(proxy.name).toBe('Graph three identity edge')

    proxy.name = 'Updated identity-preserved graph three'
    expect(graph3.getNode(node3.id)?.name).toBe('Updated identity-preserved graph three')
    expect(graph2.getNode(node2.id)?.name).toBe('Graph two identity edge')
  })

  test('held proxies use direct mappings when one replacement reuses multiple runtime ids', () => {
    const graph1 = new SceneGraph({ documentGuid: 'held-proxy-direct-one' })
    const nodeA = graph1.createNode(
      'RECTANGLE',
      pageId(graph1),
      {
        id: 'held-direct-a',
        name: 'Old direct A',
        source: { ...createDefaultSource(), format: 'fig', id: 'stable-direct-a' }
      },
      { mode: 'restore' }
    )
    const nodeB = graph1.createNode(
      'RECTANGLE',
      pageId(graph1),
      {
        id: 'held-direct-b',
        name: 'Old direct B',
        source: { ...createDefaultSource(), format: 'fig', id: 'stable-direct-b' }
      },
      { mode: 'restore' }
    )

    const graph2 = new SceneGraph({
      documentGuid: 'held-proxy-direct-two',
      reservedRuntimeIds: [nodeA.id]
    })
    const nodeA2 = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      {
        id: nodeB.id,
        name: 'New direct A at old B id',
        source: { ...createDefaultSource(), format: 'fig', id: 'stable-direct-a' }
      },
      { mode: 'restore' }
    )
    const nodeB2 = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      {
        name: 'New direct B moved elsewhere',
        source: { ...createDefaultSource(), format: 'fig', id: 'stable-direct-b' }
      },
      { mode: 'restore' }
    )
    expect(nodeA2.id).toBe(nodeB.id)
    expect(nodeB2.id).not.toBe(nodeA2.id)

    const api = new FigmaAPI(graph1)
    const heldA = api.getNodeById(nodeA.id)
    const heldB = api.getNodeById(nodeB.id)
    expect(heldA).not.toBeNull()
    expect(heldB).not.toBeNull()
    if (!heldA || !heldB) return

    api.setGraph(
      graph2,
      new Map([
        [nodeA.id, nodeA2.id],
        [nodeB.id, nodeB2.id]
      ])
    )

    expect(heldA.id).toBe(nodeA2.id)
    expect(heldA.name).toBe('New direct A at old B id')
    expect(heldB.id).toBe(nodeB2.id)
    expect(heldB.name).toBe('New direct B moved elsewhere')
  })

  test('held positive translation wins when original id is later reused as another target', () => {
    const graph1 = new SceneGraph({ documentGuid: 'held-proxy-positive-one' })
    const nodeA = graph1.createNode(
      'RECTANGLE',
      pageId(graph1),
      {
        id: 'held-positive-a',
        name: 'Positive A graph one',
        source: { ...createDefaultSource(), format: 'fig', id: 'stable-positive-a' }
      },
      { mode: 'restore' }
    )

    const graph2 = new SceneGraph({ documentGuid: 'held-proxy-positive-two' })
    const nodeA2 = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      {
        id: 'held-positive-b',
        name: 'Positive A graph two',
        source: { ...createDefaultSource(), format: 'fig', id: 'stable-positive-a' }
      },
      { mode: 'restore' }
    )
    const nodeX2 = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      { id: 'held-positive-x', name: 'Positive X graph two' },
      { mode: 'restore' }
    )

    const graph3 = new SceneGraph({ documentGuid: 'held-proxy-positive-three' })
    const nodeA3 = graph3.createNode(
      'RECTANGLE',
      pageId(graph3),
      {
        id: 'held-positive-c',
        name: 'Positive A graph three',
        source: { ...createDefaultSource(), format: 'fig', id: 'stable-positive-a' }
      },
      { mode: 'restore' }
    )
    const nodeX3 = graph3.createNode(
      'RECTANGLE',
      pageId(graph3),
      { id: nodeA.id, name: 'Positive X reusing original A id' },
      { mode: 'restore' }
    )
    expect(nodeX3.id).toBe(nodeA.id)

    const api = new FigmaAPI(graph1)
    const heldA = api.getNodeById(nodeA.id)
    expect(heldA).not.toBeNull()
    if (!heldA) return

    api.setGraph(graph2, new Map([[nodeA.id, nodeA2.id]]))
    expect(heldA.id).toBe(nodeA2.id)

    api.setGraph(
      graph3,
      new Map([
        [nodeA2.id, nodeA3.id],
        [nodeX2.id, nodeX3.id]
      ])
    )
    expect(heldA.id).toBe(nodeA3.id)
    expect(heldA.name).toBe('Positive A graph three')
  })

  test('held unmapped proxy invalidates when its runtime id is reused as another node target', () => {
    const graph1 = new SceneGraph({ documentGuid: 'held-proxy-reuse-one' })
    const nodeA = graph1.createNode(
      'RECTANGLE',
      pageId(graph1),
      {
        id: 'held-proxy-reuse-a',
        name: 'Old A',
        source: { ...createDefaultSource(), format: 'fig', id: 'stable-reuse-a' }
      },
      { mode: 'restore' }
    )
    const nodeB = graph1.createNode(
      'RECTANGLE',
      pageId(graph1),
      {
        id: 'held-proxy-reuse-b',
        name: 'Old B',
        source: { ...createDefaultSource(), format: 'fig', id: 'stable-reuse-b' }
      },
      { mode: 'restore' }
    )

    const graph2 = new SceneGraph({ documentGuid: 'held-proxy-reuse-two' })
    const nodeA2 = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      {
        id: nodeB.id,
        name: 'New A using old B runtime id',
        source: { ...createDefaultSource(), format: 'fig', id: 'stable-reuse-a' }
      },
      { mode: 'restore' }
    )
    expect(nodeA2.id).toBe(nodeB.id)

    const graph3 = new SceneGraph({
      documentGuid: 'held-proxy-reuse-three',
      reservedRuntimeIds: [nodeB.id]
    })
    const nodeA3 = graph3.createNode(
      'RECTANGLE',
      pageId(graph3),
      {
        name: 'New A after reused target changes again',
        source: { ...createDefaultSource(), format: 'fig', id: 'stable-reuse-a' }
      },
      { mode: 'restore' }
    )
    expect(nodeA3.id).not.toBe(nodeB.id)

    const api = new FigmaAPI(graph1)
    const heldA = api.getNodeById(nodeA.id)
    const heldB = api.getNodeById(nodeB.id)
    expect(heldA).not.toBeNull()
    expect(heldB).not.toBeNull()
    if (!heldA || !heldB) return

    api.setGraph(graph2, new Map([[nodeA.id, nodeA2.id]]))
    expect(heldA.id).toBe(nodeA2.id)
    expect(heldA.name).toBe('New A using old B runtime id')
    expect(() => heldB.name).toThrow()

    api.setGraph(graph3, new Map([[nodeA2.id, nodeA3.id]]))
    expect(heldA.id).toBe(nodeA3.id)
    expect(heldA.name).toBe('New A after reused target changes again')
    expect(() => heldB.name).toThrow()

    const graph4 = new SceneGraph({ documentGuid: 'held-proxy-reuse-four' })
    graph4.createNode(
      'RECTANGLE',
      pageId(graph4),
      { id: nodeB.id, name: 'Unrelated node using old B runtime id' },
      { mode: 'restore' }
    )
    api.setGraph(graph4, new Map())
    expect(() => heldB.name).toThrow()
  })

  test('held old proxy invalidates when its id is reused after an empty replacement', () => {
    const graph1 = new SceneGraph({ documentGuid: 'held-proxy-empty-one' })
    const nodeA = graph1.createNode(
      'RECTANGLE',
      pageId(graph1),
      { id: 'held-empty-a', name: 'Empty A graph one' },
      { mode: 'restore' }
    )

    const graph2 = new SceneGraph({ documentGuid: 'held-proxy-empty-two' })
    const nodeX2 = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      { id: 'held-empty-x', name: 'Empty X graph two' },
      { mode: 'restore' }
    )

    const graph3 = new SceneGraph({ documentGuid: 'held-proxy-empty-three' })
    const nodeX3 = graph3.createNode(
      'RECTANGLE',
      pageId(graph3),
      { id: nodeA.id, name: 'Empty X reusing old A id' },
      { mode: 'restore' }
    )
    expect(nodeX3.id).toBe(nodeA.id)

    const api = new FigmaAPI(graph1)
    const heldA = api.getNodeById(nodeA.id)
    expect(heldA).not.toBeNull()
    if (!heldA) return

    api.setGraph(graph2, new Map())
    expect(() => heldA.name).toThrow()

    api.setGraph(graph3, new Map([[nodeX2.id, nodeX3.id]]))
    expect(() => heldA.name).toThrow()
  })

  test('held unmapped proxy invalidates when replacement graph reuses the same runtime id without translation', () => {
    const graph1 = new SceneGraph({ documentGuid: 'held-proxy-same-id-one' })
    const nodeA = graph1.createNode(
      'RECTANGLE',
      pageId(graph1),
      { id: 'held-same-id-a', name: 'Same-id A graph one' },
      { mode: 'restore' }
    )

    const graph2 = new SceneGraph({ documentGuid: 'held-proxy-same-id-two' })
    const nodeX = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      { id: nodeA.id, name: 'Unrelated same runtime id graph two' },
      { mode: 'restore' }
    )
    expect(nodeX.id).toBe(nodeA.id)

    const api = new FigmaAPI(graph1)
    const heldA = api.getNodeById(nodeA.id)
    expect(heldA).not.toBeNull()
    if (!heldA) return

    api.setGraph(graph2, new Map())
    expect(() => heldA.name).toThrow()
    expect(graph2.getNode(nodeX.id)?.name).toBe('Unrelated same runtime id graph two')
  })

  test('held translated proxy invalidates when its positive chain is broken', () => {
    const graph1 = new SceneGraph({ documentGuid: 'held-proxy-broken-one' })
    const nodeA = graph1.createNode(
      'RECTANGLE',
      pageId(graph1),
      { id: 'held-broken-a', name: 'Broken A graph one' },
      { mode: 'restore' }
    )

    const graph2 = new SceneGraph({ documentGuid: 'held-proxy-broken-two' })
    const nodeA2 = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      { id: 'held-broken-b', name: 'Broken A graph two' },
      { mode: 'restore' }
    )

    const graph3 = new SceneGraph({ documentGuid: 'held-proxy-broken-three' })
    graph3.createNode(
      'RECTANGLE',
      pageId(graph3),
      { id: nodeA.id, name: 'Unrelated node reusing broken original A id' },
      { mode: 'restore' }
    )

    const api = new FigmaAPI(graph1)
    const heldA = api.getNodeById(nodeA.id)
    expect(heldA).not.toBeNull()
    if (!heldA) return

    api.setGraph(graph2, new Map([[nodeA.id, nodeA2.id]]))
    expect(heldA.id).toBe(nodeA2.id)

    api.setGraph(graph3, new Map())
    expect(() => heldA.name).toThrow()
  })

  test('held translated proxy invalidates when an identity map does not continue its chain', () => {
    const graph1 = new SceneGraph({ documentGuid: 'held-proxy-broken-identity-one' })
    const nodeA = graph1.createNode(
      'RECTANGLE',
      pageId(graph1),
      { id: 'held-broken-identity-a', name: 'Broken identity A graph one' },
      { mode: 'restore' }
    )

    const graph2 = new SceneGraph({ documentGuid: 'held-proxy-broken-identity-two' })
    const nodeA2 = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      { id: 'held-broken-identity-b', name: 'Broken identity A graph two' },
      { mode: 'restore' }
    )
    const nodeX2 = graph2.createNode(
      'RECTANGLE',
      pageId(graph2),
      { id: nodeA.id, name: 'Broken identity X graph two' },
      { mode: 'restore' }
    )

    const graph3 = new SceneGraph({ documentGuid: 'held-proxy-broken-identity-three' })
    const nodeX3 = graph3.createNode(
      'RECTANGLE',
      pageId(graph3),
      { id: nodeX2.id, name: 'Broken identity X graph three' },
      { mode: 'restore' }
    )

    const api = new FigmaAPI(graph1)
    const heldA = api.getNodeById(nodeA.id)
    expect(heldA).not.toBeNull()
    if (!heldA) return

    api.setGraph(graph2, new Map([[nodeA.id, nodeA2.id]]))
    expect(heldA.id).toBe(nodeA2.id)

    api.setGraph(graph3, new Map([[nodeX2.id, nodeX3.id]]))
    expect(() => heldA.name).toThrow()
  })
})
