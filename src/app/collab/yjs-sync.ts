import * as Y from 'yjs'

import { createDefaultSource, splitOverrideKey } from '@open-pencil/core/scene-graph'
import type {
  GraphSyncState,
  SceneGraph,
  SceneNode,
  SourceMetadata
} from '@open-pencil/core/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import { YJS_JSON_FIELDS } from '@/constants'

type YNodes = Y.Map<Y.Map<unknown>>
type YImages = Y.Map<Uint8Array>

type GraphBindingOptions = {
  store: EditorStore
  getYdoc: () => Y.Doc | null
  getYnodes: () => YNodes | null
  getSuppressGraphSync: () => boolean
  setSuppressYjsEvents: (value: boolean) => void
  syncNodeToYjs: (nodeId: string) => void
}

export type ReconcileRootFn = (
  store: EditorStore,
  remoteRootStableId: string,
  ynode: Y.Map<unknown>,
  ynodes: YNodes
) => void

type YjsObserverOptions = {
  store: EditorStore
  ynodes: Y.Map<Y.Map<unknown>>
  yimages: Y.Map<Uint8Array>
  getSuppressYjsEvents: () => boolean
  setSuppressGraphSync: (value: boolean) => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  reconcileRemoteRoot?: ReconcileRootFn
}

type YjsGraphSyncOptions = {
  getStore: () => EditorStore
  getYdoc: () => Y.Doc | null
  getYnodes: () => YNodes | null
  getYimages: () => YImages | null
  setSuppressYjsEvents: (value: boolean) => void
}

export const EXCLUDED_SYNC_KEYS = new Set<string>([
  'childIds',
  'source',
  'fillGeometry',
  'strokeGeometry',
  'textPicture',
  'figmaDerivedLayout',
  'figmaDerivedTextGlyphs'
])

export const YJS_NODE_PROPERTY_KEYS = new Set<string>([
  'id',
  'type',
  'name',
  'parentId',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'locked',
  'clipsContent',
  'blendMode',
  'fills',
  'strokes',
  'effects',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'independentCorners',
  'cornerSmoothing',
  'text',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'italic',
  'textAlignHorizontal',
  'textDirection',
  'textAlignVertical',
  'textAutoResize',
  'textCase',
  'textDecoration',
  'textDecorationStyle',
  'textDecorationThickness',
  'textDecorationFills',
  'textDecorationSkipInk',
  'textUnderlineOffset',
  'leadingTrim',
  'lineHeight',
  'letterSpacing',
  'maxLines',
  'styleRuns',
  'fontVariations',
  'fontFeatures',
  'horizontalConstraint',
  'verticalConstraint',
  'constraints',
  'layoutMode',
  'layoutDirection',
  'layoutWrap',
  'primaryAxisAlign',
  'counterAxisAlign',
  'primaryAxisSizing',
  'counterAxisSizing',
  'itemSpacing',
  'counterAxisSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'layoutPositioning',
  'layoutGrow',
  'layoutAlignSelf',
  'vectorNetwork',
  'booleanOperation',
  'arcData',
  'strokeCap',
  'strokeJoin',
  'dashPattern',
  'borderTopWeight',
  'borderRightWeight',
  'borderBottomWeight',
  'borderLeftWeight',
  'independentStrokeWeights',
  'strokeMiterLimit',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'isMask',
  'maskType',
  'maskIsOutline',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumnGap',
  'gridRowGap',
  'gridPosition',
  'counterAxisAlignContent',
  'itemReverseZIndex',
  'strokesIncludedInLayout',
  'expanded',
  'textTruncation',
  'autoRename',
  'pointCount',
  'starInnerRadius',
  'componentId',
  'overrides',
  'componentPropertyDefinitions',
  'componentPropertyValues',
  'componentKey',
  'sourceLibraryKey',
  'publishId',
  'overrideKey',
  'sharedSymbolVersion',
  'publishedVersion',
  'isPublishable',
  'isSymbolPublishable',
  'symbolDescription',
  'symbolLinks',
  'variantPropSpecs',
  'boundVariables',
  'exportSettings',
  'pluginData',
  'pluginRelaunchData',
  'internalOnly',
  'flipX',
  'flipY',
  'sourceId',
  'sourceFormat',
  'sourceFig'
])

