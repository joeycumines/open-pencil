/** Figma's message for a value its schema rejects. */
export function invalid(method: string, problem: string, property = 'value'): Error {
  return new Error(`in ${method}: Property "${property}" failed validation: ${problem}`)
}

export function received(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'nan'
  if (Array.isArray(value)) return 'array'
  return value === null ? 'null' : typeof value
}
