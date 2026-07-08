import type { GUID, NodeChange } from '@open-pencil/kiwi/fig/codec'

import { remapComponentPropValue, remapGuid, type NodeChangeUpdates } from './shared'

interface VariableModeBySetMapEntry {
  variableSetID?: { guid?: GUID }
  variableModeID?: GUID
  variableSetExtensionID?: { guid?: GUID }
}

interface VariableModeBySetMapFields {
  variableModeBySetMap?: { entries?: VariableModeBySetMapEntry[] }
}

type VariableSetModeWithParents = NonNullable<NodeChange['variableSetModes']>[number] & {
  parentVariableSetId?: { guid?: GUID }
  parentModeId?: GUID
}

export function remapVariableEntries<
  T extends { variableData?: { value?: { alias?: { guid?: GUID } } } }
>(entries: T[], guidRemap: Map<string, string>): T[] | undefined {
  if (!entries.length) return undefined
  const result = entries.map((entry) => {
    const modeID =
      'modeID' in entry ? remapGuid(entry.modeID as GUID | undefined, guidRemap) : undefined
    const value = remapComponentPropValue(entry.variableData?.value, guidRemap)
    if (!modeID && !value) return entry
    return {
      ...entry,
      ...(modeID ? { modeID } : {}),
      ...(value
        ? {
            variableData: {
              ...entry.variableData,
              value
            }
          }
        : {})
    }
  })
  for (let i = 0; i < entries.length; i++) {
    if (result[i] !== entries[i]) return result
  }
  return undefined
}

function remapVariableModeBySetMap(
  map: VariableModeBySetMapFields['variableModeBySetMap'],
  guidRemap: Map<string, string>
): VariableModeBySetMapFields['variableModeBySetMap'] | undefined {
  if (!map?.entries?.length) return undefined
  const entries = map.entries.map((entry) => {
    const variableSetID = remapGuid(entry.variableSetID?.guid, guidRemap)
    const variableModeID = remapGuid(entry.variableModeID, guidRemap)
    const variableSetExtensionID = remapGuid(entry.variableSetExtensionID?.guid, guidRemap)
    if (!variableSetID && !variableModeID && !variableSetExtensionID) return entry
    return {
      ...entry,
      ...(variableSetID ? { variableSetID: { ...entry.variableSetID, guid: variableSetID } } : {}),
      ...(variableModeID ? { variableModeID } : {}),
      ...(variableSetExtensionID
        ? {
            variableSetExtensionID: {
              ...entry.variableSetExtensionID,
              guid: variableSetExtensionID
            }
          }
        : {})
    }
  })
  for (let i = 0; i < entries.length; i++) {
    if (entries[i] !== map.entries[i]) return { ...map, entries }
  }
  return undefined
}

export function remapVariableReferences(
  nc: NodeChange,
  guidRemap: Map<string, string>,
  updates: NodeChangeUpdates
): void {
  const variableSetId = remapGuid(nc.variableSetID?.guid, guidRemap)
  if (variableSetId) updates.variableSetID = { ...nc.variableSetID, guid: variableSetId }

  const consumptionEntries = remapVariableEntries(
    nc.variableConsumptionMap?.entries ?? [],
    guidRemap
  )
  if (consumptionEntries) updates.variableConsumptionMap = { entries: consumptionEntries }

  const parameterConsumptionMap = nc.parameterConsumptionMap as
    | NodeChange['variableConsumptionMap']
    | undefined
  const parameterConsumptionEntries = remapVariableEntries(
    parameterConsumptionMap?.entries ?? [],
    guidRemap
  )
  if (parameterConsumptionEntries)
    updates.parameterConsumptionMap = { entries: parameterConsumptionEntries }

  const dataValuesEntries = remapVariableEntries(nc.variableDataValues?.entries ?? [], guidRemap)
  if (dataValuesEntries) updates.variableDataValues = { entries: dataValuesEntries }

  const variableModeBySetMap = remapVariableModeBySetMap(
    (nc as VariableModeBySetMapFields).variableModeBySetMap,
    guidRemap
  )
  if (variableModeBySetMap) updates.variableModeBySetMap = variableModeBySetMap

  const variableDataValue = remapComponentPropValue(nc.variableData?.value, guidRemap)
  if (variableDataValue) updates.variableData = { ...nc.variableData, value: variableDataValue }

  const variableSetModes = nc.variableSetModes?.map((mode: VariableSetModeWithParents) => {
    const id = remapGuid(mode.id, guidRemap)
    const parentVariableSetId = remapGuid(mode.parentVariableSetId?.guid, guidRemap)
    const parentModeId = remapGuid(mode.parentModeId, guidRemap)
    if (!id && !parentVariableSetId && !parentModeId) return mode
    return {
      ...mode,
      ...(id ? { id } : {}),
      ...(parentVariableSetId
        ? { parentVariableSetId: { ...mode.parentVariableSetId, guid: parentVariableSetId } }
        : {}),
      ...(parentModeId ? { parentModeId } : {})
    }
  })
  if (variableSetModes?.some((mode, index) => mode !== nc.variableSetModes?.[index])) {
    updates.variableSetModes = variableSetModes
  }
}
