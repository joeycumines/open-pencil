import { createDefaultSource } from '@open-pencil/scene-graph'
import type { FigmaSourcePayload, SourceMetadata } from '@open-pencil/scene-graph'

import { hasOnlyKeys, isFiniteNumber, isPlainRecord } from './validation-primitives'

const VECTOR_KEYS = ['x', 'y'] as const
const MATRIX_KEYS = ['m00', 'm01', 'm02', 'm10', 'm11', 'm12'] as const
const LAYOUT_STRING_KEYS = [
  'stackMode',
  'stackCounterAlign',
  'stackJustify',
  'stackCounterAlignItems',
  'stackPrimaryAlignItems',
  'stackPrimarySizing',
  'stackCounterSizing',
  'stackWrap',
  'stackPositioning',
  'stackChildAlignSelf'
] as const
const LAYOUT_NUMBER_KEYS = [
  'stackSpacing',
  'stackPadding',
  'stackPaddingRight',
  'stackPaddingBottom',
  'stackVerticalPadding',
  'stackHorizontalPadding',
  'stackChildPrimaryGrow',
  'stackCounterSpacing'
] as const
const LAYOUT_BOOLEAN_KEYS = ['bordersTakeSpace', 'stackReverseZIndex'] as const
const LAYOUT_KEYS = [...LAYOUT_STRING_KEYS, ...LAYOUT_NUMBER_KEYS, ...LAYOUT_BOOLEAN_KEYS].join(' ')

type ParsedFigmaField<K extends keyof FigmaSourcePayload> =
  | { valid: true; value: FigmaSourcePayload[K] }
  | { valid: false }

function hasFiniteNumericKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => isFiniteNumber(record[key]))
}

function hasOptionalKeysOfType(
  record: Record<string, unknown>,
  keys: readonly string[],
  predicate: (value: unknown) => boolean
): boolean {
  return keys.every((key) => !(key in record) || predicate(record[key]))
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function acceptsRawSize(value: unknown): boolean {
  return (
    value === null ||
    (isPlainRecord(value) && hasOnlyKeys(value, 'x y') && hasFiniteNumericKeys(value, VECTOR_KEYS))
  )
}

function acceptsRawTransform(value: unknown): boolean {
  return (
    value === null ||
    (isPlainRecord(value) &&
      hasOnlyKeys(value, MATRIX_KEYS.join(' ')) &&
      hasFiniteNumericKeys(value, MATRIX_KEYS))
  )
}

function acceptsLayout(value: unknown): boolean {
  if (value === null) return true
  if (!isPlainRecord(value) || !hasOnlyKeys(value, LAYOUT_KEYS)) return false
  return (
    hasOptionalKeysOfType(value, LAYOUT_STRING_KEYS, isString) &&
    hasOptionalKeysOfType(value, LAYOUT_NUMBER_KEYS, isFiniteNumber) &&
    hasOptionalKeysOfType(value, LAYOUT_BOOLEAN_KEYS, isBoolean)
  )
}

function acceptsNullableNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value)
}

function readFigmaField<K extends keyof FigmaSourcePayload>(
  record: Record<string, unknown>,
  defaults: FigmaSourcePayload,
  key: K,
  accepts: (value: unknown) => boolean
): ParsedFigmaField<K> {
  const value = record[key]
  if (value === undefined) return { valid: true, value: defaults[key] }
  if (!accepts(value)) return { valid: false }
  return { valid: true, value: value as FigmaSourcePayload[K] }
}

function parseFigmaPayload(value: unknown): FigmaSourcePayload | undefined {
  if (!isPlainRecord(value)) return undefined
  const defaults = createDefaultSource().fig
  const rawSize = readFigmaField(value, defaults, 'rawSize', acceptsRawSize)
  const rawTransform = readFigmaField(value, defaults, 'rawTransform', acceptsRawTransform)
  const rawNodeFields = readFigmaField(value, defaults, 'rawNodeFields', isPlainRecord)
  const layout = readFigmaField(value, defaults, 'layout', acceptsLayout)
  const symbolOverrides = readFigmaField(value, defaults, 'symbolOverrides', Array.isArray)
  const componentPropAssignments = readFigmaField(
    value,
    defaults,
    'componentPropAssignments',
    Array.isArray
  )
  const derivedSymbolData = readFigmaField(value, defaults, 'derivedSymbolData', Array.isArray)
  const derivedSymbolDataLayoutVersion = readFigmaField(
    value,
    defaults,
    'derivedSymbolDataLayoutVersion',
    acceptsNullableNumber
  )
  const uniformScaleFactor = readFigmaField(
    value,
    defaults,
    'uniformScaleFactor',
    acceptsNullableNumber
  )

  if (!rawSize.valid || !rawTransform.valid || !rawNodeFields.valid || !layout.valid)
    return undefined
  if (!symbolOverrides.valid || !componentPropAssignments.valid || !derivedSymbolData.valid)
    return undefined
  if (!derivedSymbolDataLayoutVersion.valid || !uniformScaleFactor.valid) return undefined

  return {
    rawSize: rawSize.value,
    rawTransform: rawTransform.value,
    rawNodeFields: rawNodeFields.value,
    layout: layout.value,
    symbolOverrides: symbolOverrides.value,
    componentPropAssignments: componentPropAssignments.value,
    derivedSymbolData: derivedSymbolData.value,
    derivedSymbolDataLayoutVersion: derivedSymbolDataLayoutVersion.value,
    uniformScaleFactor: uniformScaleFactor.value
  }
}

export function tryParseSourceFig(value: unknown): SourceMetadata['fig'] | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return parseFigmaPayload(parsed)
  } catch {
    return undefined
  }
}
