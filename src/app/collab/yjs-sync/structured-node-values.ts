import {
  hasOnlyKeys,
  hasOptionalValue,
  isArrayOf,
  isFiniteNumber,
  isFiniteNumberArray,
  isOneOf,
  isPlainRecord
} from './validation-primitives'

const WINDING_RULES = ['NONZERO', 'EVENODD'] as const
const GRID_TRACK_SIZING = ['FIXED', 'FR', 'AUTO'] as const
const COMPONENT_PROPERTY_TYPES = ['VARIANT', 'TEXT', 'BOOLEAN', 'INSTANCE_SWAP'] as const
const EXPORT_FORMATS = ['png', 'jpg', 'webp', 'svg', 'pdf'] as const

function isVector(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, 'x y') &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
  )
}

export function isVectorNetwork(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'vertices segments regions')) return false
  return (
    isArrayOf(value.vertices, isVectorVertex) &&
    isArrayOf(value.segments, isVectorSegment) &&
    isArrayOf(value.regions, isVectorRegion)
  )
}

function isVectorVertex(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'x y strokeCap strokeJoin cornerRadius handleMirroring')) return false
  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    hasOptionalValue(value, 'strokeCap', (entry) => typeof entry === 'string') &&
    hasOptionalValue(value, 'strokeJoin', (entry) => typeof entry === 'string') &&
    hasOptionalValue(value, 'cornerRadius', isFiniteNumber) &&
    hasOptionalValue(value, 'handleMirroring', (entry) =>
      isOneOf(entry, ['NONE', 'ANGLE', 'ANGLE_AND_LENGTH'] as const)
    )
  )
}

function isVectorSegment(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'start end tangentStart tangentEnd')) return false
  return (
    isFiniteNumber(value.start) &&
    isFiniteNumber(value.end) &&
    isVector(value.tangentStart) &&
    isVector(value.tangentEnd)
  )
}

function isVectorRegion(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'windingRule loops')) return false
  return isOneOf(value.windingRule, WINDING_RULES) && isArrayOf(value.loops, isFiniteNumberArray)
}

export function isArcData(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'startingAngle endingAngle innerRadius')) return false
  return (
    isFiniteNumber(value.startingAngle) &&
    isFiniteNumber(value.endingAngle) &&
    isFiniteNumber(value.innerRadius)
  )
}

export function isGridTrack(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, 'sizing value') &&
    isOneOf(value.sizing, GRID_TRACK_SIZING) &&
    isFiniteNumber(value.value)
  )
}

export function isGridPosition(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'column row columnSpan rowSpan')) return false
  return ['column', 'row', 'columnSpan', 'rowSpan'].every((key) => isFiniteNumber(value[key]))
}

export function isComponentPropertyDefinition(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'id name type defaultValue variantOptions')) return false
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isOneOf(value.type, COMPONENT_PROPERTY_TYPES) &&
    typeof value.defaultValue === 'string' &&
    hasOptionalValue(value, 'variantOptions', isStringArray)
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isSymbolLink(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'uri displayName displayText')) return false
  return (
    typeof value.uri === 'string' &&
    hasOptionalValue(value, 'displayName', (entry) => typeof entry === 'string') &&
    hasOptionalValue(value, 'displayText', (entry) => typeof entry === 'string')
  )
}

export function isVariantPropSpec(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, 'propDefId value') &&
    typeof value.propDefId === 'string' &&
    typeof value.value === 'string'
  )
}

export function isExportSetting(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, 'scale format') &&
    isFiniteNumber(value.scale) &&
    isOneOf(value.format, EXPORT_FORMATS)
  )
}

export function isPluginDataEntry(value: unknown): boolean {
  return hasStringProps(value, 'pluginId key value')
}

export function isPluginRelaunchDataEntry(value: unknown): boolean {
  return (
    hasStringProps(value, 'pluginId command message isDeleted') &&
    typeof value.isDeleted === 'boolean'
  )
}

function hasStringProps(value: unknown, keys: string): value is Record<string, unknown> {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, keys)) return false
  return keys.split(' ').every((key) => key === 'isDeleted' || typeof value[key] === 'string')
}
