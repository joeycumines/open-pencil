/**
 * Per-room collaboration mapping state for a `SceneGraph`.
 *
 * A single graph can be connected to at most one collaboration room at a time,
 * so this state lives on the graph itself and is reset whenever the local user
 * joins a different room.
 *
 * Framework-agnostic: this module has no dependency on Yjs or any app code.
 */
export interface GraphSyncState {
  /** Remote stable id -> local runtime id. */
  remoteToLocal: Map<string, string>
  /** Local runtime id -> remote stable id. */
  localToRemote: Map<string, string>
  /** Parent stable id -> set of waiting child stable ids. */
  pendingParents: Map<string, Set<string>>
  /** Component stable id -> set of waiting instance stable ids. */
  pendingComponents: Map<string, Set<string>>
  /** Child stable id -> set of pending override keys waiting for that child. */
  pendingOverrideKeys: Map<
    string,
    Set<{
      /** Stable id of the instance that owns the pending override. */
      remoteStableId: string
      /** Property name from the override key. */
      prop: string
      /** Raw override value received from the remote peer. */
      value: unknown
    }>
  >
  /** Stable ids buffered until the host root is reconciled. */
  pendingUntilRoot: Set<string>
  /** True once the host root has been mapped into this graph. */
  rootMapped: boolean
  /** Authoritative root stable id for the current room. */
  remoteRootStableId: string | null
  /** Remote variable stable id -> local variable runtime id. */
  variableToLocal: Map<string, string>
  /** Local variable runtime id -> remote variable stable id. */
  localToVariable: Map<string, string>
  /** Remote collection stable id -> local collection runtime id. */
  collectionToLocal: Map<string, string>
  /** Local collection runtime id -> remote collection stable id. */
  localToCollection: Map<string, string>
  /** Remote mode stable id -> local mode runtime id. */
  modeToLocal: Map<string, string>
  /** Collection stable id -> set of waiting variable stable ids. */
  pendingVariableCollections: Map<string, Set<string>>
  /** Variable stable id -> set of pending boundVariables bindings waiting for that variable. */
  pendingVariableBindings: Map<
    string,
    Set<{
      /** Stable id of the node that owns the pending binding. */
      nodeStableId: string
      /** Field name in boundVariables (e.g., 'fills', 'opacity'). */
      field: string
    }>
  >
}

export function createGraphSyncState(): GraphSyncState {
  return {
    remoteToLocal: new Map(),
    localToRemote: new Map(),
    pendingParents: new Map(),
    pendingComponents: new Map(),
    pendingOverrideKeys: new Map(),
    pendingUntilRoot: new Set(),
    rootMapped: false,
    remoteRootStableId: null,
    variableToLocal: new Map(),
    localToVariable: new Map(),
    collectionToLocal: new Map(),
    localToCollection: new Map(),
    modeToLocal: new Map(),
    pendingVariableCollections: new Map(),
    pendingVariableBindings: new Map()
  }
}

export function resetGraphSyncState(state: GraphSyncState): void {
  state.remoteToLocal.clear()
  state.localToRemote.clear()
  state.pendingParents.clear()
  state.pendingComponents.clear()
  state.pendingOverrideKeys.clear()
  state.pendingUntilRoot.clear()
  state.rootMapped = false
  state.remoteRootStableId = null
  state.variableToLocal.clear()
  state.localToVariable.clear()
  state.collectionToLocal.clear()
  state.localToCollection.clear()
  state.modeToLocal.clear()
  state.pendingVariableCollections.clear()
  state.pendingVariableBindings.clear()
}
