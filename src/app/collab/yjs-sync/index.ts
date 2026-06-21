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
  toRuntimeId
} from './mapping'
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
export { applyYnodeToGraph } from './graph-apply'
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
} from './variables'
export {
  applyVariableToGraph,
  applyCollectionToGraph,
  applyYjsVariablesToGraph,
  applyYjsCollectionsToGraph,
  releasePendingVariableBindings
} from './variable-apply'