const JSON_PROPERTY_KEYS = new Set<string>([
  ...YJS_JSON_FIELDS,
  'constraints',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridPosition',
  'pluginData',
  'pluginRelaunchData',
  'textDecorationFills',
  'fontVariations',
  'fontFeatures',
  'arcData',
  'componentPropertyDefinitions',
  'componentPropertyValues',
  'symbolLinks',
  'variantPropSpecs',
  'exportSettings',
  'dashPattern',
  'overrides'
])

export function stableIdForNode(node: SceneNode): string {
  return node.source.id ?? node.id
}

/**
 * Returns the remote stable id for a local node, backfilling the bidirectional
 * local<->remote mapping when it has not been recorded yet.
 *
 * The outbound sync paths (syncNodeToYjs / syncAllNodesToYjs) key Yjs by the
 * node's stable id but historically derived that id without recording it in
 * state. That left the `node:deleted` handler in bindCollabGraphEvents unable
 * to look up the remote key, so locally-created nodes could not be deleted
 * through the live graph-event bridge. Backfilling here makes the delete path
 * work without any caller change and with no effect on the Yjs keying (the
 * derived value is identical to the previous `?? stableIdForNode(node)` fallback).
 *
 * The root is intentionally not handled here: its mapping is owned by
 * `remoteRootStableId` and is pre-seeded by makeHostRootState / reconcileRemoteRoot.
 */
function ensureRemoteMapping(state: GraphSyncState, node: SceneNode): string {
  const existing = state.localToRemote.get(node.id)
  if (existing !== undefined) return existing
  const remoteStableId = stableIdForNode(node)
  state.localToRemote.set(node.id, remoteStableId)
  // Don't overwrite an existing reverse mapping that points to a different
  // node. Duplicate stable ids are handled by the importer's GUID remediation,
  // but this guard prevents the node:deleted handler from resolving to the
  // wrong local node if a duplicate ever slips through. The first node to
  // sync outbound wins the reverse mapping; subsequent nodes with the same
  // stable id still get a forward mapping (so their deletes can find the key)
  // but don't displace the canonical reverse mapping.
  if (state.remoteToLocal.get(remoteStableId) === undefined) {
    state.remoteToLocal.set(remoteStableId, node.id)
  }
  return remoteStableId
}

function* addedOrUpdatedYnodes(
  events: Y.YEvent<Y.Map<unknown>>[],
  ynodes: YNodes
): Generator<{ remoteStableId: string; ynode: Y.Map<unknown> }> {
  for (const event of events) {
    if (event.target === ynodes) {
      for (const [remoteStableId, change] of event.changes.keys) {
        if (change.action === 'add' || change.action === 'update') {
          const ynode = ynodes.get(remoteStableId)
          if (ynode !== undefined) {
            yield { remoteStableId, ynode }
          }
        }
      }
    }
  }
}

export function stableIdForRuntimeId(
  graph: SceneGraph,
  state: GraphSyncState,
  runtimeId: string | null | undefined
): string | null {
  if (runtimeId === null || runtimeId === undefined) return null
  if (runtimeId === graph.rootId) return state.remoteRootStableId
  const node = graph.getNode(runtimeId)
  if (node === undefined) return null
  return stableIdForNode(node)
}

export function findNodeByStableId(graph: SceneGraph, stableId: string): SceneNode | undefined {
  for (const node of graph.getAllNodes()) {
    if (stableIdForNode(node) === stableId) return node
  }
  return undefined
}

