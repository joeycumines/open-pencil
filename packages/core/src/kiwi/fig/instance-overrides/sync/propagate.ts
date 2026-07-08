import type { SceneGraph } from '@open-pencil/scene-graph'

import { clearLookupCaches } from '#core/kiwi/fig/instance-overrides/cache'
import type { OverrideContext } from '#core/kiwi/fig/instance-overrides/types'

import { buildClonesMap, syncChildrenDeep } from './clones'
import { syncNodeProps } from './fields'

function expandSeedsToParents(graph: SceneGraph, seeds: Set<string>): Set<string> {
  const expanded = new Set(seeds)
  for (const seedId of seeds) {
    let cur = graph.getNode(seedId)
    while (cur?.parentId) {
      const parent = graph.getNode(cur.parentId)
      if (!parent) break
      if (parent.type === 'INSTANCE' || parent.type === 'COMPONENT') expanded.add(parent.id)
      cur = parent
    }
  }
  return expanded
}

function buildNeedsSyncSet(
  expandedSeeds: Set<string>,
  clonesOf: Map<string, string[]>
): Set<string> {
  const needsSync = new Set<string>()
  const queue = [...expandedSeeds]
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    const clones = clonesOf.get(id)
    if (!clones) continue
    for (const cloneId of clones) {
      if (needsSync.has(cloneId)) continue
      needsSync.add(cloneId)
      queue.push(cloneId)
    }
  }
  return needsSync
}

export function propagateOverridesTransitively(
  ctx: OverrideContext,
  seeds: Set<string>,
  protect?: Set<string>
): void {
  if (seeds.size === 0) return

  const { graph, swappedInstances } = ctx
  ctx.componentIdRoot.clear()
  const clonesOf = buildClonesMap(graph, ctx.activeNodeIds)
  const expandedSeeds = expandSeedsToParents(graph, seeds)
  const needsSync = buildNeedsSyncSet(expandedSeeds, clonesOf)
  const skip = protect && protect.size > 0 ? new Set([...seeds, ...protect]) : seeds

  const visited = new Set<string>()
  const syncQueue = [...expandedSeeds]
  let index = 0
  while (index < syncQueue.length) {
    const sourceId = syncQueue[index]
    index++
    const clones = clonesOf.get(sourceId)
    if (!clones) continue
    const source = graph.getNode(sourceId)
    if (!source) continue

    for (const cloneId of clones) {
      if (!needsSync.has(cloneId) || visited.has(cloneId)) continue
      visited.add(cloneId)
      const node = graph.getNode(cloneId)
      if (!node) continue

      if (skip.has(cloneId)) {
        syncQueue.push(cloneId)
        continue
      }

      syncNodeProps(graph, source, node, ctx.protectedFields)
      if (source.childIds.length !== node.childIds.length) {
        for (const childId of Array.from(node.childIds)) {
          graph.deleteNode(childId, { permanent: false })
        }
        if (source.childIds.length > 0) graph.populateInstanceChildren(node.id, sourceId)
        clearLookupCaches(ctx)
      } else if (source.childIds.length > 0 && node.childIds.length > 0) {
        if (
          syncChildrenDeep(graph, sourceId, node.id, swappedInstances, skip, ctx.protectedFields)
        ) {
          clearLookupCaches(ctx)
        }
      }
      syncQueue.push(cloneId)
    }
  }
}
