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

/**
 * C-09: assumeFigmaPayload unchecked `as` cast — no validation of remote
 * Yjs peer data.
 *
 * assumeFigmaPayload in serialize.ts casts `unknown` to `SourceMetadata['fig']`
 * with only an `isRecord()` check. Malformed data from a buggy or malicious
 * peer is accepted without validation, causing type confusion downstream.
 *
 * How it fails: A peer sends sourceFig with symbolOverrides as a string
 * instead of an array. assumeFigmaPayload casts it through. The receiver
 * stores it and later code that iterates symbolOverrides crashes or
 * produces wrong results.
 *
 * Fix that makes it pass: Replace assumeFigmaPayload with parseFigmaPayload
 * that validates field types before accepting the data.
 */
describe('C-09: Malformed sourceFig payload accepted without validation', () => {
  test('sourceFig with wrong-typed symbolOverrides should be rejected', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const node = hostStore.graph.createNode('RECTANGLE', hostPage, {
      name: 'Box',
      width: 100,
      height: 100
    })
    const nodeStableId = node.source.id
    expect(nodeStableId).toBeDefined()
    if (nodeStableId === undefined) return

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    // Corrupt the sourceFig on the host's Yjs doc
    // Set symbolOverrides to a string instead of an array
    const ynode = hostSync.ynodes.get(nodeStableId)
    expect(ynode).toBeDefined()
    if (!ynode) return

    const maliciousSourceFig = JSON.stringify({
      rawSize: null,
      rawTransform: null,
      rawNodeFields: {},
      layout: null,
      symbolOverrides: 'NOT_AN_ARRAY', // wrong type — should be rejected
      componentPropAssignments: [],
      derivedSymbolData: [],
      derivedSymbolDataLayoutVersion: null,
      uniformScaleFactor: null
    })
    ynode.set('sourceFig', maliciousSourceFig)

    // Joiner receives the malformed data
    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    // The joiner should have rejected the malformed sourceFig
    // and used default values instead
    const joinerNode = joinerStore.graph.getNode(nodeStableId)
    expect(joinerNode).toBeDefined()
    if (!joinerNode) return

    // FAILS: symbolOverrides is 'NOT_AN_ARRAY' (string) instead of []
    // After fix: parseFigmaPayload returns undefined, source.fig uses defaults
    expect(Array.isArray(joinerNode.source.fig?.symbolOverrides)).toBe(true)
    expect(joinerNode.source.fig?.symbolOverrides).not.toBe('NOT_AN_ARRAY')
  })
})
