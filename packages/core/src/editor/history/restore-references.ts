import {
  joinOverrideKey,
  splitOverrideKey,
  type SceneGraph,
  type SceneNode
} from '#core/scene-graph'

type RestoredReferenceMaps = {
  runtimeBySnapshotId: Map<string, string>
  stableBySnapshotId: Map<string, string>
  restoredIds: Set<string>
}

type RemapResult<T> = {
  value: T
  changed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function addSnapshotAliases(
  maps: RestoredReferenceMaps,
  graph: SceneGraph,
  snapshot: SceneNode,
  restored: SceneNode
): void {
  const stableId = graph.identity.getStableId(restored)
  maps.runtimeBySnapshotId.set(snapshot.id, restored.id)
  maps.stableBySnapshotId.set(snapshot.id, stableId)

  const sourceId = snapshot.source.id
  if (sourceId && !maps.runtimeBySnapshotId.has(sourceId)) {
    // Component-backed instance descendants intentionally share source.id with
    // their backing component nodes. Keep the first snapshot traversal owner so
    // references to the backing component child do not get overwritten by the
    // populated instance child clone.
    maps.runtimeBySnapshotId.set(sourceId, restored.id)
    maps.stableBySnapshotId.set(sourceId, stableId)
  }
  maps.restoredIds.add(restored.id)
}

function buildRestoredReferenceMaps(
  graph: SceneGraph,
  snapshots: Iterable<SceneNode>,
  oldToNew: ReadonlyMap<string, string>
): RestoredReferenceMaps {
  const maps: RestoredReferenceMaps = {
    runtimeBySnapshotId: new Map(),
    stableBySnapshotId: new Map(),
    restoredIds: new Set()
  }

  for (const snapshot of snapshots) {
    const restoredId = oldToNew.get(snapshot.id)
    const restored = restoredId ? graph.getNode(restoredId) : undefined
    if (restored) addSnapshotAliases(maps, graph, snapshot, restored)
  }

  return maps
}

function remapBindingRecord(
  bindings: Record<string, string>,
  maps: RestoredReferenceMaps
): RemapResult<Record<string, string>> {
  const remapped: Record<string, string> = {}
  let changed = false

  for (const [field, variableId] of Object.entries(bindings)) {
    const nextId = maps.runtimeBySnapshotId.get(variableId) ?? variableId
    remapped[field] = nextId
    changed ||= nextId !== variableId
  }

  return { value: remapped, changed }
}

function remapUnknownBindingRecord(
  bindings: Record<string, unknown>,
  maps: RestoredReferenceMaps
): RemapResult<Record<string, unknown>> {
  const remapped: Record<string, unknown> = {}
  let changed = false

  for (const [field, variableId] of Object.entries(bindings)) {
    const nextId =
      typeof variableId === 'string' ? maps.runtimeBySnapshotId.get(variableId) : undefined
    remapped[field] = nextId ?? structuredClone(variableId)
    changed ||= nextId !== undefined && nextId !== variableId
  }

  return { value: remapped, changed }
}

function remapOverrideValue(
  prop: string,
  value: unknown,
  maps: RestoredReferenceMaps
): RemapResult<unknown> {
  if (prop === 'overrides' && isRecord(value)) {
    return remapOverrideRecord(value, maps)
  }
  if (prop === 'boundVariables' && isRecord(value)) {
    return remapUnknownBindingRecord(value, maps)
  }
  return { value: structuredClone(value), changed: false }
}

function remapOverrideRecord(
  overrides: Record<string, unknown>,
  maps: RestoredReferenceMaps
): RemapResult<Record<string, unknown>> {
  const remapped: Record<string, unknown> = {}
  let changed = false

  for (const [key, value] of Object.entries(overrides)) {
    const { childId, prop } = splitOverrideKey(key)
    const valueResult = remapOverrideValue(prop, value, maps)

    if (!childId || prop === key) {
      remapped[key] = valueResult.value
      changed ||= valueResult.changed
      continue
    }

    const nextChildId = maps.stableBySnapshotId.get(childId) ?? childId
    const nextKey = nextChildId === childId ? key : joinOverrideKey(nextChildId, prop)
    remapped[nextKey] = valueResult.value
    changed ||= nextKey !== key || valueResult.changed
  }

  return { value: remapped, changed }
}

/**
 * Restore helpers may allocate fresh runtime IDs when a snapshot's old runtime ID
 * is occupied by another node. Parent recursion and selection use the returned
 * old-to-new map, but restored node internals can also point back into the same
 * snapshot set. This pass runs after all restored IDs are known and rewrites
 * those internal references to the actual restored nodes.
 */
export function remapRestoredSnapshotReferences(
  graph: SceneGraph,
  snapshots: Iterable<SceneNode>,
  oldToNew: ReadonlyMap<string, string>
): void {
  const maps = buildRestoredReferenceMaps(graph, snapshots, oldToNew)
  if (maps.restoredIds.size === 0) return

  for (const restoredId of maps.restoredIds) {
    const node = graph.getNode(restoredId)
    if (!node) continue

    const changes: Partial<SceneNode> = {}
    const remappedComponentId = node.componentId
      ? maps.runtimeBySnapshotId.get(node.componentId)
      : undefined
    if (remappedComponentId && remappedComponentId !== node.componentId) {
      changes.componentId = remappedComponentId
    }

    if (Object.keys(node.boundVariables).length > 0) {
      const boundVariables = remapBindingRecord(node.boundVariables, maps)
      if (boundVariables.changed) changes.boundVariables = boundVariables.value
    }

    if (node.type === 'INSTANCE' && Object.keys(node.overrides).length > 0) {
      const overrides = remapOverrideRecord(node.overrides, maps)
      if (overrides.changed) changes.overrides = overrides.value
    }

    if (Object.keys(changes).length > 0) graph.updateNode(node.id, changes)
  }
}
