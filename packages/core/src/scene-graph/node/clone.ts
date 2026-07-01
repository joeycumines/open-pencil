import type { SceneGraph } from '#core/scene-graph'
import { cloneNodeProps } from '#core/scene-graph/copy'
import { createDefaultSource } from '#core/scene-graph/node/defaults'
import { joinOverrideKey, splitOverrideKey } from '#core/scene-graph/override-key'
import type { SceneNode, SourceMetadata } from '#core/scene-graph/types'

interface CloneState {
  runtimeMap: Map<string, string>
}

interface StableClonePair {
  sourceId: string
  cloneStableId: string
}

type OverrideRecordRemap = readonly [overrides: Record<string, unknown>, changed: boolean]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneTreeInner(
  graph: SceneGraph,
  sourceId: string,
  parentId: string,
  overrides: Partial<SceneNode>,
  state: CloneState
): SceneNode | null {
  const src = graph.nodes.get(sourceId)
  if (!src) return null

  const props = cloneNodeProps(src, null)
  // Null out Figma source identifiers so the clone is treated as local.
  const baseSource: SourceMetadata = props.source ?? createDefaultSource()
  props.source = { ...baseSource, id: null, orderKey: null }
  const clone = graph.createNode(src.type, parentId, { ...props, ...overrides })
  state.runtimeMap.set(sourceId, clone.id)

  for (const childId of src.childIds) {
    cloneTreeInner(graph, childId, clone.id, {}, state)
  }

  return clone
}

function pushStableClonePair(
  index: Map<string, StableClonePair[]>,
  sourceKey: string,
  pair: StableClonePair
): void {
  const existing = index.get(sourceKey)
  if (existing) {
    existing.push(pair)
  } else {
    index.set(sourceKey, [pair])
  }
}

function descendantStableClonePairs(
  graph: SceneGraph,
  sourceRootId: string,
  runtimeMap: ReadonlyMap<string, string>
): Map<string, StableClonePair[]> {
  const index = new Map<string, StableClonePair[]>()
  const visit = (sourceParentId: string): void => {
    const sourceParent = graph.nodes.get(sourceParentId)
    if (!sourceParent) return

    for (const sourceChildId of sourceParent.childIds) {
      const sourceChild = graph.nodes.get(sourceChildId)
      const cloneChildId = runtimeMap.get(sourceChildId)
      const cloneChild = cloneChildId ? graph.nodes.get(cloneChildId) : undefined
      if (sourceChild && cloneChild) {
        const pair = {
          sourceId: sourceChild.id,
          cloneStableId: graph.identity.getStableId(cloneChild)
        }
        const sourceStableId = graph.identity.getStableId(sourceChild)
        pushStableClonePair(index, sourceStableId, pair)
        if (sourceChild.id !== sourceStableId) {
          pushStableClonePair(index, sourceChild.id, pair)
        }
      }
      visit(sourceChildId)
    }
  }
  visit(sourceRootId)
  return index
}

function remapOverrideRecord(
  graph: SceneGraph,
  sourceContextId: string,
  runtimeMap: ReadonlyMap<string, string>,
  overrides: Record<string, unknown>
): OverrideRecordRemap {
  const pairsByStableId = descendantStableClonePairs(graph, sourceContextId, runtimeMap)
  const remapped: Record<string, unknown> = {}
  let changed = false

  for (const [key, value] of Object.entries(overrides)) {
    const { childId, prop } = splitOverrideKey(key)
    if (!childId || prop === key) {
      remapped[key] = structuredClone(value)
      continue
    }

    const pairs = pairsByStableId.get(childId)
    if (!pairs) {
      remapped[key] = structuredClone(value)
      continue
    }

    for (const pair of pairs) {
      const nested =
        prop === 'overrides' && isRecord(value)
          ? remapOverrideRecord(graph, pair.sourceId, runtimeMap, value)
          : undefined
      const nextKey = joinOverrideKey(pair.cloneStableId, prop)
      remapped[nextKey] = nested?.[0] ?? structuredClone(value)
      changed ||= nextKey !== key || nested?.[1] === true
    }
  }

  return [remapped, changed]
}

function remapClonedInstanceOverrides(
  graph: SceneGraph,
  runtimeMap: ReadonlyMap<string, string>
): void {
  for (const [sourceId, cloneId] of runtimeMap) {
    const source = graph.nodes.get(sourceId)
    const clone = graph.nodes.get(cloneId)
    if (source?.type !== 'INSTANCE' || clone?.type !== 'INSTANCE') continue
    if (Object.keys(clone.overrides).length === 0) continue
    const remapped = remapOverrideRecord(graph, source.id, runtimeMap, clone.overrides)
    if (remapped[1]) {
      graph.updateNode(clone.id, { overrides: remapped[0] })
    }
  }
}

function remapClonedComponentIds(graph: SceneGraph, runtimeMap: ReadonlyMap<string, string>): void {
  for (const cloneId of runtimeMap.values()) {
    const clone = graph.nodes.get(cloneId)
    if (!clone?.componentId) continue
    const clonedComponentId = runtimeMap.get(clone.componentId)
    if (clonedComponentId) graph.updateNode(clone.id, { componentId: clonedComponentId })
  }
}

export function cloneTree(
  graph: SceneGraph,
  sourceId: string,
  parentId: string,
  overrides: Partial<SceneNode> = {}
): SceneNode | null {
  const state: CloneState = { runtimeMap: new Map() }
  const clone = cloneTreeInner(graph, sourceId, parentId, overrides, state)
  if (clone) {
    remapClonedComponentIds(graph, state.runtimeMap)
    remapClonedInstanceOverrides(graph, state.runtimeMap)
  }
  return clone
}
