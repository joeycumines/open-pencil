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
 * C-05: Remote delete during text edit — silent edit loss.
 *
 * If a remote peer deletes a text node while the local peer is editing it,
 * the edit is silently lost. commitTextEdit calls getNode which returns
 * undefined, but there's no guard — the edit proceeds with undefined node
 * data, updateNode is a no-op, and a dead undo entry is pushed.
 *
 * This test verifies that when a node is deleted by a remote peer, a
 * subsequent local update to that node is silently lost (no error, no
 * notification). This is the underlying behavior that commitTextEdit
 * exhibits when it doesn't guard against node deletion.
 *
 * How it fails: The test expects that a deleted node's text cannot be
 * updated (which is correct behavior), but the current code doesn't
 * notify the caller — the edit is silently lost. After the fix,
 * commitTextEdit should abort the edit session when the node is deleted,
 * preventing the silent loss.
 *
 * NOTE: This test directly tests the underlying behavior (updateNode on
 * a deleted node is a no-op). The full fix requires commitTextEdit to
 * guard against this, which needs a text editor mock — added in Phase 2.
 */
describe('C-05: Remote delete during text edit loses edit silently', () => {
  test('node deleted by remote peer cannot be updated — edit silently lost', () => {
    const hostStore = createTestStore()
    const hostPage = firstPageId(hostStore.graph)
    const textNode = hostStore.graph.createNode('TEXT', hostPage, {
      name: 'Title',
      text: 'Hello',
      x: 0,
      y: 0,
      width: 100,
      height: 20
    })
    const textStableId = textNode.source.id!

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    // Joiner receives the text node
    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    // Joiner has the text node
    expect(joinerStore.graph.getNode(textStableId)).toBeDefined()
    expect(joinerStore.graph.getNode(textStableId)?.text).toBe('Hello')

    // Remote peer deletes the text node
    hostSync.ynodes.delete(textStableId)
    encodeAndApply(hostYdoc, joinerYdoc)

    // The text node is now deleted on the joiner
    expect(joinerStore.graph.getNode(textStableId)).toBeUndefined()

    // Simulate commitTextEdit: joiner tries to update the deleted node's text
    // This should be a no-op (node doesn't exist), but the caller gets NO
    // indication that the edit was lost
    joinerStore.graph.updateNode(textStableId, { text: 'World' })

    // The node is still deleted — the edit was silently lost
    // After fix: commitTextEdit would check if node exists before calling updateNode
    // and would abort the session, notifying the user
    expect(joinerStore.graph.getNode(textStableId)).toBeUndefined()

    // The KILL CONDITION: the caller has no way to know the edit was lost.
    // updateNode returns void (no success/failure indicator).
    // This test passes because updateNode is a no-op — the bug is the SILENT loss.
    // The fix adds a guard in commitTextEdit to detect this and abort.
  })
})
