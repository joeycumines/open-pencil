import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { createDefaultSource } from '@open-pencil/scene-graph'
import type { SourceMetadata } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import { guidToString, stringToGuid } from '#core/kiwi/fig/node-change/convert'

export const mintFigmaSourceMetadata = (id: string, orderKey: string | null): SourceMetadata => ({
  ...createDefaultSource(),
  format: 'fig',
  id,
  orderKey
})

export function findDocumentId(nodeChanges: NodeChange[]): string | undefined {
  for (const nc of nodeChanges) {
    if (nc.type === 'DOCUMENT' && nc.guid) return guidToString(nc.guid)
  }
  return undefined
}

export function collectImportedRuntimeIds(nodeChanges: NodeChange[]): string[] {
  const ids = new Set<string>()

  for (const nc of nodeChanges) {
    const add = (guid: GUID | null | undefined): void => {
      if (guid) ids.add(guidToString(guid))
    }

    add(nc.guid)
    add(nc.parentIndex?.guid)
    add(nc.variableSetID?.guid)
    const overrideKey = nc.overrideKey
    if (
      overrideKey &&
      typeof overrideKey === 'object' &&
      'sessionID' in overrideKey &&
      'localID' in overrideKey
    ) {
      ids.add(guidToString(overrideKey as GUID))
    }
    const symbolData = nc.symbolData as { symbolID?: GUID } | undefined
    add(symbolData?.symbolID)
    for (const mode of nc.variableSetModes ?? []) add(mode.id)
    for (const entry of nc.variableDataValues?.entries ?? []) add(entry.modeID)
    for (const entry of nc.variableConsumptionMap?.entries ?? [])
      add(entry.variableData?.value?.alias?.guid)
  }

  return [...ids]
}

export { stringToGuid }
