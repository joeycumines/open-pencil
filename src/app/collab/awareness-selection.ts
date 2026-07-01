export const AWARENESS_SELECTION_VERSION = 1

const MAX_SELECTION_REFS = 256
const MAX_SELECTION_ID_LENGTH = 2048
const MAX_INSTANCE_SELECTION_PATH_LENGTH = 64

export type AwarenessNodeSelectionRef = {
  kind: 'node'
  version: 1
  stableId: string
}

export type AwarenessInstanceDescendantSelectionRef = {
  kind: 'instance-descendant'
  version: 1
  ownerStableId: string
  stablePath: string[]
}

export type AwarenessSelectionRef =
  | AwarenessNodeSelectionRef
  | AwarenessInstanceDescendantSelectionRef

export type AwarenessSelectionPayload = {
  kind: 'selection'
  version: 1
  refs: AwarenessSelectionRef[]
}

export type SelectionParseResult =
  | { status: 'ok'; refs?: AwarenessSelectionRef[] }
  | { status: 'unsupported'; reason: string }
  | { status: 'malformed'; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSelectionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SELECTION_ID_LENGTH
}

function parseStablePath(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length === 0 || value.length > MAX_INSTANCE_SELECTION_PATH_LENGTH) return null
  const path: string[] = []
  for (const item of value) {
    if (!isSelectionId(item)) return null
    path.push(item)
  }
  return path
}

export function createNodeSelectionRef(stableId: string): AwarenessNodeSelectionRef | null {
  return isSelectionId(stableId) ? { kind: 'node', version: 1, stableId } : null
}

export function createInstanceDescendantSelectionRef(
  ownerStableId: string,
  stablePath: readonly string[]
): AwarenessInstanceDescendantSelectionRef | null {
  const parsedPath = parseStablePath([...stablePath])
  return isSelectionId(ownerStableId) && parsedPath !== null
    ? { kind: 'instance-descendant', version: 1, ownerStableId, stablePath: parsedPath }
    : null
}

function parseSelectionRef(value: unknown): AwarenessSelectionRef | null {
  if (!isRecord(value)) return null
  if (value.version !== AWARENESS_SELECTION_VERSION) return null
  if (value.kind === 'node') {
    return isSelectionId(value.stableId) ? createNodeSelectionRef(value.stableId) : null
  }
  if (value.kind !== 'instance-descendant') return null
  if (!isSelectionId(value.ownerStableId)) return null
  const stablePath = parseStablePath(value.stablePath)
  return stablePath === null
    ? null
    : { kind: 'instance-descendant', version: 1, ownerStableId: value.ownerStableId, stablePath }
}

export function createSelectionPayload(
  refs: readonly AwarenessSelectionRef[]
): AwarenessSelectionPayload | undefined {
  return refs.length === 0
    ? undefined
    : {
        kind: 'selection',
        version: AWARENESS_SELECTION_VERSION,
        refs: refs.map((ref) => ({ ...ref }))
      }
}

export function parseSelectionPayload(value: unknown): SelectionParseResult {
  if (value === undefined || value === null) return { status: 'ok' }
  if (Array.isArray(value)) return { status: 'unsupported', reason: 'legacy-selection-array' }
  if (!isRecord(value)) return { status: 'malformed', reason: 'selection-not-object' }
  if (value.kind !== 'selection') return { status: 'malformed', reason: 'selection-wrong-kind' }
  if (typeof value.version === 'number' && value.version !== AWARENESS_SELECTION_VERSION) {
    return { status: 'unsupported', reason: 'selection-version-unsupported' }
  }
  if (value.version !== AWARENESS_SELECTION_VERSION) {
    return { status: 'malformed', reason: 'selection-version-malformed' }
  }
  if (!Array.isArray(value.refs)) return { status: 'malformed', reason: 'selection-refs-not-array' }
  if (value.refs.length > MAX_SELECTION_REFS) {
    return { status: 'malformed', reason: 'selection-too-large' }
  }

  const refs: AwarenessSelectionRef[] = []
  for (const item of value.refs) {
    const ref = parseSelectionRef(item)
    if (ref === null) return { status: 'malformed', reason: 'selection-ref-malformed' }
    refs.push(ref)
  }
  return refs.length === 0 ? { status: 'ok' } : { status: 'ok', refs }
}