export function findStableIdForYMap(ynodes: YNodes, ynode: Y.Map<unknown>): string | null {
  for (const [stableId, candidate] of ynodes.entries()) {
    if (candidate === ynode) return stableId
  }
  return null
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

type NodeProps = Record<string, unknown>

export function isRecord(value: unknown): value is NodeProps {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSceneNodeType(value: unknown): value is SceneNode['type'] {
  const known: readonly string[] = [
    'DOCUMENT',
    'CANVAS',
    'FRAME',
    'GROUP',
    'VECTOR',
    'BOOLEAN_OPERATION',
    'STAR',
    'LINE',
    'ELLIPSE',
    'POLYGON',
    'RECTANGLE',
    'TEXT',
    'SLICE',
    'COMPONENT',
    'COMPONENT_SET',
    'INSTANCE',
    'SECTION',
    'CONNECTOR',
    'SHAPE_WITH_TEXT',
    'ROUNDED_RECTANGLE'
  ]
  return typeof value === 'string' && known.includes(value)
}

export function yNodeToProps(ynode: Y.Map<unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {}

  function parseValue(key: string, value: unknown): unknown {
    if (typeof value !== 'string' || key === 'sourceFig' || key === 'childIds') return value
    if (!JSON_PROPERTY_KEYS.has(key)) return value
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  for (const [key, value] of ynode.entries()) {
    if (EXCLUDED_SYNC_KEYS.has(key)) continue
    if (YJS_NODE_PROPERTY_KEYS.has(key)) {
      props[key] = parseValue(key, value)
    }
  }

  return props
}

function stringifyIfObject(value: unknown): unknown {
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value)
  }
  return value
}

export function syncNodePropsToYMap(
  node: SceneNode,
  ynode: Y.Map<unknown>,
  graph: SceneGraph,
  state: GraphSyncState
): void {
  const remoteStableId =
    node.id === graph.rootId ? stableIdForNode(node) : ensureRemoteMapping(state, node)
  ynode.set('id', remoteStableId)

  const parentStableId =
    node.id === graph.rootId
      ? state.remoteRootStableId
      : stableIdForRuntimeId(graph, state, node.parentId)
  ynode.set('parentId', parentStableId)

  const componentStableId = stableIdForRuntimeId(graph, state, node.componentId)
  ynode.set('componentId', componentStableId)

  if (node.type === 'INSTANCE' && Object.keys(node.overrides).length > 0) {
    const remapped = remapOverridesToRemote(graph, state, node.overrides)
    if (Object.keys(remapped).length > 0) {
      ynode.set('overrides', remapped)
    } else {
      ynode.delete('overrides')
    }
  } else {
    ynode.delete('overrides')
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' || key === 'parentId' || key === 'componentId' || key === 'overrides') continue
    if (key === 'source') {
      ynode.set('sourceId', node.source.id)
      ynode.set('sourceFormat', node.source.format)
      ynode.set('sourceFig', JSON.stringify(node.source.fig))
      continue
    }
    if (EXCLUDED_SYNC_KEYS.has(key)) continue
    if (!YJS_NODE_PROPERTY_KEYS.has(key)) continue
    ynode.set(key, stringifyIfObject(value))
  }

  // Allow-list keys that are absent on this node are intentionally left as-is;
  // deleting them would erase shared state for properties a peer does not set.
}

export function syncLocalRootToYjs(graph: SceneGraph, state: GraphSyncState, ynodes: YNodes): void {
  if (state.remoteRootStableId === null) return
  const root = graph.getNode(graph.rootId)
  if (root === undefined) return
  let ynode = ynodes.get(state.remoteRootStableId)
  if (ynode === undefined) {
    ynode = new Y.Map<unknown>()
    ynodes.set(state.remoteRootStableId, ynode)
  }
  syncNodePropsToYMap(root, ynode, graph, state)
}

function remapOverridesToRemote(
  graph: SceneGraph,
  state: GraphSyncState,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const remapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(overrides)) {
    const { childId, prop } = splitOverrideKey(key)
    const stableId = stableIdForRuntimeId(graph, state, childId)
    if (stableId === null) continue
    remapped[`${stableId}:${prop}`] = value
  }
  return remapped
}

