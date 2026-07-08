/**
 * Override keys are stored on INSTANCE nodes as `${childId}:${prop}`.
 * Because `childId` itself is a `sessionID:localID` string, naively
 * splitting on `:` would mis-parse the key. These helpers always split
 * on the *last* colon and join with a single colon.
 */

export function splitOverrideKey(key: string): { childId: string; prop: string } {
  const idx = key.lastIndexOf(':')
  if (idx === -1) {
    return { childId: '', prop: key }
  }
  return {
    childId: key.slice(0, idx),
    prop: key.slice(idx + 1)
  }
}

export function joinOverrideKey(childId: string, prop: string): string {
  return `${childId}:${prop}`
}
