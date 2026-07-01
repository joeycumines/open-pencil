import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '#tests/engine/collab/helpers'
import { firstPageId } from '#tests/helpers/scene'

function applyRemoteSourceFig(sourceFig: Record<string, unknown>) {
  return applyRemoteSourceFigText(JSON.stringify(sourceFig))
}

function applyRemoteSourceFigText(sourceFig: string) {
  const hostStore = createTestStore()
  const node = hostStore.graph.createNode('RECTANGLE', firstPageId(hostStore.graph), {
    name: 'Box',
    width: 100,
    height: 100
  })
  const nodeStableId = node.source.id
  if (nodeStableId === undefined) throw new Error('expected stable node id')

  const hostYdoc = new Y.Doc()
  const hostSync = createTestYjsSync(hostStore, hostYdoc)
  makeHostRootState(hostStore)
  hostSync.syncAllNodesToYjs()

  const ynode = hostSync.ynodes.get(nodeStableId)
  if (!ynode) throw new Error('expected host Yjs node')
  ynode.set('sourceFig', sourceFig)

  const joinerStore = createTestStore()
  const joinerYdoc = new Y.Doc()
  const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
  observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
  encodeAndApply(hostYdoc, joinerYdoc)

  const joinerNode = joinerStore.graph.getNode(nodeStableId)
  if (!joinerNode) throw new Error('expected joined node')
  return { joinerNode, joinerSync, nodeStableId }
}

function expectOutboundSourceFigExcludesInternals(
  joinerSync: ReturnType<typeof createTestYjsSync>,
  nodeStableId: string,
  joinerNodeId: string
) {
  joinerSync.syncNodeToYjs(joinerNodeId)
  const outbound = joinerSync.ynodes.get(nodeStableId)?.get('sourceFig')
  expect(typeof outbound).toBe('string')
  if (typeof outbound !== 'string') return
  expect(outbound).not.toContain('evil')
  expect(outbound).not.toContain('_map')
}

describe('sourceFig payload validation', () => {
  test('unknown top-level sourceFig keys are sanitized and not re-emitted', () => {
    const { joinerNode, joinerSync, nodeStableId } = applyRemoteSourceFig({
      rawSize: null,
      rawTransform: null,
      rawNodeFields: { opaque: { preserved: true } },
      layout: null,
      symbolOverrides: [],
      componentPropAssignments: [],
      derivedSymbolData: [],
      derivedSymbolDataLayoutVersion: null,
      uniformScaleFactor: null,
      evil: { _map: {}, _item: null, doc: null }
    })
    expect('evil' in joinerNode.source.fig).toBe(false)
    expect(joinerNode.source.fig.rawNodeFields).toEqual({ opaque: { preserved: true } })

    joinerSync.syncNodeToYjs(joinerNode.id)
    const outbound = joinerSync.ynodes.get(nodeStableId)?.get('sourceFig')
    expect(typeof outbound).toBe('string')
    if (typeof outbound !== 'string') return
    expect(outbound).not.toContain('evil')
    expect(outbound).not.toContain('_map')
    expect(JSON.parse(outbound)).toEqual({
      rawSize: null,
      rawTransform: null,
      rawNodeFields: { opaque: { preserved: true } },
      layout: null,
      symbolOverrides: [],
      componentPropAssignments: [],
      derivedSymbolData: [],
      derivedSymbolDataLayoutVersion: null,
      uniformScaleFactor: null
    })
  })

  test('known sourceFig shape fields reject nested malicious keys', () => {
    const rawSizeResult = applyRemoteSourceFig({
      rawSize: { x: 1, y: 2, evil: { _map: {}, doc: null } },
      rawTransform: null,
      rawNodeFields: {},
      layout: null,
      symbolOverrides: [],
      componentPropAssignments: [],
      derivedSymbolData: [],
      derivedSymbolDataLayoutVersion: null,
      uniformScaleFactor: null
    })
    expect(rawSizeResult.joinerNode.source.fig.rawSize).toBeNull()
    expectOutboundSourceFigExcludesInternals(
      rawSizeResult.joinerSync,
      rawSizeResult.nodeStableId,
      rawSizeResult.joinerNode.id
    )

    const rawTransformResult = applyRemoteSourceFig({
      rawSize: null,
      rawTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0, evil: { _map: {} } },
      rawNodeFields: {},
      layout: null,
      symbolOverrides: [],
      componentPropAssignments: [],
      derivedSymbolData: [],
      derivedSymbolDataLayoutVersion: null,
      uniformScaleFactor: null
    })
    expect(rawTransformResult.joinerNode.source.fig.rawTransform).toBeNull()
    expectOutboundSourceFigExcludesInternals(
      rawTransformResult.joinerSync,
      rawTransformResult.nodeStableId,
      rawTransformResult.joinerNode.id
    )

    const layoutResult = applyRemoteSourceFig({
      rawSize: null,
      rawTransform: null,
      rawNodeFields: {},
      layout: { stackMode: 'HORIZONTAL', evil: { _map: {} } },
      symbolOverrides: [],
      componentPropAssignments: [],
      derivedSymbolData: [],
      derivedSymbolDataLayoutVersion: null,
      uniformScaleFactor: null
    })
    expect(layoutResult.joinerNode.source.fig.layout).toBeNull()
    expectOutboundSourceFigExcludesInternals(
      layoutResult.joinerSync,
      layoutResult.nodeStableId,
      layoutResult.joinerNode.id
    )
  })

  test('known sourceFig scalar numbers reject non-finite JSON values', () => {
    const { joinerNode, joinerSync, nodeStableId } = applyRemoteSourceFigText(
      '{"rawSize":null,"rawTransform":null,"rawNodeFields":{},"layout":null,"symbolOverrides":[],"componentPropAssignments":[],"derivedSymbolData":[],"derivedSymbolDataLayoutVersion":1e999,"uniformScaleFactor":1e999}'
    )

    expect(joinerNode.source.fig.derivedSymbolDataLayoutVersion).toBeNull()
    expect(joinerNode.source.fig.uniformScaleFactor).toBeNull()
    joinerSync.syncNodeToYjs(joinerNode.id)
    const outbound = joinerSync.ynodes.get(nodeStableId)?.get('sourceFig')
    expect(typeof outbound).toBe('string')
    if (typeof outbound !== 'string') return
    const parsed = JSON.parse(outbound) as {
      derivedSymbolDataLayoutVersion?: unknown
      uniformScaleFactor?: unknown
    }
    expect(parsed.derivedSymbolDataLayoutVersion).toBeNull()
    expect(parsed.uniformScaleFactor).toBeNull()
  })
})