export function toRuntimeId(
  graph: SceneGraph,
  state: GraphSyncState,
  stableId: string | null | undefined
): string | undefined {
  if (stableId === null || stableId === undefined) return undefined
  if (state.remoteRootStableId !== null && stableId === state.remoteRootStableId) {
    return graph.rootId
  }
  return state.remoteToLocal.get(stableId)
}

function assumeFigmaPayload(value: unknown): SourceMetadata['fig'] {
  return value as SourceMetadata['fig']
}

function tryParseSourceFig(value: unknown): SourceMetadata['fig'] | undefined {
  const str = asString(value)
  if (str === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(str)
    return isRecord(parsed) ? assumeFigmaPayload(parsed) : undefined
  } catch {
    return undefined
  }
}

function filterProps(props: NodeProps, exclude: readonly string[]): NodeProps {
  const result: NodeProps = {}
  for (const key of Object.keys(props)) {
    if (!exclude.includes(key)) {
      result[key] = props[key]
    }
  }
  return result
}

const CREATE_EXCLUDED_KEYS = [
  'id',
  'parentId',
  'componentId',
  'sourceFormat',
  'sourceFig',
  'sourceId',
  'childIds'
]

export function buildCreateProps(
  graph: SceneGraph,
  state: GraphSyncState,
  props: NodeProps,
  remoteStableId: string
): Partial<SceneNode> {
  const parentStableId = asString(props.parentId)
  const parentId =
    parentStableId !== undefined
      ? (toRuntimeId(graph, state, parentStableId) ?? graph.rootId)
      : graph.rootId

  let componentId: string | null = null
  if ('componentId' in props) {
    const raw = props.componentId
    componentId = raw === null ? null : (toRuntimeId(graph, state, asString(raw)) ?? null)
  }

  const sourceFormat = asString(props.sourceFormat)
  const sourceFig = tryParseSourceFig(props.sourceFig)

  const createProps = structuredClone(filterProps(props, [...CREATE_EXCLUDED_KEYS, 'overrides']))

  const remoteSourceId = asString(props.sourceId) ?? asString(props.id) ?? remoteStableId
  const source: SourceMetadata = {
    ...createDefaultSource(),
    id: remoteSourceId,
    format: sourceFormat === 'fig' ? 'fig' : null,
    fig: sourceFig ?? createDefaultSource().fig
  }

  return {
    ...createProps,
    id: undefined,
    parentId,
    componentId,
    source
  } as Partial<SceneNode>
}

export function buildUpdateProps(
  graph: SceneGraph,
  state: GraphSyncState,
  props: NodeProps,
  existing: SceneNode
): Partial<SceneNode> {
  const exclude: string[] = ['type']
  let parentId: string | undefined
  let componentId: string | null | undefined

  if ('parentId' in props) {
    const raw = props.parentId
    if (typeof raw === 'string') {
      parentId = toRuntimeId(graph, state, raw)
      if (parentId === undefined) {
        exclude.push('parentId')
      }
    }
  }

  if ('componentId' in props) {
    const raw = props.componentId
    if (raw === null) {
      componentId = null
    } else if (typeof raw === 'string') {
      componentId = toRuntimeId(graph, state, raw)
      if (componentId === undefined) {
        exclude.push('componentId')
      }
    }
  }

  const update = structuredClone(filterProps(props, [...CREATE_EXCLUDED_KEYS, ...exclude]))
  if (parentId !== undefined) {
    update.parentId = parentId
  }
  if (componentId !== undefined) {
    update.componentId = componentId
  }

  const overridesValue = update.overrides
  if (overridesValue !== undefined && isRecord(overridesValue)) {
    update.overrides = remapOverridesToLocal(
      graph,
      state,
      overridesValue,
      stableIdForNode(existing)
    )
  }

  return { ...update, id: existing.id } as Partial<SceneNode>
}

