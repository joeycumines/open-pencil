import { joinOverrideKey, type SceneGraph, type SceneNode } from '@open-pencil/core/scene-graph'

import { findInstanceDescendantByStableId } from './instance-descendants'
import { stableIdForNode } from './mapping'
import { isPlainRecord } from './payload-validation'

export function mergeNestedInstanceOverridePath(
  graph: SceneGraph,
  currentInstance: SceneNode,
  currentOverrides: Record<string, unknown>,
  nestedInstanceStablePath: readonly string[] | undefined,
  childStableId: string,
  prop: string,
  value: unknown
): Record<string, unknown> | undefined {
  if (nestedInstanceStablePath === undefined || nestedInstanceStablePath.length === 0) {
    const child = findInstanceDescendantByStableId(graph, currentInstance, childStableId)
    const localChildStableId = child === undefined ? childStableId : stableIdForNode(child)
    return { ...currentOverrides, [joinOverrideKey(localChildStableId, prop)]: value }
  }

  const [nextStableId, ...remainingPath] = nestedInstanceStablePath
  const nestedInstance = findInstanceDescendantByStableId(graph, currentInstance, nextStableId)
  if (nestedInstance?.type !== 'INSTANCE') return undefined

  const nestedOverridesKey = joinOverrideKey(stableIdForNode(nestedInstance), 'overrides')
  const existingNestedOverrides = currentOverrides[nestedOverridesKey]
  const nestedOverrides = isPlainRecord(existingNestedOverrides)
    ? { ...existingNestedOverrides }
    : { ...nestedInstance.overrides }
  const mergedNestedOverrides = mergeNestedInstanceOverridePath(
    graph,
    nestedInstance,
    nestedOverrides,
    remainingPath,
    childStableId,
    prop,
    value
  )
  if (mergedNestedOverrides === undefined) return undefined
  return { ...currentOverrides, [nestedOverridesKey]: mergedNestedOverrides }
}
