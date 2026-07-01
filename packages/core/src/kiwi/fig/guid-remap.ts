import type { Effect, NodeChange, GUID, Paint, VariableDataEntry } from '#core/kiwi/fig/codec'
import type {
  ComponentPropAssignment,
  ComponentPropDef,
  ComponentPropRef,
  DerivedSymbolOverride,
  SymbolData,
  SymbolOverride
} from '#core/kiwi/fig/instance-overrides/types'
import { remapPrototypeReferences } from '#core/kiwi/fig/reference-remap/prototype'
import { remapRawPayloadReferences } from '#core/kiwi/fig/reference-remap/raw'
import {
  remapComponentPropValue,
  remapGuid,
  remapGuidArray,
  remapVariableDataEntry,
  type NodeChangeUpdates
} from '#core/kiwi/fig/reference-remap/shared'
import {
  remapVariableEntries,
  remapVariableReferences
} from '#core/kiwi/fig/reference-remap/variables'

interface StyleReferenceFields {
  styleIdForFill?: { guid?: GUID }
  styleIdForStrokeFill?: { guid?: GUID }
  styleIdForText?: { guid?: GUID }
  styleIdForEffect?: { guid?: GUID }
  styleIdForGrid?: { guid?: GUID }
}

interface PaintFields {
  fillPaints?: Paint[]
  strokePaints?: Paint[]
  backgroundPaints?: Paint[]
  textDecorationFillPaints?: Paint[]
}

interface PaintColorStopVar {
  colorVar?: VariableDataEntry
}

type PaintWithVariableData = Paint & {
  id?: GUID
  opacityVar?: VariableDataEntry
  colorVar?: VariableDataEntry
  imageVar?: VariableDataEntry
  stopsVar?: PaintColorStopVar[]
  componentPropAssignments?: ComponentPropAssignment[]
}

interface EffectFields {
  effects?: Effect[]
}

interface LayoutGridFields {
  layoutGrids?: unknown[]
}

const LAYOUT_GRID_VARIABLE_DATA_FIELDS = [
  'numSectionsVar',
  'offsetVar',
  'sectionSizeVar',
  'gutterSizeVar'
] as const

type LayoutGridVariableDataField = (typeof LAYOUT_GRID_VARIABLE_DATA_FIELDS)[number]

type LayoutGridWithVariableData = Record<string, unknown> &
  Partial<Record<LayoutGridVariableDataField, VariableDataEntry>>

const EFFECT_VARIABLE_DATA_FIELDS = [
  'radiusVar',
  'colorVar',
  'spreadVar',
  'xVar',
  'yVar',
  'refractionRadiusVar',
  'specularAngleVar',
  'specularIntensityVar',
  'chromaticAberrationVar',
  'splayVar',
  'refractionIntensityVar',
  'startRadiusVar',
  'startOffsetXVar',
  'startOffsetYVar',
  'endOffsetXVar',
  'endOffsetYVar',
  'noiseSizeXVar',
  'noiseSizeYVar',
  'densityVar',
  'effectOpacityVar',
  'secondaryColorVar'
] as const

type EffectVariableDataField = (typeof EFFECT_VARIABLE_DATA_FIELDS)[number]

type EffectWithGuidPayloads = Effect & {
  id?: GUID
  customEffectId?: { guid?: GUID }
  componentPropAssignments?: ComponentPropAssignment[]
} & Partial<Record<EffectVariableDataField, VariableDataEntry>>

interface TextDataWithStyleOverrideTable {
  styleOverrideTable?: NodeChange[]
}

function remapStyleReferenceFields(
  fields: StyleReferenceFields,
  guidRemap: Map<string, string>
): Partial<StyleReferenceFields> | undefined {
  const fillGuid = remapGuid(fields.styleIdForFill?.guid, guidRemap)
  const strokeFillGuid = remapGuid(fields.styleIdForStrokeFill?.guid, guidRemap)
  const textGuid = remapGuid(fields.styleIdForText?.guid, guidRemap)
  const effectGuid = remapGuid(fields.styleIdForEffect?.guid, guidRemap)
  const gridGuid = remapGuid(fields.styleIdForGrid?.guid, guidRemap)

  if (!fillGuid && !strokeFillGuid && !textGuid && !effectGuid && !gridGuid) return undefined

  return {
    ...(fillGuid ? { styleIdForFill: { ...fields.styleIdForFill, guid: fillGuid } } : {}),
    ...(strokeFillGuid
      ? { styleIdForStrokeFill: { ...fields.styleIdForStrokeFill, guid: strokeFillGuid } }
      : {}),
    ...(textGuid ? { styleIdForText: { ...fields.styleIdForText, guid: textGuid } } : {}),
    ...(effectGuid ? { styleIdForEffect: { ...fields.styleIdForEffect, guid: effectGuid } } : {}),
    ...(gridGuid ? { styleIdForGrid: { ...fields.styleIdForGrid, guid: gridGuid } } : {})
  }
}

