// Barrel re-export — preserves the public API surface of the original
// monolithic yjs-sync.ts. Consumers import from '@/app/collab/yjs-sync'
// which resolves to this index.ts.
export { EXCLUDED_SYNC_KEYS, YJS_NODE_PROPERTY_KEYS } from './constants'
export type { ReconcileRootFn } from './constants'
export {
  stableIdForNode,
  stableIdForRuntimeId,
  findNodeByStableId,
  findStableIdForYMap,
  toRuntimeId,
  resetCollabDevCounters
} from './mapping'
export {
  appendRemoteNodeKeySegment,
  decodeRemoteNodeKey,
  isMalformedRemoteNodeKey,
  originalStableIdFromRemoteNodeKey,
  rawStableIdFromRemoteNodeKey,
  remoteNodeKeyForStableId
} from './remote-node-key'
export {
  asString,
  isRecord,
  isSceneNodeType,
  yNodeToProps,
  syncNodePropsToYMap,
  syncLocalRootToYjs,
  buildCreateProps,
  buildUpdateProps
} from './serialize'
export { applyYnodeToGraph, removeFromPendingQueues } from './graph-apply'
export {
  applyInstanceOverrideValuesToChildren,
  findInstanceDescendantByStableId,
  findInstanceDescendantByStablePath,
  findOwningComponentBackedInstance,
  findOwningInstance,
  isComponentBackedInstanceDescendant,
  isInstanceDescendant,
  mergeInstanceDescendantOverridesForYjs,
  resolveInstanceOverrideChildId
} from './instance-descendants'
export { fallbackRootPageId, removeLocalRootChildrenForRemoteAdoption } from './root-adoption'
export { bindCollabGraphEvents, registerYjsObservers, createYjsGraphSync } from './sync'
export {
  stableIdForVariable,
  stableIdForCollection,
  stableIdForMode,
  ensureVariableMapping,
  ensureCollectionMapping,
  toVariableRuntimeId,
  toCollectionRuntimeId,
  toModeRuntimeId,
  syncVariableToYjs,
  syncCollectionToYjs,
  syncAllVariablesToYjs,
  remapBoundVariablesToRemote,
  remapBoundVariablesToLocal
} from './variable/sync'
export {
  applyVariableToGraph,
  applyCollectionToGraph,
  applyYjsVariablesToGraph,
  applyYjsCollectionsToGraph
} from './variable/apply'
export { releasePendingVariableBindings } from './pending-variables'
