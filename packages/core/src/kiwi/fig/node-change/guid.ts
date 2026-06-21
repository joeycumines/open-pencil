import type { GUID } from '#core/kiwi/fig/codec'

/**
 * Figma session 0 is reserved for the document root and other top-level
 * entries (canvas, schema). Nodes minted by the exporter use session 1.
 * Imported fig nodes retain their original session IDs (typically 0).
 */
export const FIGMA_SESSION_IMPORTED = 0
export const FIGMA_SESSION_REMEDIATED = 1

export function guidToString(guid: GUID): string {
  return `${guid.sessionID}:${guid.localID}`
}

export function stringToGuid(str: string): GUID {
  const match = str.match(/^(?:VariableID:|VariableCollectionId:)?(\d+):(\d+)$/)
  if (match)
    return { sessionID: Number.parseInt(match[1], 10), localID: Number.parseInt(match[2], 10) }
  const [session, local] = str.split(':')
  return { sessionID: Number.parseInt(session, 10), localID: Number.parseInt(local, 10) }
}

/**
 * Parses a string as a GUID (sessionID:localID format) or returns null
 * if the string is null/undefined or doesn't match the expected format.
 * Shared between the fig exporter and the node-change serializer.
 */
export function parseGuidOrNull(value: string | null | undefined): GUID | null {
  if (typeof value !== 'string' || !/^\d+:\d+$/.test(value)) return null
  return stringToGuid(value)
}
