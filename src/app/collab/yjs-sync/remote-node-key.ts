const REMOTE_NODE_KEY_PREFIX = 'open-pencil:collab-node-key:v1:'

type RemoteNodeKeySegmentKind = 'branch' | 'orphan'

export type RemoteNodeKeySegment = {
  kind: RemoteNodeKeySegmentKind
  stableId: string
}

export type RemoteNodeKeyParts = {
  baseStableId: string
  segments: RemoteNodeKeySegment[]
}

export type RemoteNodeKeyDecodeResult = { ok: true; parts: RemoteNodeKeyParts } | { ok: false }

const SEGMENT_CODES: Record<RemoteNodeKeySegmentKind, string> = {
  branch: 'b',
  orphan: 'o'
}

function segmentKindForCode(code: string): RemoteNodeKeySegmentKind | undefined {
  if (code === SEGMENT_CODES.branch) return 'branch'
  if (code === SEGMENT_CODES.orphan) return 'orphan'
  return undefined
}

function readDecimal(input: string, start: number): { value: number; next: number } | null {
  let index = start
  while (index < input.length && input[index] >= '0' && input[index] <= '9') index++
  if (index === start || input[index] !== ':') return null
  const raw = input.slice(start, index)
  if (raw.length > 1 && raw.startsWith('0')) return null
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) return null
  return { value, next: index + 1 }
}

function readLengthPrefixedString(
  input: string,
  start: number
): { value: string; next: number } | null {
  const length = readDecimal(input, start)
  if (length === null) return null
  const end = length.next + length.value
  if (end > input.length) return null
  return { value: input.slice(length.next, end), next: end }
}

function writeLengthPrefixedString(value: string): string {
  return `${value.length}:${value}`
}

function encodeRemoteNodeKeyParts(parts: RemoteNodeKeyParts): string {
  const segments = parts.segments
    .map(
      (segment) => `${SEGMENT_CODES[segment.kind]}${writeLengthPrefixedString(segment.stableId)}`
    )
    .join('')
  return `${REMOTE_NODE_KEY_PREFIX}${writeLengthPrefixedString(parts.baseStableId)}${parts.segments.length}:${segments}`
}

export function decodeRemoteNodeKey(remoteNodeKey: string): RemoteNodeKeyDecodeResult {
  if (!remoteNodeKey.startsWith(REMOTE_NODE_KEY_PREFIX)) {
    return { ok: true, parts: { baseStableId: remoteNodeKey, segments: [] } }
  }

  let index = REMOTE_NODE_KEY_PREFIX.length
  const base = readLengthPrefixedString(remoteNodeKey, index)
  if (base === null) return { ok: false }
  index = base.next

  const segmentCount = readDecimal(remoteNodeKey, index)
  if (segmentCount === null) return { ok: false }
  index = segmentCount.next

  const segments: RemoteNodeKeySegment[] = []
  for (let i = 0; i < segmentCount.value; i++) {
    const kind = segmentKindForCode(remoteNodeKey[index] ?? '')
    if (kind === undefined) return { ok: false }
    index++

    const stableId = readLengthPrefixedString(remoteNodeKey, index)
    if (stableId === null) return { ok: false }
    index = stableId.next
    segments.push({ kind, stableId: stableId.value })
  }

  return index === remoteNodeKey.length
    ? { ok: true, parts: { baseStableId: base.value, segments } }
    : { ok: false }
}

export function isMalformedRemoteNodeKey(remoteNodeKey: string): boolean {
  return remoteNodeKey.startsWith(REMOTE_NODE_KEY_PREFIX) && !decodeRemoteNodeKey(remoteNodeKey).ok
}

export function remoteNodeKeyForStableId(stableId: string): string {
  if (!stableId.startsWith(REMOTE_NODE_KEY_PREFIX)) return stableId
  return encodeRemoteNodeKeyParts({ baseStableId: stableId, segments: [] })
}

export function appendRemoteNodeKeySegment(
  ownerRemoteNodeKey: string,
  kind: RemoteNodeKeySegmentKind,
  stableId: string
): string {
  const decoded = decodeRemoteNodeKey(ownerRemoteNodeKey)
  if (!decoded.ok)
    return encodeRemoteNodeKeyParts({ baseStableId: ownerRemoteNodeKey, segments: [] })
  return encodeRemoteNodeKeyParts({
    baseStableId: decoded.parts.baseStableId,
    segments: [...decoded.parts.segments, { kind, stableId }]
  })
}

export function originalStableIdFromRemoteNodeKey(remoteNodeKey: string): string | null {
  const decoded = decodeRemoteNodeKey(remoteNodeKey)
  if (!decoded.ok) return null
  const finalSegment = decoded.parts.segments.at(-1)
  return finalSegment?.kind === 'orphan' ? finalSegment.stableId : null
}

export function rawStableIdFromRemoteNodeKey(remoteNodeKey: string): string | null {
  const decoded = decodeRemoteNodeKey(remoteNodeKey)
  if (!decoded.ok || decoded.parts.segments.length > 0) return null
  return decoded.parts.baseStableId
}
