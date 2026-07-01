export type Validator = (value: unknown) => boolean

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber)
}

export function isArrayOf(value: unknown, predicate: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(predicate)
}

export function isOneOf<const Value extends string>(
  value: unknown,
  allowed: readonly Value[]
): value is Value {
  return typeof value === 'string' && allowed.includes(value as Value)
}

export function hasOptionalValue(
  record: Record<string, unknown>,
  key: string,
  predicate: (value: unknown) => boolean
): boolean {
  return !(key in record) || predicate(record[key])
}

export function hasOnlyKeys(record: Record<string, unknown>, keys: string): boolean {
  const allowed = new Set(keys.split(' ').filter((key) => key.length > 0))
  return Object.keys(record).every((key) => allowed.has(key))
}
