import type { SceneGraph } from './'
import { splitOverrideKey } from './override-key'

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
    const entries = Object.entries(node.overrides)
    if (entries.length === 0) continue

    const remapped: Record<string, unknown> = {}
    let changed = false

    for (const [key, value] of entries) {
      const { childId, prop } = splitOverrideKey(key)

      // Bare keys (INSTANCE-self properties like "boundVariables") — no child ID
      if (!childId || prop === key) {
        remapped[key] = value
        continue
      }

      // Check if childId is a runtime ID that differs from the stable ID
      const childNode = graph.getNode(childId)
      if (childNode) {
        const stableId = graph.identity.getStableId(childNode)
        if (stableId !== childId) {
          // Old format: runtime ID key → convert to stable ID
          remapped[`${stableId}:${prop}`] = value
          changed = true
          continue
        }
      }

      // Already stable-ID format or orphaned (child not in graph) — pass through
      remapped[key] = value
    }

    if (changed) {
      node.overrides = remapped
    }
  }
}
