import type { GUID, NodeChange } from '#core/kiwi/fig/codec'

import { remapGuid, type NodeChangeUpdates } from './shared'

type HandoffStatusMapEntry = Record<string, unknown> & {
  guid?: GUID
}

interface HandoffStatusMapFields {
  handoffStatusMap?: {
    entries?: HandoffStatusMapEntry[]
  }
}

function remapHandoffStatusMap(
  map: HandoffStatusMapFields['handoffStatusMap'],
  guidRemap: Map<string, string>
): HandoffStatusMapFields['handoffStatusMap'] | undefined {
  if (!map?.entries?.length) return undefined
  const entries = map.entries.map((entry) => {
    const guid = remapGuid(entry.guid, guidRemap)
    return guid ? { ...entry, guid } : entry
  })
  for (let i = 0; i < map.entries.length; i++) {
    if (entries[i] !== map.entries[i]) return { ...map, entries }
  }
  return undefined
}

export function remapRawPayloadReferences(
  nc: NodeChange,
  guidRemap: Map<string, string>,
  updates: NodeChangeUpdates
): void {
  const handoffStatusMap = remapHandoffStatusMap(
    (nc as HandoffStatusMapFields).handoffStatusMap,
    guidRemap
  )
  if (handoffStatusMap) updates.handoffStatusMap = handoffStatusMap
}
