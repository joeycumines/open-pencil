import type { SceneGraph } from './'
import { joinOverrideKey, splitOverrideKey } from './override-key'

interface OverrideMigration {
  overrides: Record<string, unknown>
  changed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function migrateOverrideRecord(
  graph: SceneGraph,
  overrides: Record<string, unknown>
): OverrideMigration {
  const remapped: Record<string, unknown> = {}
  let changed = false

  for (const [key, value] of Object.entries(overrides)) {
    const { childId, prop } = splitOverrideKey(key)

    // Bare keys (INSTANCE-self properties like "boundVariables") — no child ID
    if (!childId || prop === key) {
      remapped[key] = value
      continue
    }

    const nested =
      prop === 'overrides' && isRecord(value) ? migrateOverrideRecord(graph, value) : undefined
    const childNode = graph.getNode(childId)
    const stableId = childNode ? graph.identity.getStableId(childNode) : childId
    const nextKey = stableId === childId ? key : joinOverrideKey(stableId, prop)
    remapped[nextKey] = nested?.overrides ?? value
    changed ||= nextKey !== key || nested?.changed === true
  }

  return { overrides: remapped, changed }
}

/**
 * Convert override keys from runtime-ID format to stable-ID format.
 *
 * Idempotent: running on already-migrated keys is a no-op.
 * Transparent for locally-created nodes (source.id === node.id).
 *
 * Must be called after migrateLegacySourceIds() and recomputeReservedRuntimeIds().
 */
export function migrateOverrideKeys(graph: SceneGraph): void {
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'INSTANCE') continue
    if (Object.keys(node.overrides).length === 0) continue

    const migrated = migrateOverrideRecord(graph, node.overrides)
    if (migrated.changed) {
      node.overrides = migrated.overrides
    }
  }
}
