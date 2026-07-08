import type { Variable, VariableValue } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { hasOnlyKeys, isFiniteNumber, isOneOf, isPlainRecord } from '../validation-primitives'
import type { RemoteVariableCollectionModePayload } from './sync'

export type RemotePayloadParseResult<T> = { ok: true; value: T } | { ok: false }

const VARIABLE_TYPES = [
  'COLOR',
  'FLOAT',
  'STRING',
  'BOOLEAN'
] as const satisfies readonly Variable['type'][]

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function valid<T>(value: T): RemotePayloadParseResult<T> {
  return { ok: true, value }
}

function invalid<T>(): RemotePayloadParseResult<T> {
  return { ok: false }
}

export function parseRemoteString(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw : fallback
}

export function parseRemoteStringValue(raw: unknown): RemotePayloadParseResult<string> {
  return typeof raw === 'string' ? valid(raw) : invalid()
}

export function parseRemoteStableId(raw: unknown, fallback: string): string {
  return isRemoteStableId(raw) ? raw : fallback
}

export function parseRemoteStableIdValue(raw: unknown): RemotePayloadParseResult<string> {
  return isRemoteStableId(raw) ? valid(raw) : invalid()
}

export function isRemoteStableId(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0
}

export function parseRemoteOptionalString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

export function parseRemoteBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}

export function parseRemoteBooleanValue(raw: unknown): RemotePayloadParseResult<boolean> {
  return typeof raw === 'boolean' ? valid(raw) : invalid()
}

export function parseRemoteSourceFormat(raw: unknown): 'fig' | null {
  return raw === 'fig' ? 'fig' : null
}

export function parseRemoteSourceFormatValue(raw: unknown): RemotePayloadParseResult<'fig' | null> {
  if (raw === 'fig') return valid('fig')
  if (raw === null || raw === undefined) return valid(null)
  return invalid()
}

export function parseRemoteVariableType(raw: unknown): Variable['type'] {
  return isOneOf(raw, VARIABLE_TYPES) ? raw : 'COLOR'
}

export function parseRemoteStringArray(raw: unknown): RemotePayloadParseResult<string[]> {
  const parsed = parseJson(raw)
  if (!Array.isArray(parsed)) return invalid()
  const seen = new Set<string>()
  const values: string[] = []
  for (const item of parsed) {
    if (!isRemoteStableId(item) || seen.has(item)) return invalid()
    seen.add(item)
    values.push(item)
  }
  return valid(values)
}

export function parseRemoteCollectionModes(
  raw: unknown,
  _fallbackModeStableId: string
): RemotePayloadParseResult<RemoteVariableCollectionModePayload[]> & { sanitized?: boolean } {
  const parsed = parseJson(raw)
  if (!Array.isArray(parsed)) return invalid()
  const modes: RemoteVariableCollectionModePayload[] = []
  const modeIds = new Set<string>()
  let sanitized = false
  for (const item of parsed) {
    const mode = parseRemoteMode(item)
    if (mode === undefined) return invalid()
    if (modeIds.has(mode.value.modeId)) return invalid()
    modeIds.add(mode.value.modeId)
    modes.push(mode.value)
    sanitized ||= mode.sanitized
  }
  return modes.length > 0 ? { ...valid(modes), sanitized } : invalid()
}

export function fallbackRemoteCollectionModes(
  fallbackModeStableId: string
): RemoteVariableCollectionModePayload[] {
  return [
    {
      modeId: fallbackModeStableId,
      name: 'Default',
      sourceId: fallbackModeStableId,
      sourceFormat: null
    }
  ]
}

function parseRemoteMode(
  raw: unknown
): { value: RemoteVariableCollectionModePayload; sanitized: boolean } | undefined {
  if (!isPlainRecord(raw)) return undefined
  const modeId = parseRemoteStableIdValue(raw.modeId)
  if (!modeId.ok) return undefined
  const name = parseRemoteStringValue(raw.name)
  const sourceId = parseRemoteStableIdValue(raw.sourceId)
  const sourceFormat = parseRemoteSourceFormatValue(raw.sourceFormat)
  return {
    value: {
      modeId: modeId.value,
      name: name.ok ? name.value : 'Mode',
      sourceId: sourceId.ok ? sourceId.value : modeId.value,
      sourceFormat: sourceFormat.ok ? sourceFormat.value : null
    },
    sanitized: !name.ok || !sourceId.ok || !sourceFormat.ok
  }
}

export function parseRemoteValuesByMode(
  raw: unknown,
  variableType: Variable['type']
): RemotePayloadParseResult<Record<string, VariableValue>> {
  const parsed = parseJson(raw)
  if (!isPlainRecord(parsed)) return invalid()
  const valuesByMode: Record<string, VariableValue> = {}
  for (const [modeStableId, value] of Object.entries(parsed)) {
    if (!isRemoteStableId(modeStableId)) return invalid()
    const parsedValue = parseRemoteVariableValue(value, variableType)
    if (parsedValue === undefined) return invalid()
    valuesByMode[modeStableId] = parsedValue
  }
  return valid(valuesByMode)
}

function parseRemoteVariableValue(
  raw: unknown,
  variableType: Variable['type']
): VariableValue | undefined {
  if (isPlainRecord(raw) && isAliasValue(raw)) return { aliasId: raw.aliasId }
  switch (variableType) {
    case 'STRING':
      return typeof raw === 'string' ? raw : undefined
    case 'BOOLEAN':
      return typeof raw === 'boolean' ? raw : undefined
    case 'FLOAT':
      return isFiniteNumber(raw) ? raw : undefined
    case 'COLOR':
      return isPlainRecord(raw) ? parseRemoteColorValue(raw) : undefined
  }
  return undefined
}

function isAliasValue(raw: Record<string, unknown>): raw is { aliasId: string } {
  return hasOnlyKeys(raw, 'aliasId') && isRemoteStableId(raw.aliasId)
}

function parseRemoteColorValue(raw: Record<string, unknown>): Color | undefined {
  if (!hasOnlyKeys(raw, 'r g b a')) return undefined
  const { r, g, b, a } = raw
  if (!isFiniteNumber(r) || !isFiniteNumber(g) || !isFiniteNumber(b) || !isFiniteNumber(a)) {
    return undefined
  }
  return { r, g, b, a }
}
