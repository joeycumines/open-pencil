import { createDefaultSource } from './node/defaults'
import type {
  CreateNodeOptions,
  NodeType,
  SceneGraphOptions,
  SceneNode,
  SourceMetadata,
  Variable,
  VariableCollection
} from './types'

export interface SceneGraphIdentityHost {
  rootId: string
  nodes: Map<string, SceneNode>
  variables: Map<string, Variable>
  variableCollections: Map<string, VariableCollection>
}

let fallbackLocalID = 1
let documentLocalID = 1

/** @deprecated Use SceneGraph.generateNodeId instead. */
export function generateId(): string {
  return `0:${fallbackLocalID++}`
}

function allocateSessionID(): number {
  const buf = new Uint32Array(1)
  do {
    crypto.getRandomValues(buf)
  } while (buf[0] <= 1)
  return buf[0]
}

function allocateDocumentGuid(): string {
  return `0:${documentLocalID++}`
}

export class SceneGraphIdentity {
  readonly sessionID: number
  readonly documentGuid: string
  private host: SceneGraphIdentityHost
  private nextLocalID = 1
  private importerCounter = 1
  private reservedRuntimeIds = new Set<string>()
  private sourceIdsMigrated = false

  constructor(host: SceneGraphIdentityHost, options?: SceneGraphOptions) {
    this.host = host
    this.sessionID = options?.sessionID ?? allocateSessionID()
    this.documentGuid = options?.documentGuid ?? allocateDocumentGuid()
    for (const id of options?.reservedRuntimeIds ?? []) {
      this.reservedRuntimeIds.add(id)
    }
  }

  private makeId(localID: number): string {
    return `${this.sessionID}:${localID}`
  }

  private isReservedImportedId(node: SceneNode): string | null {
    if (node.source.format === 'fig' && node.source.id !== null) {
      return node.source.id
    }
    return null
  }

  private hasModeId(id: string): boolean {
    for (const collection of this.host.variableCollections.values()) {
      for (const mode of collection.modes) {
        if (mode.modeId === id) return true
      }
    }
    return false
  }

  generateStableId(): string {
    return this.makeId(this.nextLocalID++)
  }

  /**
   * Allocate a runtime node id, optionally preferring a caller-supplied value.
   *
   * Uses direct O(1) `Map.has` lookups instead of building a full known-id Set
   * every call. The previous implementation called `allKnownIds()` (which
   * iterated every node, variable, collection, and mode) on every invocation —
   * O(n) per `createNode`. During .fig import, `populateInstanceChildren`
   * clones thousands of component children, each calling `createNode`, making
   * the total cost O(n²) and hanging on large files (e.g. material3.fig,
   * ~87k nodes, went from ~12s on main to >150s).
   *
   * Generated ids (`makeId`) combine a random session id (> 1, allocated by
   * `allocateSessionID`) with a monotonic counter, so they can never collide
   * with each other or with imported ids (which use Figma session 0 or 1).
   * The collision check therefore only matters for caller-supplied `preferred`
   * ids (e.g. Figma GUIDs), and the fallback while-loop is a defensive net that
   * essentially never executes for generated ids.
   */
  generateNodeId(preferred?: string | null): string {
    if (preferred !== undefined && preferred !== null) {
      if (
        !this.host.nodes.has(preferred) &&
        !this.host.variables.has(preferred) &&
        !this.host.variableCollections.has(preferred) &&
        !this.reservedRuntimeIds.has(preferred) &&
        !this.hasModeId(preferred)
      ) {
        return preferred
      }
    }
    let id = this.makeId(this.nextLocalID++)
    while (this.host.nodes.has(id) || this.reservedRuntimeIds.has(id)) {
      id = this.makeId(this.nextLocalID++)
    }
    return id
  }

  generateImporterRemediationId(allocatedInThisImport: ReadonlySet<string>): string {
    let id = `1:${this.importerCounter++}`
    while (
      this.host.nodes.has(id) ||
      this.reservedRuntimeIds.has(id) ||
      this.host.variables.has(id) ||
      this.host.variableCollections.has(id) ||
      allocatedInThisImport.has(id)
    ) {
      id = `1:${this.importerCounter++}`
    }
    return id
  }

  reserveRuntimeIds(ids: Iterable<string>): void {
    for (const id of ids) this.reservedRuntimeIds.add(id)
  }

  unreserveRuntimeId(id: string): void {
    this.reservedRuntimeIds.delete(id)
  }

  getImportedRuntimeIds(): ReadonlySet<string> {
    return this.reservedRuntimeIds
  }

  recomputeReservedRuntimeIds(): void {
    this.reservedRuntimeIds.clear()
    const reserve = (source: SourceMetadata | undefined): void => {
      if (source?.format === 'fig' && source.id !== null) {
        this.reservedRuntimeIds.add(source.id)
      }
    }
    for (const node of this.host.nodes.values()) reserve(node.source)
    for (const variable of this.host.variables.values()) reserve(variable.source)
    for (const collection of this.host.variableCollections.values()) {
      reserve(collection.source)
      for (const mode of collection.modes) reserve(mode.source)
    }
  }

  getStableId(node: SceneNode): string {
    return node.source.id ?? node.id
  }

  stableIdToRuntimeId(stableId: string): string | undefined {
    for (const node of this.host.nodes.values()) {
      if (node.source.id === stableId) return node.id
    }
    return undefined
  }

  migrateLegacySourceIds(): void {
    if (this.sourceIdsMigrated) return
    this.sourceIdsMigrated = true

    const root = this.host.nodes.get(this.host.rootId)
    if (root?.source.id === null) {
      const stableId = this.generateStableId()
      root.source = { ...root.source, id: stableId }
    }

    for (const node of this.host.nodes.values()) {
      if (node.source.id !== null) continue
      const stableId = this.generateStableId()
      node.source = { ...node.source, id: stableId }
    }
  }

  readRequestedStableId(overrides: Partial<SceneNode>): string {
    const requested = overrides.source?.id
    if (requested !== undefined && requested !== null) return requested
    return this.generateStableId()
  }

  buildSource(overrides: Partial<SceneNode>, stableId: string): SourceMetadata {
    const defaultSource = createDefaultSource()
    const sourceInput = overrides.source ?? defaultSource
    return {
      ...defaultSource,
      ...sourceInput,
      id: sourceInput.id ?? stableId,
      fig: { ...defaultSource.fig, ...sourceInput.fig }
    }
  }

  pickRuntimeId(
    type: NodeType,
    stableId: string,
    requestedRuntimeId: string | undefined,
    mode: NonNullable<CreateNodeOptions['mode']>
  ): string {
    if (requestedRuntimeId === undefined) {
      return this.generateNodeId(stableId)
    }

    const existing = this.host.nodes.get(requestedRuntimeId)
    const reserved = this.reservedRuntimeIds.has(requestedRuntimeId)
    const sameIdentity =
      existing !== undefined && existing.type === type && this.getStableId(existing) === stableId

    if (mode === 'restore' && sameIdentity) return requestedRuntimeId
    if (
      mode === 'restore' &&
      existing === undefined &&
      reserved &&
      stableId === requestedRuntimeId
    ) {
      return requestedRuntimeId
    }
    if (mode !== 'restore' && existing === undefined && !reserved) return requestedRuntimeId
    return this.generateNodeId(stableId)
  }

  maybeUnreserveImportedId(node: SceneNode, options?: { permanent?: boolean }): void {
    if (options?.permanent === false) return
    const importedId = this.isReservedImportedId(node)
    if (importedId !== null) {
      this.unreserveRuntimeId(importedId)
    }
  }
}
