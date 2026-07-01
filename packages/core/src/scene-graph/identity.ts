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

/**
 * Dev-only flag. When true, performance counters track O(n) fallback paths
 * and warn when they fire excessively — a symptom of O(n²) behavior.
 *
 * In production builds, Vite replaces `import.meta.env.DEV` with `false` and
 * the bundler tree-shakes all guarded code, resulting in zero overhead.
 */
const IS_DEV = 'env' in import.meta && import.meta.env.DEV

/** Threshold for linear-scan warnings in stableIdToRuntimeId. */
const STABLE_ID_LINEAR_SCAN_THRESHOLD = 10

export interface SceneGraphIdentityHost {
  rootId: string
  nodes: Map<string, SceneNode>
  variables: Map<string, Variable>
  variableCollections: Map<string, VariableCollection>
}

let documentLocalID = 1

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
  private importedSourceRefCounts = new Map<string, number>()
  private suspendedImportedSourceRefCounts = new Map<string, number>()
  private suspendedImportedSourceRuntimeRefCounts = new Map<string, Map<string, number>>()
  private modeIds = new Map<string, number>()
  private stableIdToRuntimeIdMap = new Map<string, string>()
  private sourceIdsMigrated = false
  /** Dev-only counter for stableIdToRuntimeId linear-scan fallback. */
  private stableIdLinearScanCount = 0

  constructor(host: SceneGraphIdentityHost, options?: SceneGraphOptions) {
    this.host = host
    this.sessionID = options?.sessionID ?? allocateSessionID()
    this.documentGuid = options?.documentGuid ?? allocateDocumentGuid()
    for (const id of options?.reservedRuntimeIds ?? []) {
      this.reservedRuntimeIds.add(id)
    }
    for (const collection of this.host.variableCollections.values()) {
      for (const mode of collection.modes) {
        this.addModeId(mode.modeId)
      }
    }
  }

  private makeId(localID: number): string {
    return `${this.sessionID}:${localID}`
  }

  private importedSourceId(source: SourceMetadata | undefined): string | null {
    if (source?.format === 'fig' && source.id !== null) {
      return source.id
    }
    return null
  }

  private hasModeId(id: string): boolean {
    return this.modeIds.has(id)
  }

  private addModeId(id: string): void {
    this.modeIds.set(id, (this.modeIds.get(id) ?? 0) + 1)
  }

  private removeModeId(id: string): void {
    const count = this.modeIds.get(id)
    if (count === undefined) return
    if (count <= 1) {
      this.modeIds.delete(id)
      return
    }
    this.modeIds.set(id, count - 1)
  }

  private hasVariableSourceId(id: string): boolean {
    for (const variable of this.host.variables.values()) {
      if (variable.source?.id === id) return true
    }
    for (const collection of this.host.variableCollections.values()) {
      if (collection.source?.id === id) return true
      for (const mode of collection.modes) {
        if (mode.source?.id === id) return true
      }
    }
    return false
  }

  private isGeneratedStableIdFree(id: string): boolean {
    return (
      !this.host.nodes.has(id) &&
      !this.stableIdToRuntimeIdMap.has(id) &&
      !this.host.variables.has(id) &&
      !this.host.variableCollections.has(id) &&
      !this.reservedRuntimeIds.has(id) &&
      !this.hasImportedSourceRef(id) &&
      !this.hasModeId(id) &&
      !this.hasVariableSourceId(id)
    )
  }

  generateStableId(): string {
    let id = this.makeId(this.nextLocalID++)
    while (!this.isGeneratedStableIdFree(id)) {
      id = this.makeId(this.nextLocalID++)
    }
    return id
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
        !this.hasImportedSourceRef(preferred) &&
        !this.hasModeId(preferred)
      ) {
        return preferred
      }
    }
    let id = this.makeId(this.nextLocalID++)
    while (!this.isRuntimeIdFree(id)) {
      id = this.makeId(this.nextLocalID++)
    }
    return id
  }

  generateImporterRemediationId(allocatedInThisImport: ReadonlySet<string>): string {
    let id = `1:${this.importerCounter++}`
    while (
      this.host.nodes.has(id) ||
      this.reservedRuntimeIds.has(id) ||
      this.hasImportedSourceRef(id) ||
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

  private incrementImportedSourceRefCount(id: string): void {
    this.importedSourceRefCounts.set(id, (this.importedSourceRefCounts.get(id) ?? 0) + 1)
  }

  private incrementSuspendedImportedRuntime(sourceId: string, runtimeId: string): void {
    let runtimes = this.suspendedImportedSourceRuntimeRefCounts.get(sourceId)
    if (runtimes === undefined) {
      runtimes = new Map<string, number>()
      this.suspendedImportedSourceRuntimeRefCounts.set(sourceId, runtimes)
    }
    runtimes.set(runtimeId, (runtimes.get(runtimeId) ?? 0) + 1)
  }

  private decrementSuspendedImportedRuntime(sourceId: string, runtimeId: string): boolean {
    const runtimes = this.suspendedImportedSourceRuntimeRefCounts.get(sourceId)
    const count = runtimes?.get(runtimeId)
    if (runtimes === undefined || count === undefined) return false
    if (count <= 1) {
      runtimes.delete(runtimeId)
      if (runtimes.size === 0) this.suspendedImportedSourceRuntimeRefCounts.delete(sourceId)
      return true
    }
    runtimes.set(runtimeId, count - 1)
    return true
  }

  private decrementAnySuspendedImportedRuntime(sourceId: string): void {
    const runtimeId = this.suspendedImportedSourceRuntimeRefCounts
      .get(sourceId)
      ?.keys()
      .next().value
    if (runtimeId !== undefined) this.decrementSuspendedImportedRuntime(sourceId, runtimeId)
  }

  private decrementSuspendedImportedSource(id: string, runtimeId?: string): void {
    const count = this.suspendedImportedSourceRefCounts.get(id)
    if (count === undefined) return
    if (runtimeId !== undefined && !this.decrementSuspendedImportedRuntime(id, runtimeId)) return
    if (runtimeId === undefined) {
      this.decrementAnySuspendedImportedRuntime(id)
    }
    if (count <= 1) {
      this.suspendedImportedSourceRefCounts.delete(id)
      return
    }
    this.suspendedImportedSourceRefCounts.set(id, count - 1)
  }

  private hasSuspendedImportedSource(id: string): boolean {
    return this.suspendedImportedSourceRefCounts.has(id)
  }

  private hasSuspendedImportedRuntime(sourceId: string, runtimeId: string): boolean {
    return this.suspendedImportedSourceRuntimeRefCounts.get(sourceId)?.has(runtimeId) === true
  }

  private hasLiveImportedSource(id: string): boolean {
    return (this.importedSourceRefCounts.get(id) ?? 0) > 0
  }

  private hasImportedSourceRef(id: string): boolean {
    return this.hasLiveImportedSource(id) || this.hasSuspendedImportedSource(id)
  }

  private hasLiveImportedVariableSource(id: string): boolean {
    for (const variable of this.host.variables.values()) {
      if (this.importedSourceId(variable.source) === id) return true
    }
    for (const collection of this.host.variableCollections.values()) {
      if (this.importedSourceId(collection.source) === id) return true
      for (const mode of collection.modes) {
        if (this.importedSourceId(mode.source) === id) return true
      }
    }
    return false
  }

  private canRestoreReservedImportedSource(id: string): boolean {
    if (this.hasLiveImportedVariableSource(id)) return false
    return !this.hasLiveImportedSource(id) || this.hasSuspendedImportedRuntime(id, id)
  }

  registerImportedSource(
    source: SourceMetadata | undefined,
    options?: { consumeSuspended?: boolean; consumeSuspendedRuntimeId?: string }
  ): void {
    const id = this.importedSourceId(source)
    if (id === null) return
    this.reservedRuntimeIds.add(id)
    this.incrementImportedSourceRefCount(id)
    if (options?.consumeSuspendedRuntimeId !== undefined) {
      this.decrementSuspendedImportedSource(id, options.consumeSuspendedRuntimeId)
    } else if (options?.consumeSuspended === true) {
      this.decrementSuspendedImportedSource(id)
    }
  }

  unregisterImportedSource(source: SourceMetadata | undefined): void {
    const id = this.importedSourceId(source)
    if (id === null) return
    const count = this.importedSourceRefCounts.get(id)
    if (count === undefined) {
      if (!this.hasSuspendedImportedSource(id)) this.reservedRuntimeIds.delete(id)
      return
    }
    if (count <= 1) {
      this.importedSourceRefCounts.delete(id)
      if (!this.hasSuspendedImportedSource(id)) this.reservedRuntimeIds.delete(id)
      return
    }
    this.importedSourceRefCounts.set(id, count - 1)
  }

  suspendImportedSource(source: SourceMetadata | undefined, runtimeId?: string): void {
    const id = this.importedSourceId(source)
    if (id === null) return
    this.reservedRuntimeIds.add(id)
    const liveCount = this.importedSourceRefCounts.get(id)
    if (liveCount !== undefined) {
      if (liveCount <= 1) {
        this.importedSourceRefCounts.delete(id)
      } else {
        this.importedSourceRefCounts.set(id, liveCount - 1)
      }
    }
    this.suspendedImportedSourceRefCounts.set(
      id,
      (this.suspendedImportedSourceRefCounts.get(id) ?? 0) + 1
    )
    if (runtimeId !== undefined) this.incrementSuspendedImportedRuntime(id, runtimeId)
  }

  registerCollectionModes(collection: VariableCollection): void {
    for (const mode of collection.modes) this.addModeId(mode.modeId)
  }

  unregisterCollectionModes(collection: VariableCollection): void {
    for (const mode of collection.modes) this.removeModeId(mode.modeId)
  }

  registerModeId(id: string): void {
    this.addModeId(id)
  }

  unregisterModeId(id: string): void {
    this.removeModeId(id)
  }

  unreserveRuntimeId(id: string): void {
    if (this.hasImportedSourceRef(id)) return
    this.reservedRuntimeIds.delete(id)
  }

  getImportedRuntimeIds(): ReadonlySet<string> {
    return this.reservedRuntimeIds
  }

  recomputeReservedRuntimeIds(): void {
    this.reservedRuntimeIds.clear()
    this.importedSourceRefCounts.clear()
    this.modeIds.clear()
    for (const id of this.suspendedImportedSourceRefCounts.keys()) {
      this.reservedRuntimeIds.add(id)
    }
    const reserve = (source: SourceMetadata | undefined): void => {
      this.registerImportedSource(source)
    }
    for (const node of this.host.nodes.values()) reserve(node.source)
    for (const variable of this.host.variables.values()) reserve(variable.source)
    for (const collection of this.host.variableCollections.values()) {
      reserve(collection.source)
      for (const mode of collection.modes) {
        reserve(mode.source)
        this.addModeId(mode.modeId)
      }
    }
    this.rebuildStableIdMap()
  }

  getStableId(node: SceneNode): string {
    return node.source.id ?? node.id
  }

  /** Register a stable→runtime ID mapping. Called from createNode. */
  registerStableId(runtimeId: string, stableId: string): void {
    const cached = this.stableIdToRuntimeIdMap.get(stableId)
    if (cached === undefined || this.host.nodes.get(cached)?.source.id !== stableId) {
      this.stableIdToRuntimeIdMap.set(stableId, runtimeId)
    }
  }

  unregisterStableId(runtimeId: string, stableId: string | null): void {
    if (stableId !== null && this.stableIdToRuntimeIdMap.get(stableId) === runtimeId) {
      this.stableIdToRuntimeIdMap.delete(stableId)
    }
  }

  /** Rebuild the stable→runtime ID map from all nodes. */
  rebuildStableIdMap(): void {
    this.stableIdToRuntimeIdMap.clear()
    for (const node of this.host.nodes.values()) {
      if (node.source.id !== null) {
        if (!this.stableIdToRuntimeIdMap.has(node.source.id)) {
          this.stableIdToRuntimeIdMap.set(node.source.id, node.id)
        }
      }
    }
  }

  /**
   * Look up a runtime ID by stable ID. Uses the O(1) index when available,
   * falls back to linear scan for cache misses.
   * @deprecated Use findRuntimeIdByStableId() for new code.
   */
  stableIdToRuntimeId(stableId: string): string | undefined {
    const cached = this.stableIdToRuntimeIdMap.get(stableId)
    if (cached !== undefined) {
      // Verify the cached entry is still valid
      if (this.host.nodes.get(cached)?.source.id === stableId) return cached
      // Stale entry — clean up
      this.stableIdToRuntimeIdMap.delete(stableId)
    }
    // Fallback: linear scan for nodes not in the index
    for (const node of this.host.nodes.values()) {
      if (node.source.id === stableId) {
        this.stableIdToRuntimeIdMap.set(stableId, node.id)
        if (IS_DEV) {
          this.stableIdLinearScanCount++
          if (this.stableIdLinearScanCount === STABLE_ID_LINEAR_SCAN_THRESHOLD) {
            console.warn(
              `[OpenPencil] stableIdToRuntimeId: ${STABLE_ID_LINEAR_SCAN_THRESHOLD} linear scans detected. ` +
                `Use findRuntimeIdByStableId() or call rebuildStableIdMap() to build the O(1) index. ` +
                `This indicates potential O(n²) behavior if called in a loop.`
            )
          }
        }
        return node.id
      }
    }
    return undefined
  }

  /** O(1) stable→runtime ID lookup using the index. */
  findRuntimeIdByStableId(stableId: string): string | undefined {
    return this.stableIdToRuntimeId(stableId)
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
    this.rebuildStableIdMap()
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

  private isRuntimeIdFree(id: string): boolean {
    return (
      !this.host.nodes.has(id) &&
      !this.reservedRuntimeIds.has(id) &&
      !this.hasImportedSourceRef(id) &&
      !this.host.variables.has(id) &&
      !this.host.variableCollections.has(id) &&
      !this.hasModeId(id)
    )
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
      stableId === requestedRuntimeId &&
      this.canRestoreReservedImportedSource(requestedRuntimeId)
    ) {
      return requestedRuntimeId
    }
    // Reuse a freed runtime ID if it doesn't collide with any namespace.
    // Both 'restore' and 'default' modes share this check — the mode-specific
    // branches above handle the cases where mode matters (sameIdentity,
    // reserved+stableId match). This covers nodes whose runtime ID differs
    // from their stable ID (e.g. fig-imported nodes with GUID collision).
    if (existing === undefined && !reserved && this.isRuntimeIdFree(requestedRuntimeId)) {
      return requestedRuntimeId
    }
    return this.generateNodeId(stableId)
  }

  maybeUnreserveImportedId(node: SceneNode, options?: { permanent?: boolean }): void {
    if (options?.permanent === false) {
      this.suspendImportedSource(node.source, node.id)
      return
    }
    this.unregisterImportedSource(node.source)
  }

  /**
   * Reset dev-only performance counters. Call at operation boundaries
   * (import start, sync start) to avoid stale warnings across unrelated
   * operations. No-op in production builds.
   */
  resetDevCounters(): void {
    if (IS_DEV) this.stableIdLinearScanCount = 0
  }
}