function remapOverridesToLocal(
  graph: SceneGraph,
  state: GraphSyncState,
  overrides: Record<string, unknown> | undefined,
  instanceRemoteStableId: string
): Record<string, unknown> {
  if (overrides === undefined) return {}
  const remapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(overrides)) {
    const { childId, prop } = splitOverrideKey(key)
    const localChildId = toRuntimeId(graph, state, childId)
    if (localChildId !== undefined) {
      remapped[`${localChildId}:${prop}`] = value
      continue
    }
    let set = state.pendingOverrideKeys.get(childId)
    if (set === undefined) {
      set = new Set()
      state.pendingOverrideKeys.set(childId, set)
    }
    set.add({ remoteStableId: instanceRemoteStableId, prop, value })
  }
  return remapped
}

function queuePending<K extends string, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key)
  if (set === undefined) {
    set = new Set()
    map.set(key, set)
  }
  set.add(value)
}

function releasePendingOverrideKeys(
  state: GraphSyncState,
  graph: SceneGraph,
  childStableId: string
): void {
  const entries = state.pendingOverrideKeys.get(childStableId)
  if (entries === undefined) return
  const localChildId = toRuntimeId(graph, state, childStableId)
  if (localChildId === undefined) {
    state.pendingOverrideKeys.delete(childStableId)
    return
  }

  // Group pending entries by the instance that owns them so each instance gets a
  // single merged update. Applying entries one at a time would replace
  // `node.overrides` on every call (graph.updateNode assigns the field rather than
  // merging per-key), clobbering both other pending entries for the same instance
  // and any overrides that were already resolved on it.
  const byInstance = new Map<string, Array<{ prop: string; value: unknown }>>()
  for (const entry of entries) {
    let list = byInstance.get(entry.remoteStableId)
    if (list === undefined) {
      list = []
      byInstance.set(entry.remoteStableId, list)
    }
    list.push({ prop: entry.prop, value: entry.value })
  }

  for (const [instanceStableId, list] of byInstance) {
    const localId = state.remoteToLocal.get(instanceStableId)
    const existing = localId === undefined ? undefined : graph.getNode(localId)
    if (existing === undefined) continue
    // Keys are already in LOCAL child-id form, so merge directly into the
    // existing overrides map instead of routing through buildUpdateProps /
    // remapOverridesToLocal (which expect remote-stable child ids and would
    // re-queue the already-local keys as pending).
    const merged: Record<string, unknown> = { ...existing.overrides }
    for (const { prop, value } of list) {
      merged[`${localChildId}:${prop}`] = value
    }
    graph.updateNode(existing.id, { overrides: merged })
  }
  state.pendingOverrideKeys.delete(childStableId)
}

function releasePendingNode(
  state: GraphSyncState,
  graph: SceneGraph,
  ynodes: YNodes,
  remoteStableId: string
): void {
  const waitingChildren = state.pendingParents.get(remoteStableId)
  if (waitingChildren !== undefined) {
    for (const childStableId of waitingChildren) {
      const childYnode = ynodes.get(childStableId)
      if (childYnode !== undefined) {
        applyYnodeToGraph(graph, state, ynodes, childStableId, childYnode)
      }
    }
    state.pendingParents.delete(remoteStableId)
  }

  const waitingInstances = state.pendingComponents.get(remoteStableId)
  if (waitingInstances !== undefined) {
    for (const instStableId of waitingInstances) {
      const instYnode = ynodes.get(instStableId)
      if (instYnode !== undefined) {
        applyYnodeToGraph(graph, state, ynodes, instStableId, instYnode)
      }
    }
    state.pendingComponents.delete(remoteStableId)
  }

  releasePendingOverrideKeys(state, graph, remoteStableId)
}

