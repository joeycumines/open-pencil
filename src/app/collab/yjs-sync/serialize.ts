import * as Y from 'yjs'

import { createDefaultSource, splitOverrideKey } from '@open-pencil/core/scene-graph'
import type {
  GraphSyncState,
  SceneGraph,
  SceneNode,
  SourceMetadata
} from '@open-pencil/core/scene-graph'

import {
  EXCLUDED_SYNC_KEYS,
  JSON_PROPERTY_KEYS,
  YJS_NODE_PROPERTY_KEYS,
  type NodeProps,
  type YNodes
} from './constants'
import { ensureRemoteMapping, stableIdForNode, stableIdForRuntimeId, toRuntimeId } from './mapping'

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

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

export function yNodeToProps(ynode: Y.Map<unknown>): NodeProps {
  const props: NodeProps = {}

  function parseValue(key: string, value: unknown): unknown {
    if (typeof value !== 'string' || key === 'sourceFig') return value
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
    if (key === 'childIds') {
      // Serialize childIds as stable IDs (not runtime IDs) so that
      // layer ordering survives across peers with different runtime IDs
      const childStableIds = (value as string[])
        .map((id) => {
          const child = graph.getNode(id)
          return child ? stableIdForNode(child) : null
        })
        .filter((id): id is string => id !== null)
      ynode.set('childIds', JSON.stringify(childStableIds))
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

function parseFigmaPayload(value: unknown): SourceMetadata['fig'] | undefined {
  if (!isRecord(value)) return undefined
  // Validate known fields — reject unexpected types to prevent type confusion
  // from malformed or malicious remote peer data
  if (value.rawSize !== null && typeof value.rawSize !== 'object') return undefined
  if (value.rawTransform !== null && typeof value.rawTransform !== 'object') return undefined
  if (value.rawNodeFields !== undefined && typeof value.rawNodeFields !== 'object') return undefined
  if (value.layout !== null && typeof value.layout !== 'object') return undefined
  if (value.symbolOverrides !== undefined && !Array.isArray(value.symbolOverrides)) return undefined
  if (
    value.componentPropAssignments !== undefined &&
    !Array.isArray(value.componentPropAssignments)
  )
    return undefined
  if (value.derivedSymbolData !== undefined && !Array.isArray(value.derivedSymbolData))
    return undefined
  if (
    value.derivedSymbolDataLayoutVersion !== null &&
    typeof value.derivedSymbolDataLayoutVersion !== 'number'
  )
    return undefined
  if (value.uniformScaleFactor !== null && typeof value.uniformScaleFactor !== 'number')
    return undefined
  // Merge validated fields over defaults
  return { ...createDefaultSource().fig, ...value } as SourceMetadata['fig']
}

function tryParseSourceFig(value: unknown): SourceMetadata['fig'] | undefined {
  const str = asString(value)
  if (str === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(str)
    return parseFigmaPayload(parsed)
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
  const exclude: string[] = ['type', 'childIds']
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

export function remapOverridesToLocal(
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