function remapPaintColorStopVars(
  stopsVar: PaintColorStopVar[] | undefined,
  guidRemap: Map<string, string>
): PaintColorStopVar[] | undefined {
  if (!stopsVar?.length) return undefined
  const result = stopsVar.map((stop) => {
    const colorVar = remapVariableDataEntry(stop.colorVar, guidRemap)
    return colorVar ? { ...stop, colorVar } : stop
  })
  for (let i = 0; i < stopsVar.length; i++) {
    if (result[i] !== stopsVar[i]) return result
  }
  return undefined
}

function remapPaint(paint: Paint, guidRemap: Map<string, string>): Paint {
  const fields = paint as PaintWithVariableData
  const updates: Partial<PaintWithVariableData> = {}
  const id = remapGuid(fields.id, guidRemap)
  const sourceNodeId = remapGuid(fields.sourceNodeId, guidRemap)
  const customEffectId = remapGuid(fields.customEffectId?.guid, guidRemap)
  const colorVariableBinding = remapGuid(fields.colorVariableBinding?.variableID, guidRemap)
  const opacityVar = remapVariableDataEntry(fields.opacityVar, guidRemap)
  const colorVar = remapVariableDataEntry(fields.colorVar, guidRemap)
  const imageVar = remapVariableDataEntry(fields.imageVar, guidRemap)
  const stopsVar = remapPaintColorStopVars(fields.stopsVar, guidRemap)
  const componentPropAssignments = remapComponentPropAssignments(
    fields.componentPropAssignments,
    guidRemap
  )

  if (id) updates.id = id
  if (sourceNodeId) updates.sourceNodeId = sourceNodeId
  if (customEffectId) updates.customEffectId = { ...fields.customEffectId, guid: customEffectId }
  if (colorVariableBinding)
    updates.colorVariableBinding = {
      ...fields.colorVariableBinding,
      variableID: colorVariableBinding
    }
  if (opacityVar) updates.opacityVar = opacityVar
  if (colorVar) updates.colorVar = colorVar
  if (imageVar) updates.imageVar = imageVar
  if (stopsVar) updates.stopsVar = stopsVar
  if (componentPropAssignments) updates.componentPropAssignments = componentPropAssignments

  return Object.keys(updates).length === 0 ? paint : { ...fields, ...updates }
}

function remapPaints(
  paints: Paint[] | undefined,
  guidRemap: Map<string, string>
): Paint[] | undefined {
  if (!paints?.length) return undefined
  const result = paints.map((paint) => remapPaint(paint, guidRemap))
  for (let i = 0; i < paints.length; i++) {
    if (result[i] !== paints[i]) return result
  }
  return undefined
}

function remapPaintFields(
  fields: PaintFields,
  guidRemap: Map<string, string>
): Partial<PaintFields> | undefined {
  const fillPaints = remapPaints(fields.fillPaints, guidRemap)
  const strokePaints = remapPaints(fields.strokePaints, guidRemap)
  const backgroundPaints = remapPaints(fields.backgroundPaints, guidRemap)
  const textDecorationFillPaints = remapPaints(fields.textDecorationFillPaints, guidRemap)

  if (!fillPaints && !strokePaints && !backgroundPaints && !textDecorationFillPaints)
    return undefined

  return {
    ...(fillPaints ? { fillPaints } : {}),
    ...(strokePaints ? { strokePaints } : {}),
    ...(backgroundPaints ? { backgroundPaints } : {}),
    ...(textDecorationFillPaints ? { textDecorationFillPaints } : {})
  }
}

