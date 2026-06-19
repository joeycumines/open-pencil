import { omit } from 'es-toolkit/object'

import type { SceneGraph } from '#core/scene-graph'
import { registerInstanceIndex } from '#core/scene-graph/instances'
import type { NodeType, SceneNode } from '#core/scene-graph/types'

/**
 * Updates an existing node in place when `SceneGraph.createNode` restore mode
 * targets a runtime id already occupied by a node with matching identity (same
 * type and stable id — see `SceneGraphIdentity.pickRuntimeId`).
 *
 * Creating a fresh node in this case would overwrite the map entry (discarding
 * the existing node's children) and blindly append the id to the new parent's
 * `childIds`, leaving a duplicate entry when the parent is unchanged or a
 * dangling reference in the old parent when it moved — corrupting traversal,
 * ordering, selection, and hit-testing. This function instead:
 *
 *  - preserves the existing node's `childIds`,
 *  - repairs parent linkage so the id appears exactly once in the correct parent
 *    (and is removed from the old parent when it moves), and
 *  - applies property overrides through `graph.updateNode` (which handles source
 *    guards, instance-index updates, text-cache invalidation, and emits
 *    `node:updated`).
 *
 * Parent linkage is repaired BEFORE `updateNode` so the node is in its final
 * position when `node:updated` fires. If the parent changed, `node:reparented`
 * is emitted AFTER `updateNode` so consumers that track structural moves
 * (rather than just property updates) see the reparent with the correct
 * old/new parent ids.
 *
 * The instance index is re-registered after `updateNode` to guard against the
 * edge case where the index entry was cleared by a prior operation but the
 * node remained in the graph. `registerInstanceIndex` is idempotent (`Set.add`).
 */
export function restoreNodeInPlace(
  graph: SceneGraph,
  existing: SceneNode,
  type: NodeType,
  parentId: string,
  overrides: Partial<SceneNode>,
  stableId: string,
  runtimeId: string
): SceneNode {
  // Defensive: pickRuntimeId guarantees sameIdentity (same type + stable id).
  // Verify explicitly to convert a logic error in pickRuntimeId into a
  // detectable failure rather than silently applying mismatched overrides to
  // an unrelated node.
  if (existing.type !== type || graph.identity.getStableId(existing) !== stableId) {
    throw new Error(
      `restoreNodeInPlace: identity mismatch — runtime id ${runtimeId} is occupied by ` +
        `a node with type=${existing.type}, stable=${graph.identity.getStableId(existing)}, ` +
        `but requested type=${type}, stable=${stableId}. This indicates a bug in pickRuntimeId.`
    )
  }

  const oldParentId = existing.parentId
  if (oldParentId !== parentId) {
    const oldParent = oldParentId ? graph.nodes.get(oldParentId) : undefined
    if (oldParent) {
      oldParent.childIds = oldParent.childIds.filter((cid) => cid !== runtimeId)
    }
    existing.parentId = parentId
    const newParent = graph.nodes.get(parentId)
    if (newParent && !newParent.childIds.includes(runtimeId)) {
      newParent.childIds.push(runtimeId)
    }
    graph.clearAbsPosCache()
  } else {
    // Same parent: ensure the id appears exactly once (it normally already does).
    const parent = graph.nodes.get(parentId)
    if (parent && !parent.childIds.includes(runtimeId)) {
      parent.childIds.push(runtimeId)
    }
  }

  const source = graph.identity.buildSource(overrides, stableId)
  // Exclude childIds (preserved), id (immutable), parentId (repaired above), and
  // type (sameIdentity guarantees it already matches the existing node).
  const changes: Partial<SceneNode> = omit(overrides, ['childIds', 'id', 'parentId', 'type'])
  changes.source = source
  graph.updateNode(runtimeId, changes)

  // Ensure the instance index is correct. registerInstanceIndex is idempotent
  // (Set.add), so this is safe even if the node was already registered. This
  // covers the edge case where the index entry was cleared by a prior
  // operation but the node remained in the graph. Called after updateNode so
  // the node's componentId reflects any override changes.
  registerInstanceIndex(graph, existing)

  // Emit node:reparented when the parent changed, so consumers that track
  // structural changes (not just property updates) see the move. updateNode
  // already emitted node:updated for the property changes; node:reparented
  // provides the old/new parent ids that node:updated's changes omit.
  if (oldParentId !== parentId) {
    graph.emitter.emit('node:reparented', runtimeId, oldParentId, parentId)
  }

  return existing
}
