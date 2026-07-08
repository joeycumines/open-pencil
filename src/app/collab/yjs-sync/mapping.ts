import type * as Y from 'yjs'

import type { GraphSyncState, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { YNodes } from './constants'
import { rawStableIdFromRemoteNodeKey, remoteNodeKeyForStableId } from './remote-node-key'

/**
 * Dev-only flag. When true, performance counters track O(n) fallback paths
 * in collab sync. Zero production overhead — Vite tree-shakes all guarded
 * code when DEV is false.
 */
const IS_DEV = 'env' in import.meta && import.meta.env.DEV

/** Dev-only counter for findNodeByStableId linear-scan fallback. */
let findNodeByStableIdFallbackCount = 0

/** Threshold for fallback warnings in findNodeByStableId. */
const FIND_NODE_FALLBACK_THRESHOLD = 100

/**
 * Reset dev-only performance counters. Call at sync start to avoid stale
 * warnings across unrelated sync operations. No-op in production builds.
 */
export function resetCollabDevCounters(): void {
  if (IS_DEV) findNodeByStableIdFallbackCount = 0
}

export function stableIdForNode(node: SceneNode): string {
  return node.source.id ?? node.id
}

/**
 * Returns the remote stable id for a local node, backfilling the bidirectional
 * local<->remote mapping when it has not been recorded yet.
 *
 * The outbound sync paths (syncNodeToYjs / syncAllNodesToYjs) key Yjs by the
 * node's stable id but historically derived that id without recording it in
 * state. That left the `node:deleted` handler in bindCollabGraphEvents unable
 * to look up the remote key, so locally-created nodes could not be deleted
 * through the live graph-event bridge. Backfilling here makes the delete path
 * work without any caller change and with no effect on the Yjs keying (the
 * derived value is identical to the previous `?? stableIdForNode(node)` fallback).
 *
 * The root is intentionally not handled here: its mapping is owned by
 * `remoteRootStableId` and is pre-seeded by makeHostRootState / reconcileRemoteRoot.
 */
export function ensureRemoteMapping(
  state: GraphSyncState,
  node: SceneNode,
  remoteStableId = remoteNodeKeyForStableId(stableIdForNode(node))
): string {
  const existing = state.localToRemote.get(node.id)
  if (existing === remoteStableId) return existing
  if (existing !== undefined && state.remoteToLocal.get(existing) === node.id) {
    state.remoteToLocal.delete(existing)
  }
  state.localToRemote.set(node.id, remoteStableId)
  // Don't overwrite an existing reverse mapping that points to a different
  // node. Duplicate stable ids are handled by the importer's GUID remediation,
  // but this guard prevents the node:deleted handler from resolving to the
  // wrong local node if a duplicate ever slips through. The first node to
  // sync outbound wins the reverse mapping; subsequent nodes with the same
  // stable id still get a forward mapping (so their deletes can find the key)
  // but don't displace the canonical reverse mapping.
  if (state.remoteToLocal.get(remoteStableId) === undefined) {
    state.remoteToLocal.set(remoteStableId, node.id)
  }
  return remoteStableId
}

export function* addedOrUpdatedYnodes(
  events: Y.YEvent<Y.Map<unknown>>[],
  ynodes: YNodes
): Generator<{ remoteStableId: string; ynode: Y.Map<unknown> }> {
  for (const event of events) {
    if (event.target === ynodes) {
      for (const [remoteStableId, change] of event.changes.keys) {
        if (change.action === 'add' || change.action === 'update') {
          const ynode = ynodes.get(remoteStableId)
          if (ynode !== undefined) {
            yield { remoteStableId, ynode }
          }
        }
      }
    }
  }
}

export function stableIdForRuntimeId(
  graph: SceneGraph,
  state: GraphSyncState,
  runtimeId: string | null | undefined
): string | null {
  if (runtimeId === null || runtimeId === undefined) return null
  if (runtimeId === graph.rootId) return state.remoteRootStableId
  const mapped = state.localToRemote.get(runtimeId)
  if (mapped !== undefined) return mapped
  const node = graph.getNode(runtimeId)
  if (node === undefined) return null
  return remoteNodeKeyForStableId(stableIdForNode(node))
}

export function findNodeByStableId(graph: SceneGraph, stableId: string): SceneNode | undefined {
  const rawStableId = rawStableIdFromRemoteNodeKey(stableId)
  if (rawStableId === null) return undefined
  // Use the O(1) stable ID index when available
  const runtimeId = graph.identity.stableIdToRuntimeId(rawStableId)
  if (runtimeId !== undefined) {
    return graph.getNode(runtimeId)
  }
  // Fallback: linear scan for graphs without identity (e.g., test stubs)
  for (const node of graph.getAllNodes()) {
    if (stableIdForNode(node) === rawStableId) {
      if (IS_DEV) {
        findNodeByStableIdFallbackCount++
        if (findNodeByStableIdFallbackCount === FIND_NODE_FALLBACK_THRESHOLD) {
          console.warn(
            `[OpenPencil] findNodeByStableId: ${FIND_NODE_FALLBACK_THRESHOLD} fallback linear scans. ` +
              `The O(1) stable ID index is missing — ensure graph.identity.rebuildStableIdMap() is called.`
          )
        }
      }
      return node
    }
  }
  return undefined
}

export function findStableIdForYMap(ynodes: YNodes, ynode: Y.Map<unknown>): string | null {
  for (const [stableId, candidate] of ynodes.entries()) {
    if (candidate === ynode) return stableId
  }
  return null
}

export function toRuntimeId(
  graph: SceneGraph,
  state: GraphSyncState,
  stableId: string | null | undefined
): string | undefined {
  if (stableId === null || stableId === undefined) return undefined
  if (state.remoteRootStableId !== null && stableId === state.remoteRootStableId) {
    return graph.rootId
  }
  return state.remoteToLocal.get(stableId)
}