export function applyYnodeToGraph(
  graph: SceneGraph,
  state: GraphSyncState,
  ynodes: YNodes,
  remoteStableId: string,
  ynode: Y.Map<unknown>
): void {
  const props = yNodeToProps(ynode)

  if (!state.rootMapped && remoteStableId !== state.remoteRootStableId) {
    state.pendingUntilRoot.add(remoteStableId)
    return
  }

  const parentStableId = asString(props.parentId)
  if (parentStableId !== undefined) {
    const parentId = toRuntimeId(graph, state, parentStableId)
    if (parentId === undefined) {
      queuePending(state.pendingParents, parentStableId, remoteStableId)
      return
    }
  }

  const componentStableId = asString(props.componentId)
  if (componentStableId !== undefined) {
    const componentId = toRuntimeId(graph, state, componentStableId)
    if (componentId === undefined) {
      queuePending(state.pendingComponents, componentStableId, remoteStableId)
      return
    }
  }

  const existing = findExistingLocalNode(graph, state, remoteStableId)
  if (existing !== undefined) {
    applyExistingNodeUpdate(graph, state, props, existing)
  } else {
    applyNewNodeCreate(graph, state, props, remoteStableId)
  }

  releasePendingNode(state, graph, ynodes, remoteStableId)
}

function findExistingLocalNode(
  graph: SceneGraph,
  state: GraphSyncState,
  remoteStableId: string
): SceneNode | undefined {
  const localId = state.remoteToLocal.get(remoteStableId)
  if (localId !== undefined) {
    return graph.getNode(localId) ?? findNodeByStableId(graph, remoteStableId)
  }
  const found = findNodeByStableId(graph, remoteStableId)
  if (found !== undefined) {
    state.remoteToLocal.set(remoteStableId, found.id)
    state.localToRemote.set(found.id, remoteStableId)
  }
  return found
}

function applyExistingNodeUpdate(
  graph: SceneGraph,
  state: GraphSyncState,
  props: NodeProps,
  existing: SceneNode
): void {
  const updateProps = buildUpdateProps(graph, state, props, existing)
  if (typeof updateProps.parentId === 'string' && updateProps.parentId !== existing.parentId) {
    graph.reparentNode(existing.id, updateProps.parentId)
    delete updateProps.parentId
  }
  graph.updateNode(existing.id, updateProps)

  const updatedNode = graph.getNode(existing.id)
  if (
    updatedNode?.type === 'INSTANCE' &&
    typeof updatedNode.componentId === 'string' &&
    updatedNode.childIds.length === 0
  ) {
    graph.populateInstanceChildren(updatedNode.id, updatedNode.componentId)
  }
}

function applyNewNodeCreate(
  graph: SceneGraph,
  state: GraphSyncState,
  props: NodeProps,
  remoteStableId: string
): void {
  const createProps = buildCreateProps(graph, state, props, remoteStableId)
  const typeCandidate = typeof createProps.type === 'string' ? createProps.type : 'FRAME'
  if (!isSceneNodeType(typeCandidate)) return

  const node = graph.createNode(typeCandidate, createProps.parentId ?? graph.rootId, createProps)
  state.remoteToLocal.set(remoteStableId, node.id)
  state.localToRemote.set(node.id, remoteStableId)

  if (props.overrides !== undefined && isRecord(props.overrides)) {
    node.overrides = remapOverridesToLocal(graph, state, props.overrides, remoteStableId)
  }
}