function remapEffect(effect: Effect, guidRemap: Map<string, string>): Effect {
  const fields = effect as EffectWithGuidPayloads
  const id = remapGuid(fields.id, guidRemap)
  const customEffectId = remapGuid(fields.customEffectId?.guid, guidRemap)
  const componentPropAssignments = remapComponentPropAssignments(
    fields.componentPropAssignments,
    guidRemap
  )
  const variableDataUpdates: Partial<Record<EffectVariableDataField, VariableDataEntry>> = {}

  for (const field of EFFECT_VARIABLE_DATA_FIELDS) {
    const variableData = fields[field]
    const value = remapComponentPropValue(variableData?.value, guidRemap)
    if (value) variableDataUpdates[field] = { ...variableData, value }
  }

  if (
    !id &&
    !customEffectId &&
    !componentPropAssignments &&
    Object.keys(variableDataUpdates).length === 0
  )
    return effect

  return {
    ...effect,
    ...variableDataUpdates,
    ...(id ? { id } : {}),
    ...(customEffectId
      ? { customEffectId: { ...fields.customEffectId, guid: customEffectId } }
      : {}),
    ...(componentPropAssignments ? { componentPropAssignments } : {})
  }
}

function remapEffects(
  effects: Effect[] | undefined,
  guidRemap: Map<string, string>
): Effect[] | undefined {
  if (!effects?.length) return undefined
  const result = effects.map((effect) => remapEffect(effect, guidRemap))
  for (let i = 0; i < effects.length; i++) {
    if (result[i] !== effects[i]) return result
  }
  return undefined
}

function remapEffectFields(
  fields: EffectFields,
  guidRemap: Map<string, string>
): Partial<EffectFields> | undefined {
  const effects = remapEffects(fields.effects, guidRemap)
  return effects ? { effects } : undefined
}

function remapLayoutGrid(grid: unknown, guidRemap: Map<string, string>): unknown {
  if (!grid || typeof grid !== 'object') return grid

  const fields = grid as LayoutGridWithVariableData
  const variableDataUpdates: Partial<Record<LayoutGridVariableDataField, VariableDataEntry>> = {}
  for (const field of LAYOUT_GRID_VARIABLE_DATA_FIELDS) {
    const variableData = remapVariableDataEntry(fields[field], guidRemap)
    if (variableData) variableDataUpdates[field] = variableData
  }

  if (Object.keys(variableDataUpdates).length === 0) return grid
  return { ...fields, ...variableDataUpdates }
}

function remapLayoutGrids(
  layoutGrids: unknown[] | undefined,
  guidRemap: Map<string, string>
): unknown[] | undefined {
  if (!layoutGrids?.length) return undefined
  const result = layoutGrids.map((grid) => remapLayoutGrid(grid, guidRemap))
  for (let i = 0; i < layoutGrids.length; i++) {
    if (result[i] !== layoutGrids[i]) return result
  }
  return undefined
}

function remapLayoutGridFields(
  fields: LayoutGridFields,
  guidRemap: Map<string, string>
): Partial<LayoutGridFields> | undefined {
  const layoutGrids = remapLayoutGrids(fields.layoutGrids, guidRemap)
  return layoutGrids ? { layoutGrids } : undefined
}

function remapTextData(
  textData: NodeChange['textData'] | undefined,
  guidRemap: Map<string, string>
): NodeChange['textData'] | undefined {
  if (!textData) return undefined

  const styleOverrideTable = (textData as TextDataWithStyleOverrideTable).styleOverrideTable
  if (!styleOverrideTable?.length) return undefined

  const result = styleOverrideTable.map((styleOverride) =>
    remapNodeChangeReferences(styleOverride, guidRemap)
  )
  for (let i = 0; i < styleOverrideTable.length; i++) {
    if (result[i] !== styleOverrideTable[i]) {
      return { ...textData, styleOverrideTable: result }
    }
  }
  return undefined
}

function remapComponentPropAssignments(
  assignments: ComponentPropAssignment[] | undefined,
  guidRemap: Map<string, string>
): ComponentPropAssignment[] | undefined {
  if (!assignments?.length) return undefined
  const result = assignments.map((assignment) => {
    const defID = remapGuid(assignment.defID, guidRemap)
    const value = remapComponentPropValue(assignment.value, guidRemap)
    const varValue = remapComponentPropValue(assignment.varValue?.value, guidRemap)
    if (!defID && !value && !varValue) return assignment
    return {
      ...assignment,
      ...(defID ? { defID } : {}),
      ...(value ? { value } : {}),
      ...(varValue ? { varValue: { ...assignment.varValue, value: varValue } } : {})
    }
  })
  for (let i = 0; i < assignments.length; i++) {
    if (result[i] !== assignments[i]) return result
  }
  return undefined
}

