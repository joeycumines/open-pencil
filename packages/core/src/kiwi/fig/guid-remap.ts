import type { NodeChange, GUID } from '#core/kiwi/fig/codec'
import { stringToGuid } from '#core/kiwi/fig/identity'
import { guidToString } from '#core/kiwi/fig/node-change/convert'

/**
 * Look up a GUID in the remap table. Returns the remapped GUID string or
 * undefined if no remapping exists.
 */
function remapGuidString(
  guid: GUID | null | undefined,
  guidRemap: Map<string, string>
): string | undefined {
  if (!guid) return undefined
  return guidRemap.get(guidToString(guid))
}

/**
 * Remap alias GUID references in a variable data entries array.
 * Used for both variableConsumptionMap and variableDataValues entries.
 * Returns the remapped array, or undefined if no entries were changed.
 */
function remapVariableEntries<T extends { variableData?: { value?: { alias?: { guid?: GUID } } } }>(
  entries: T[],
  guidRemap: Map<string, string>
): T[] | undefined {
  if (!entries.length) return undefined
  const result = entries.map((entry) => {
    const alias = entry.variableData?.value?.alias
    if (!alias?.guid) return entry
    const newAliasId = remapGuidString(alias.guid, guidRemap)
    if (!newAliasId) return entry
    return {
      ...entry,
      variableData: {
        ...entry.variableData,
        value: {
          ...entry.variableData?.value,
          alias: { ...alias, guid: stringToGuid(newAliasId) }
        }
      }
    }
  })
  // Check if any entry was actually changed (reference comparison)
  for (let i = 0; i < entries.length; i++) {
    if (result[i] !== entries[i]) return result
  }
  return undefined
}

/**
 * Remap all GUID references in a NodeChange using the guidRemap map.
 * This ensures that when a duplicate GUID is remediated (old → synthetic),
 * all references to the old GUID in subsequent NodeChanges are rewritten
 * to point to the synthetic GUID.
 *
 * The timing matters: this is called during the first pass, so only
 * remediations that have already been processed are in the map. In .fig
 * files, parents precede children and components precede instances in
 * the NodeChanges array, so this correctly associates descendants and
 * references with their remediated parent/component/collection.
 */
export function remapNodeChangeReferences(
  nc: NodeChange,
  guidRemap: Map<string, string>
): NodeChange {
  if (guidRemap.size === 0) return nc

  const updates: Record<string, unknown> = {}

  // parentIndex.guid — children of a remediated node
  const newPid = remapGuidString(nc.parentIndex?.guid, guidRemap)
  if (newPid) updates.parentIndex = { ...nc.parentIndex, guid: stringToGuid(newPid) }

  // symbolData.symbolID — instances referencing a remediated component
  const sd = nc.symbolData as { symbolID?: GUID } | undefined
  const newSymId = remapGuidString(sd?.symbolID, guidRemap)
  if (newSymId) updates.symbolData = { ...sd, symbolID: stringToGuid(newSymId) }

  // variableSetID.guid — variables referencing a remediated collection
  const newVarSetId = remapGuidString(nc.variableSetID?.guid, guidRemap)
  if (newVarSetId) updates.variableSetID = { ...nc.variableSetID, guid: stringToGuid(newVarSetId) }

  // overrideKey — GUID reference to a remediated node
  const overrideKey = nc.overrideKey
  if (
    overrideKey &&
    typeof overrideKey === 'object' &&
    'sessionID' in overrideKey &&
    'localID' in overrideKey
  ) {
    const newOverrideKey = guidRemap.get(guidToString(overrideKey as GUID))
    if (newOverrideKey) updates.overrideKey = stringToGuid(newOverrideKey)
  }

  // variableConsumptionMap entries — alias GUIDs
  const newConsumptionEntries = remapVariableEntries(
    nc.variableConsumptionMap?.entries ?? [],
    guidRemap
  )
  if (newConsumptionEntries) updates.variableConsumptionMap = { entries: newConsumptionEntries }

  // variableDataValues entries — alias GUIDs
  const newDataValuesEntries = remapVariableEntries(nc.variableDataValues?.entries ?? [], guidRemap)
  if (newDataValuesEntries) updates.variableDataValues = { entries: newDataValuesEntries }

  if (Object.keys(updates).length === 0) return nc
  return { ...nc, ...updates }
}