function removeFromPendingQueues(state: GraphSyncState, remoteStableId: string): void {
  const localId = state.remoteToLocal.get(remoteStableId)
  state.remoteToLocal.delete(remoteStableId)
  if (localId !== undefined) {
    state.localToRemote.delete(localId)
  }
  state.pendingParents.delete(remoteStableId)
  state.pendingComponents.delete(remoteStableId)
  state.pendingOverrideKeys.delete(remoteStableId)
  state.pendingUntilRoot.delete(remoteStableId)
  // Clean up pending overrides that reference this node as the owning
  // instance. pendingOverrideKeys is keyed by CHILD stable id, but each
  // entry's remoteStableId is the INSTANCE's stable id. When an instance is
  // deleted, its pending overrides (for children that may never arrive
  // locally) would otherwise leak until session end. Map iteration is safe
  // for in-place delete/set on visited entries per the ECMAScript spec.
  for (const [childStableId, entries] of state.pendingOverrideKeys) {
    const remaining = [...entries].filter((e) => e.remoteStableId !== remoteStableId)
    if (remaining.length === entries.size) continue
    if (remaining.length === 0) {
      state.pendingOverrideKeys.delete(childStableId)
    } else {
      state.pendingOverrideKeys.set(childStableId, new Set(remaining))
    }
  }
}

export function bindCollabGraphEvents({
  store,
  getYdoc,
  getYnodes,
  getSuppressGraphSync,
  setSuppressYjsEvents,
  syncNodeToYjs
}: GraphBindingOptions) {
  function onGraphMutation(nodeId: string) {
    if (!getSuppressGraphSync() && getYdoc() && getYnodes()) {
      syncNodeToYjs(nodeId)
    }
  }

  const unbinds = [
    store.onEditorEvent('node:updated', (id) => onGraphMutation(id)),
    store.onEditorEvent('node:created', (node) => onGraphMutation(node.id)),
    store.onEditorEvent('node:reparented', (nodeId) => onGraphMutation(nodeId)),
    store.onEditorEvent('node:reordered', (nodeId) => onGraphMutation(nodeId)),
    store.onEditorEvent('node:deleted', (id) => {
      const ydoc = getYdoc()
      const ynodes = getYnodes()
      if (!getSuppressGraphSync() && ydoc && ynodes) {
        const state = store.graph.getSyncState()
        const remoteStableId = state.localToRemote.get(id)
        if (remoteStableId === undefined) return
        removeFromPendingQueues(state, remoteStableId)
        setSuppressYjsEvents(true)
        ydoc.transact(() => {
          ynodes.delete(remoteStableId)
        })
        setSuppressYjsEvents(false)
      }
    })
  ]
  return () => {
    for (const unbind of unbinds) unbind()
  }
}

function findRootCandidate(
  events: Y.YEvent<Y.Map<unknown>>[],
  ynodes: YNodes
): { remoteRootStableId: string; ynode: Y.Map<unknown> } | null {
  for (const { remoteStableId, ynode } of addedOrUpdatedYnodes(events, ynodes)) {
    const parentId = asString(ynode.get('parentId'))
    if (parentId === remoteStableId) {
      return { remoteRootStableId: remoteStableId, ynode }
    }
  }
  return null
}

export function registerYjsObservers({
  store,
  ynodes,
  yimages,
  getSuppressYjsEvents,
  setSuppressGraphSync,
  applyYjsToGraph,
  reconcileRemoteRoot
}: YjsObserverOptions) {
  ynodes.observeDeep((events) => {
    if (getSuppressYjsEvents()) return
    const state = store.graph.getSyncState()
    if (state.remoteRootStableId === null) {
      const rootCandidate = findRootCandidate(events, ynodes)
      if (rootCandidate !== null && reconcileRemoteRoot !== undefined) {
        reconcileRemoteRoot(store, rootCandidate.remoteRootStableId, rootCandidate.ynode, ynodes)
      }
    }
    setSuppressGraphSync(true)
    try {
      applyYjsToGraph(events)
    } finally {
      setSuppressGraphSync(false)
    }
    store.requestRender()
  })

  yimages.observe((event) => {
    if (getSuppressYjsEvents()) return
    for (const [key, change] of event.changes.keys) {
      if (change.action === 'add' || change.action === 'update') {
        const data = yimages.get(key)
        if (data) store.graph.images.set(key, new Uint8Array(data))
      } else {
        store.graph.images.delete(key)
      }
    }
    store.requestRender()
  })
}

