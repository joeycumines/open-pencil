import { FIGMA_SESSION_IMPORTED, guidToString, parseGuidOrNull } from '@open-pencil/kiwi/fig/guid'
import type { FigExportDiagnostics, SceneGraph, SourceMetadata } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

interface ImportedGuidMax {
  session0: number
  session1: number
}

function recordImportedGuidMax(
  source: SourceMetadata | null | undefined,
  max: ImportedGuidMax
): void {
  const guid = parseGuidOrNull(reusableFigSourceId(source))
  if (!guid) return
  if (guid.sessionID === 0 && guid.localID > max.session0) max.session0 = guid.localID
  if (guid.sessionID === 1 && guid.localID > max.session1) max.session1 = guid.localID
}

function mintExportGuid(localIdCounter: { value: number }, assignedGuidValues: Set<string>): GUID {
  for (;;) {
    const guid = { sessionID: FIGMA_SESSION_IMPORTED, localID: localIdCounter.value++ }
    const key = guidToString(guid)
    if (!assignedGuidValues.has(key)) {
      assignedGuidValues.add(key)
      return guid
    }
  }
}

export function reuseOrMintGuid(
  sourceId: string | null | undefined,
  localIdCounter: { value: number },
  assignedGuidValues: Set<string>,
  diagnostics?: FigExportDiagnostics
): GUID {
  if (sourceId) {
    const imported = parseGuidOrNull(sourceId)
    if (imported) {
      const key = guidToString(imported)
      if (!assignedGuidValues.has(key)) {
        assignedGuidValues.add(key)
        diagnostics?.reusedGuids.push(key)
        return imported
      }
      const minted = mintExportGuid(localIdCounter, assignedGuidValues)
      diagnostics?.mintedGuids.push({
        reason: 'collision',
        sourceId,
        assigned: guidToString(minted)
      })
      return minted
    }
  }
  const minted = mintExportGuid(localIdCounter, assignedGuidValues)
  diagnostics?.mintedGuids.push({
    reason: 'missing',
    sourceId: sourceId ?? null,
    assigned: guidToString(minted)
  })
  return minted
}

export function reusableFigSourceId(source: SourceMetadata | null | undefined): string | null {
  return source?.format === 'fig' ? source.id : null
}

/**
 * Scan imported source IDs and advance the counter past session 0/1 IDs.
 * Invalid or non-fig source IDs are not reusable Figma GUIDs and are ignored.
 */
export function advanceCounterPastImportedGuids(
  graph: SceneGraph,
  localIdCounter: { value: number }
): void {
  const max: ImportedGuidMax = {
    session0: localIdCounter.value - 1,
    session1: localIdCounter.value - 1
  }
  for (const node of graph.nodes.values()) {
    recordImportedGuidMax(node.source, max)
  }
  for (const collection of graph.variableCollections.values()) {
    recordImportedGuidMax(collection.source, max)
    for (const mode of collection.modes) recordImportedGuidMax(mode.source, max)
  }
  for (const variable of graph.variables.values()) {
    recordImportedGuidMax(variable.source, max)
  }
  localIdCounter.value = Math.max(localIdCounter.value, max.session0 + 1, max.session1 + 1)
}