function remapComponentPropRefs(
  refs: ComponentPropRef[] | undefined,
  guidRemap: Map<string, string>
): ComponentPropRef[] | undefined {
  if (!refs?.length) return undefined
  const result = refs.map((ref) => {
    const defID = remapGuid(ref.defID, guidRemap)
    return defID ? { ...ref, defID } : ref
  })
  for (let i = 0; i < refs.length; i++) {
    if (result[i] !== refs[i]) return result
  }
  return undefined
}

function remapComponentPropDefs(
  defs: ComponentPropDef[] | undefined,
  guidRemap: Map<string, string>
): ComponentPropDef[] | undefined {
  if (!defs?.length) return undefined
  const result = defs.map((def) => {
    const id = remapGuid(def.id, guidRemap)
    const initialValue = remapComponentPropValue(def.initialValue, guidRemap)
    const parentPropDefId = remapGuid(def.parentPropDefId, guidRemap)
    const varValue = remapVariableDataEntry(def.varValue, guidRemap)
    if (!id && !initialValue && !parentPropDefId && !varValue) return def
    return {
      ...def,
      ...(id ? { id } : {}),
      ...(initialValue ? { initialValue } : {}),
      ...(parentPropDefId ? { parentPropDefId } : {}),
      ...(varValue ? { varValue } : {})
    }
  })
  for (let i = 0; i < defs.length; i++) {
    if (result[i] !== defs[i]) return result
  }
  return undefined
}

function remapVariantPropSpecs(
  specs: Array<{ propDefId?: GUID; value?: string }> | undefined,
  guidRemap: Map<string, string>
): Array<{ propDefId?: GUID; value?: string }> | undefined {
  if (!specs?.length) return undefined
  const result = specs.map((spec) => {
    const propDefId = remapGuid(spec.propDefId, guidRemap)
    return propDefId ? { ...spec, propDefId } : spec
  })
  for (let i = 0; i < specs.length; i++) {
    if (result[i] !== specs[i]) return result
  }
  return undefined
}

function remapSymbolOverrides(
  overrides: SymbolOverride[] | undefined,
  guidRemap: Map<string, string>
): SymbolOverride[] | undefined {
  if (!overrides?.length) return undefined
  const result = overrides.map((override) => {
    const remappableOverride = override as SymbolOverride &
      StyleReferenceFields &
      PaintFields &
      EffectFields &
      LayoutGridFields & { textData?: NodeChange['textData'] }
    const guids = remapGuidArray(override.guidPath?.guids, guidRemap)
    const overriddenSymbolID = remapGuid(override.overriddenSymbolID, guidRemap)
    const styleRefs = remapStyleReferenceFields(remappableOverride, guidRemap)
    const paintFields = remapPaintFields(remappableOverride, guidRemap)
    const effectFields = remapEffectFields(remappableOverride, guidRemap)
    const layoutGridFields = remapLayoutGridFields(remappableOverride, guidRemap)
    const textData = remapTextData(remappableOverride.textData, guidRemap)
    const componentPropAssignments = remapComponentPropAssignments(
      override.componentPropAssignments,
      guidRemap
    )
    const variableConsumptionEntries = remapVariableEntries(
      override.variableConsumptionMap?.entries ?? [],
      guidRemap
    )
    if (
      !guids &&
      !overriddenSymbolID &&
      !styleRefs &&
      !paintFields &&
      !effectFields &&
      !layoutGridFields &&
      !textData &&
      !componentPropAssignments &&
      !variableConsumptionEntries
    )
      return override
    return {
      ...override,
      ...(guids ? { guidPath: { ...override.guidPath, guids } } : {}),
      ...(overriddenSymbolID ? { overriddenSymbolID } : {}),
      ...styleRefs,
      ...paintFields,
      ...effectFields,
      ...layoutGridFields,
      ...(textData ? { textData } : {}),
      ...(componentPropAssignments ? { componentPropAssignments } : {}),
      ...(variableConsumptionEntries
        ? { variableConsumptionMap: { entries: variableConsumptionEntries } }
        : {})
    }
  })
  for (let i = 0; i < overrides.length; i++) {
    if (result[i] !== overrides[i]) return result
  }
  return undefined
}

function remapDerivedSymbolData(
  derived: DerivedSymbolOverride[] | undefined,
  guidRemap: Map<string, string>
): DerivedSymbolOverride[] | undefined {
  if (!derived?.length) return undefined
  const result = derived.map((entry) => {
    const guids = remapGuidArray(entry.guidPath?.guids, guidRemap)
    return guids ? { ...entry, guidPath: { ...entry.guidPath, guids } } : entry
  })
  for (let i = 0; i < derived.length; i++) {
    if (result[i] !== derived[i]) return result
  }
  return undefined
}