export function createYjsGraphSync({
  getStore,
  getYdoc,
  getYnodes,
  getYimages,
  setSuppressYjsEvents
}: YjsGraphSyncOptions) {
  function syncNodeToYjs(nodeId: string) {
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ydoc || !ynodes) return
    const node = store.graph.getNode(nodeId)
    if (!node) return

    const graph = store.graph
    const state = graph.getSyncState()
    if (state.remoteRootStableId === null) return
    const remoteRootStableId = state.remoteRootStableId

    const localYimages = getYimages()
    setSuppressYjsEvents(true)
    ydoc.transact(() => {
      let ynode: Y.Map<unknown> | undefined
      if (nodeId === graph.rootId) {
        ynode = ynodes.get(remoteRootStableId)
        if (ynode === undefined) {
          ynode = new Y.Map<unknown>()
          ynodes.set(remoteRootStableId, ynode)
        }
      } else {
        const remoteStableId = ensureRemoteMapping(state, node)
        ynode = ynodes.get(remoteStableId)
        if (ynode === undefined) {
          ynode = new Y.Map<unknown>()
          ynodes.set(remoteStableId, ynode)
        }
      }
      syncNodePropsToYMap(node, ynode, graph, state)

      if (localYimages) {
        for (const fill of node.fills) {
          if (fill.imageHash && !localYimages.has(fill.imageHash)) {
            const data = store.graph.images.get(fill.imageHash)
            if (data) localYimages.set(fill.imageHash, data)
          }
        }
      }
    })
    setSuppressYjsEvents(false)
  }

  function syncAllNodesToYjs() {
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ydoc || !ynodes) return

    const graph = store.graph
    const state = graph.getSyncState()
    if (state.remoteRootStableId === null) return

    const localYimages = getYimages()
    setSuppressYjsEvents(true)
    ydoc.transact(() => {
      syncLocalRootToYjs(graph, state, ynodes)
      for (const node of store.graph.getAllNodes()) {
        if (node.id === graph.rootId) continue
        const remoteStableId = ensureRemoteMapping(state, node)
        let ynode = ynodes.get(remoteStableId)
        if (ynode === undefined) {
          ynode = new Y.Map<unknown>()
          ynodes.set(remoteStableId, ynode)
        }
        syncNodePropsToYMap(node, ynode, graph, state)
      }
    })
    if (localYimages) {
      ydoc.transact(() => {
        for (const [hash, data] of store.graph.images) {
          if (!localYimages.has(hash)) {
            localYimages.set(hash, data)
          }
        }
      })
    }
    setSuppressYjsEvents(false)
  }

  function applyYjsToGraph(events: Y.YEvent<Y.Map<unknown>>[]) {
    const store = getStore()
    const ynodes = getYnodes()
    if (ynodes === null) return
    const graph = store.graph
    const state = graph.getSyncState()

    for (const { remoteStableId, ynode } of addedOrUpdatedYnodes(events, ynodes)) {
      applyYnodeToGraph(graph, state, ynodes, remoteStableId, ynode)
    }

    for (const event of events) {
      if (event.target !== ynodes) {
        if (event.target.parent === ynodes) {
          const remoteStableId = findStableIdForYMap(ynodes, event.target)
          if (remoteStableId !== null) {
            const ynode = ynodes.get(remoteStableId)
            if (ynode !== undefined) {
              applyYnodeToGraph(graph, state, ynodes, remoteStableId, ynode)
            }
          }
        }
        continue
      }
      for (const [remoteStableId, change] of event.changes.keys) {
        if (change.action === 'delete') {
          const localId = state.remoteToLocal.get(remoteStableId)
          if (localId !== undefined) {
            store.graph.deleteNode(localId, { permanent: true })
          }
          removeFromPendingQueues(state, remoteStableId)
        }
      }
    }
  }

  return { syncNodeToYjs, syncAllNodesToYjs, applyYjsToGraph }
}
