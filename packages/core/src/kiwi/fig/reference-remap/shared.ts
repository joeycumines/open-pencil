import type { GUID, VariableAnyValue, VariableDataEntry } from '#core/kiwi/fig/codec'
import { stringToGuid } from '#core/kiwi/fig/identity'
import type { ComponentPropValue } from '#core/kiwi/fig/instance-overrides/types'
import { guidToString } from '#core/kiwi/fig/node-change/convert'

export type NodeChangeUpdates = Record<string, unknown>

interface RemappableValueFields {
  guidValue?: GUID
  alias?: { guid?: GUID }
  symbolIdValue?: { guid?: GUID }
}

export function remapGuid(
  guid: GUID | null | undefined,
  guidRemap: Map<string, string>
): GUID | undefined {
  if (!guid) return undefined
  const remapped = guidRemap.get(guidToString(guid))
  return remapped ? stringToGuid(remapped) : undefined
}

export function remapGuidArray(
  guids: GUID[] | undefined,
  guidRemap: Map<string, string>
): GUID[] | undefined {
  if (!guids?.length) return undefined
  const result = guids.map((guid) => {
    const remapped = remapGuid(guid, guidRemap)
    return remapped ?? guid
  })
  for (let i = 0; i < guids.length; i++) {
    if (result[i] !== guids[i]) return result
  }
  return undefined
}

export function remapComponentPropValue<T extends ComponentPropValue | VariableAnyValue>(
  value: T | undefined,
  guidRemap: Map<string, string>
): T | undefined {
  if (!value) return undefined
  const fields: T & RemappableValueFields = value
  const remappedGuidValue = remapGuid(fields.guidValue, guidRemap)
  const remappedAlias = remapGuid(fields.alias?.guid, guidRemap)
  const remappedSymbolId = remapGuid(fields.symbolIdValue?.guid, guidRemap)

  if (!remappedGuidValue && !remappedAlias && !remappedSymbolId) return undefined

  return {
    ...value,
    ...(remappedGuidValue ? { guidValue: remappedGuidValue } : {}),
    ...(remappedAlias ? { alias: { ...fields.alias, guid: remappedAlias } } : {}),
    ...(remappedSymbolId
      ? { symbolIdValue: { ...fields.symbolIdValue, guid: remappedSymbolId } }
      : {})
  }
}

export function remapVariableDataEntry(
  entry: VariableDataEntry | undefined,
  guidRemap: Map<string, string>
): VariableDataEntry | undefined {
  const value = remapComponentPropValue(entry?.value, guidRemap)
  return value ? { ...entry, value } : undefined
}