function remapTreeAndSymbolReferences(
  nc: NodeChange,
  guidRemap: Map<string, string>,
  updates: NodeChangeUpdates
): void {
  const parentGuid = remapGuid(nc.parentIndex?.guid, guidRemap)
  if (parentGuid) updates.parentIndex = { ...nc.parentIndex, guid: parentGuid }

  const sd = nc.symbolData as SymbolData | undefined
  const symbolID = remapGuid(sd?.symbolID, guidRemap)
  const symbolOverrides = remapSymbolOverrides(sd?.symbolOverrides, guidRemap)
  if (symbolID || symbolOverrides)
    updates.symbolData = {
      ...sd,
      ...(symbolID ? { symbolID } : {}),
      ...(symbolOverrides ? { symbolOverrides } : {})
    }

  const overrideKey = nc.overrideKey
  if (
    overrideKey &&
    typeof overrideKey === 'object' &&
    'sessionID' in overrideKey &&
    'localID' in overrideKey
  ) {
    const remappedOverrideKey = remapGuid(overrideKey as GUID, guidRemap)
    if (remappedOverrideKey) updates.overrideKey = remappedOverrideKey
  }
}

function remapComponentPropertyReferences(
  nc: NodeChange,
  guidRemap: Map<string, string>,
  updates: NodeChangeUpdates
): void {
  const assignments = remapComponentPropAssignments(
    nc.componentPropAssignments as ComponentPropAssignment[] | undefined,
    guidRemap
  )
  if (assignments) updates.componentPropAssignments = assignments

  const refs = remapComponentPropRefs(
    nc.componentPropRefs as ComponentPropRef[] | undefined,
    guidRemap
  )
  if (refs) updates.componentPropRefs = refs

  const defs = remapComponentPropDefs(
    nc.componentPropDefs as ComponentPropDef[] | undefined,
    guidRemap
  )
  if (defs) updates.componentPropDefs = defs

  const variantPropSpecs = remapVariantPropSpecs(
    nc.variantPropSpecs as Array<{ propDefId?: GUID; value?: string }> | undefined,
    guidRemap
  )
  if (variantPropSpecs) updates.variantPropSpecs = variantPropSpecs
}

function remapDerivedPayloadReferences(
  nc: NodeChange,
  guidRemap: Map<string, string>,
  updates: NodeChangeUpdates
): void {
  const derivedSymbolData = remapDerivedSymbolData(
    nc.derivedSymbolData as DerivedSymbolOverride[] | undefined,
    guidRemap
  )
  if (derivedSymbolData) updates.derivedSymbolData = derivedSymbolData
}

function remapStyleAndPaintReferences(
  nc: NodeChange,
  guidRemap: Map<string, string>,
  updates: NodeChangeUpdates
): void {
  const styleRefs = remapStyleReferenceFields(nc, guidRemap)
  if (styleRefs) Object.assign(updates, styleRefs)

  const paintFields = remapPaintFields(nc, guidRemap)
  if (paintFields) Object.assign(updates, paintFields)

  const effectFields = remapEffectFields(nc, guidRemap)
  if (effectFields) Object.assign(updates, effectFields)

  const layoutGridFields = remapLayoutGridFields(nc, guidRemap)
  if (layoutGridFields) Object.assign(updates, layoutGridFields)

  const textData = remapTextData(nc.textData, guidRemap)
  if (textData) updates.textData = textData
}

export function remapNodeChangeReferences(
  nc: NodeChange,
  guidRemap: Map<string, string>
): NodeChange {
  if (guidRemap.size === 0) return nc

  const updates: NodeChangeUpdates = {}
  remapTreeAndSymbolReferences(nc, guidRemap, updates)
  remapVariableReferences(nc, guidRemap, updates)
  remapComponentPropertyReferences(nc, guidRemap, updates)
  remapDerivedPayloadReferences(nc, guidRemap, updates)
  remapStyleAndPaintReferences(nc, guidRemap, updates)
  remapPrototypeReferences(nc, guidRemap, updates)
  remapRawPayloadReferences(nc, guidRemap, updates)

  if (Object.keys(updates).length === 0) return nc
  return { ...nc, ...updates }
}
