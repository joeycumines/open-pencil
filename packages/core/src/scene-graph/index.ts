export * from './snap'
export * from './export-scale'
export { UndoManager, type UndoEntry, type UndoManagerOptions } from './undo'
export { CONTAINER_TYPES, createDefaultNode, createDefaultSource } from './node/defaults'
export { SceneGraphIdentity, type SceneGraphIdentityHost } from './identity'
export { generateId } from './identity'
export { splitOverrideKey, joinOverrideKey } from './override-key'
export { migrateOverrideKeys } from './override-key-migrate'
export { createGraphSyncState, resetGraphSyncState, type GraphSyncState } from './sync-state'

import { omit } from 'es-toolkit/object'
import { createNanoEvents } from 'nanoevents'

import * as HitTest from './hit-test'
import { SceneGraphIdentity } from './identity'
import * as Instances from './instances'
import { cloneTree as cloneTreeImpl } from './node/clone'
import { CONTAINER_TYPES, createDefaultNode, createDefaultSource } from './node/defaults'
import { deleteNode as deleteNodeImpl } from './node/delete'
import { reorderChild as reorderChildImpl } from './node/reorder'
import { reparentNode as reparentNodeImpl } from './node/reparent'
import { restoreNodeInPlace } from './node/restore'
import {
  countDescendants as countNodeDescendants,
  flattenTree as flattenNodeTree,
  removeStaleBindings
} from './node/tree'
import { applyComponentIdChange, clearTextCaches, guardSourceChanges } from './node/update'
import { updateNodePreview } from './preview'
import { clearEditedSourceMetadata } from './source-metadata'
import { createGraphSyncState, resetGraphSyncState, type GraphSyncState } from './sync-state'
import { TEXT_PICTURE_KEYS } from './text-picture'
import * as Variables from './variables'
import { normalizeVectorNetwork } from './vector-network'

export type { GUID, Color } from '#core/types'
export * from './types'

import type { Emitter } from 'nanoevents'

import { getAbsolutePosition } from '#core/canvas/coordinate'
import type { Color, Rect, Vector } from '#core/types'

import type {
  CreateNodeOptions,
  DocumentColorSpace,
  FigImportDiagnostics,
  NodeType,
  SceneGraphEventHandlers,
  SceneGraphEvents,
  SceneGraphOptions,
  SceneNode,
  SourceMetadata,
  Variable,
  VariableCollection,
  VariableType,
  VariableValue
} from './types'

export { cloneVectorNetwork, normalizeVectorNetwork, validateVectorNetwork } from './vector-network'

const LAYOUT_AFFECTING_KEYS: ReadonlySet<string> = new Set([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'flipX',
  'flipY',
  'layoutMode',
  'layoutDirection',
  'itemSpacing',
  'counterAxisSpacing',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'primaryAxisAlign',
  'counterAxisAlign',
  'counterAxisAlignContent',
  'layoutWrap',
  'primaryAxisSizing',
  'counterAxisSizing',
  'layoutPositioning',
  'layoutGrow',
  'layoutAlignSelf',
  'strokesIncludedInLayout',
  'horizontalConstraint',
  'verticalConstraint',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumnGap',
  'gridRowGap',
  'gridPosition',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight'
])

export class SceneGraph {
  readonly identity: SceneGraphIdentity
  readonly sessionID: number
  readonly documentGuid: string
  nodes = new Map<string, SceneNode>()
  images = new Map<string, Uint8Array>()
  variables = new Map<string, Variable>()
  variableCollections = new Map<string, VariableCollection>()
  activeMode = new Map<string, string>()
  rootId: string
  figKiwiVersion: number | null = null
  /** Deflated kiwi schema bytes from the original .fig file, preserved for roundtrip fidelity. */
  figSchemaDeflated: Uint8Array | null = null
  documentColorSpace: DocumentColorSpace = 'display-p3'
  importDiagnostics: FigImportDiagnostics | undefined = undefined
  readonly emitter: Emitter<SceneGraphEvents> = createNanoEvents()
  private absPosCache = new Map<string, Vector>()
  private previewMutationDepth = 0
  private sourceMetadataPreservationDepth = 0
  positionPreviewVersion = 0
  instanceIndex = new Map<string, Set<string>>()
  private syncState: GraphSyncState | null = null

  constructor(options?: SceneGraphOptions) {
    this.identity = new SceneGraphIdentity(this, options)
    this.sessionID = this.identity.sessionID
    this.documentGuid = this.identity.documentGuid

    const rootSource = options?.rootSource
    const explicitRootId = options?.rootId
    let root: SceneNode

    if (rootSource && explicitRootId) {
      root = createDefaultNode(() => explicitRootId, 'FRAME', {
        name: 'Document',
        width: 0,
        height: 0,
        source: { ...createDefaultSource(), ...rootSource, id: rootSource.id }
      })
    } else {
      const stableId = this.identity.generateStableId()
      root = createDefaultNode(() => this.identity.generateNodeId(stableId), 'FRAME', {
        name: 'Document',
        width: 0,
        height: 0,
        source: { ...createDefaultSource(), id: stableId }
      })
    }

    this.rootId = root.id
    this.nodes.set(root.id, root)

    this.addPage('Page 1')
  }

  addPage(name: string, pageId?: string, source?: SourceMetadata): SceneNode {
    if (pageId && source) {
      return this.createNode(
        'CANVAS',
        this.rootId,
        { name, width: 0, height: 0, id: pageId, source },
        { mode: 'restore' }
      )
    }
    return this.createNode('CANVAS', this.rootId, { name, width: 0, height: 0 })
  }

  generateStableId(): string {
    return this.identity.generateStableId()
  }

  generateNodeId(preferred?: string | null): string {
    return this.identity.generateNodeId(preferred)
  }

  generateImporterRemediationId(allocatedInThisImport: ReadonlySet<string>): string {
    return this.identity.generateImporterRemediationId(allocatedInThisImport)
  }

  reserveRuntimeIds(ids: Iterable<string>): void {
    this.identity.reserveRuntimeIds(ids)
  }

  unreserveRuntimeId(id: string): void {
    this.identity.unreserveRuntimeId(id)
  }

  getImportedRuntimeIds(): ReadonlySet<string> {
    return this.identity.getImportedRuntimeIds()
  }

  recomputeReservedRuntimeIds(): void {
    this.identity.recomputeReservedRuntimeIds()
  }

  getStableId(node: SceneNode): string {
    return this.identity.getStableId(node)
  }

  stableIdToRuntimeId(stableId: string): string | undefined {
    return this.identity.stableIdToRuntimeId(stableId)
  }

  migrateLegacySourceIds(): void {
    this.identity.migrateLegacySourceIds()
  }

  getPages(includeInternal = false): SceneNode[] {
    return this.getChildren(this.rootId).filter(
      (n) => n.type === 'CANVAS' && (includeInternal || !n.internalOnly)
    )
  }
  getAllNodes(): Iterable<SceneNode> {
    return this.nodes.values()
  }
  getNode(id: string): SceneNode | undefined {
    return this.nodes.get(id)
  }
  onNodeEvents(handlers: SceneGraphEventHandlers): () => void {
    const unbinds = [
      handlers.created ? this.emitter.on('node:created', handlers.created) : null,
      handlers.updated ? this.emitter.on('node:updated', handlers.updated) : null,
      handlers.deleted ? this.emitter.on('node:deleted', handlers.deleted) : null,
      handlers.reparented ? this.emitter.on('node:reparented', handlers.reparented) : null,
      handlers.reordered ? this.emitter.on('node:reordered', handlers.reordered) : null
    ].filter((unbind): unbind is () => void => !!unbind)

    return () => {
      for (const unbind of unbinds) unbind()
    }
  }

  countDescendants(nodeId: string): number {
    return countNodeDescendants(this, nodeId)
  }
  // --- Variables ---
  addVariable(variable: Variable): void {
    Variables.addVariable(this, variable)
  }
  removeVariable(id: string): void {
    Variables.removeVariable(this, id)
  }
  addCollection(collection: VariableCollection): void {
    Variables.addCollection(this, collection)
  }
  createVariable(
    name: string,
    type: VariableType,
    collectionId: string,
    value?: VariableValue
  ): Variable {
    return Variables.createVariable(
      this,
      () => this.generateNodeId(),
      name,
      type,
      collectionId,
      value
    )
  }

  createCollection(name: string): VariableCollection {
    return Variables.createCollection(
      this,
      () => this.generateNodeId(),
      () => this.generateNodeId(),
      name
    )
  }

  removeCollection(id: string): void {
    Variables.removeCollection(this, id)
  }

  getActiveModeId(collectionId: string): string {
    return Variables.getActiveModeId(this, collectionId)
  }

  setActiveMode(collectionId: string, modeId: string): void {
    Variables.setActiveMode(this, collectionId, modeId)
  }

  addMode(collectionId: string, modeId: string, name: string, sourceMode?: string): void {
    Variables.addModeToCollection(this, collectionId, modeId, name, sourceMode)
  }

  removeMode(collectionId: string, modeId: string): void {
    Variables.removeMode(this, collectionId, modeId)
  }

  renameMode(collectionId: string, modeId: string, name: string): void {
    Variables.renameMode(this, collectionId, modeId, name)
  }

  setDefaultMode(collectionId: string, modeId: string): void {
    Variables.setDefaultMode(this, collectionId, modeId)
  }

  resolveVariable(
    variableId: string,
    modeId?: string,
    visited?: Set<string>
  ): VariableValue | undefined {
    return Variables.resolveVariable(this, variableId, modeId, visited)
  }

  resolveColorVariable(variableId: string): Color | undefined {
    return Variables.resolveColorVariable(this, variableId)
  }

  resolveNumberVariable(variableId: string): number | undefined {
    return Variables.resolveNumberVariable(this, variableId)
  }

  getVariablesForCollection(collectionId: string): Variable[] {
    return Variables.getVariablesForCollection(this, collectionId)
  }

  getVariablesByType(type: VariableType): Variable[] {
    return Variables.getVariablesByType(this, type)
  }

  bindVariable(nodeId: string, field: string, variableId: string): void {
    Variables.bindVariable(this, nodeId, field, variableId)
  }

  unbindVariable(nodeId: string, field: string): void {
    Variables.unbindVariable(this, nodeId, field)
  }

  getChildren(id: string): SceneNode[] {
    const node = this.nodes.get(id)
    if (!node) return []
    return node.childIds
      .map((cid) => this.nodes.get(cid))
      .filter((n): n is SceneNode => n !== undefined)
  }

  isContainer(id: string): boolean {
    const node = this.nodes.get(id)
    return node ? CONTAINER_TYPES.has(node.type) : false
  }

  isDescendant(childId: string, ancestorId: string): boolean {
    let current = this.nodes.get(childId)
    while (current) {
      if (current.id === ancestorId) return true
      current = current.parentId ? this.nodes.get(current.parentId) : undefined
    }
    return false
  }

  clearAbsPosCache(): void {
    this.absPosCache.clear()
  }

  getAbsolutePosition(id: string): Vector {
    const cached = this.absPosCache.get(id)
    if (cached) return cached

    const node = this.getNode(id)
    if (!node) return { x: 0, y: 0 }

    const result = getAbsolutePosition(node, this)
    this.absPosCache.set(id, result)
    return result
  }

  getAbsoluteBounds(id: string): Rect {
    const pos = this.getAbsolutePosition(id)
    const node = this.nodes.get(id)
    return {
      x: pos.x,
      y: pos.y,
      width: node?.width ?? 0,
      height: node?.height ?? 0
    }
  }

  createNode(
    type: NodeType,
    parentId: string,
    overrides: Partial<SceneNode> = {},
    options: CreateNodeOptions = {}
  ): SceneNode {
    const mode = options.mode ?? 'default'
    const stableId = this.identity.readRequestedStableId(overrides)
    const runtimeId = this.identity.pickRuntimeId(type, stableId, overrides.id, mode)

    // Restore mode may reuse an already-occupied runtime id when an existing node
    // shares the same type and stable id (see SceneGraphIdentity.pickRuntimeId).
    // In that case, update the existing node in place. Creating a fresh node would
    // overwrite the map entry (discarding the existing node's children) and blindly
    // append the id to the new parent's childIds — leaving a duplicate entry when
    // the parent is unchanged or a dangling reference in the old parent when it
    // moved, corrupting traversal, ordering, selection, and hit-testing.
    // The guard is scoped to restore mode so that a future change to pickRuntimeId
    // can never silently trigger in-place restoration in default mode.
    if (mode === 'restore') {
      const occupied = this.nodes.get(runtimeId)
      if (occupied !== undefined) {
        return restoreNodeInPlace(this, occupied, type, parentId, overrides, stableId, runtimeId)
      }
    }

    const source = this.identity.buildSource(overrides, stableId)

    const safeOverrides = omit(overrides, ['childIds'])
    const node = createDefaultNode(() => runtimeId, type, {
      ...safeOverrides,
      id: runtimeId,
      source
    })
    node.childIds = []
    node.parentId = parentId
    this.nodes.set(node.id, node)
    this.identity.registerStableId(node.id, stableId)

    const parent = this.nodes.get(parentId)
    if (parent) parent.childIds.push(node.id)

    Instances.registerInstanceIndex(this, node)
    this.emitter.emit('node:created', node)
    return node
  }

  static TEXT_PICTURE_KEYS: ReadonlySet<string> = TEXT_PICTURE_KEYS

  static LAYOUT_AFFECTING_KEYS: ReadonlySet<string> = LAYOUT_AFFECTING_KEYS

  runPreviewUpdates(fn: () => void): void {
    this.previewMutationDepth++
    try {
      fn()
    } finally {
      this.previewMutationDepth--
    }
  }
  preserveSourceMetadataDuring(fn: () => void): void {
    this.sourceMetadataPreservationDepth++
    try {
      fn()
    } finally {
      this.sourceMetadataPreservationDepth--
    }
  }
  updateNodePositionPreview(id: string, x: number, y: number): void {
    this.updateNodePreview(id, { x, y })
  }
  updateNodePreview(id: string, changes: Partial<SceneNode>): void {
    updateNodePreview(this, id, changes)
  }
  updateNode(id: string, changes: Partial<SceneNode>): void {
    if (this.previewMutationDepth > 0) {
      this.updateNodePreview(id, changes)
      return
    }

    const node = this.nodes.get(id)
    if (!node) return

    // Shallow-merge (no structuredClone): the hot import/override paths pass
    // already-copied arrays (copyFills/copyStyleRuns), so a per-call deep clone
    // was pure overhead — it made large-file import (1M+ nodes) exceed the test
    // timeout. guardSourceChanges below still produces a fresh `source` object,
    // and the filter/reassign steps create fresh containers, so the caller's
    // `changes` is never mutated. This matches the pre-identity behavior.
    let guardedChanges: Partial<SceneNode> = guardSourceChanges(node, omit(changes, ['id']))

    // Only clear absPosCache when layout-affecting properties change.
    // Fills, strokes, effects, plugin data changes do NOT affect absolute position.
    const affectsLayout = Object.keys(guardedChanges).some((k) =>
      SceneGraph.LAYOUT_AFFECTING_KEYS.has(k)
    )
    if (affectsLayout) this.absPosCache.clear()

    applyComponentIdChange({ instanceIndex: this.instanceIndex }, node, id, guardedChanges)
    clearTextCaches(node, guardedChanges)
    const entries = Object.entries(guardedChanges) as Array<[string, unknown]>
    guardedChanges = Object.fromEntries(
      entries.filter(([, value]) => value !== undefined)
    ) as Partial<SceneNode>
    if (this.sourceMetadataPreservationDepth === 0) {
      clearEditedSourceMetadata(node, Object.keys(guardedChanges))
    }
    if (guardedChanges.vectorNetwork) {
      guardedChanges = {
        ...guardedChanges,
        vectorNetwork: normalizeVectorNetwork(guardedChanges.vectorNetwork)
      }
    }
    Object.assign(node, guardedChanges)
    if (guardedChanges.fills) removeStaleBindings(node, 'fills', guardedChanges)
    if (guardedChanges.strokes) removeStaleBindings(node, 'strokes', guardedChanges)
    this.emitter.emit('node:updated', id, guardedChanges)
  }

  reparentNode(nodeId: string, newParentId: string): void {
    reparentNodeImpl(this, nodeId, newParentId)
  }

  reorderChild(nodeId: string, parentId: string, insertIndex: number): void {
    reorderChildImpl(this, nodeId, parentId, insertIndex)
  }

  insertChildAt(childId: string, parentId: string, index: number): void {
    const oldParent = this.getNode(this.getNode(childId)?.parentId ?? '')
    if (oldParent) {
      oldParent.childIds = oldParent.childIds.filter((id) => id !== childId)
    }
    const newParent = this.getNode(parentId)
    if (!newParent) return
    newParent.childIds = newParent.childIds.filter((id) => id !== childId)
    newParent.childIds.splice(index, 0, childId)
    const node = this.getNode(childId)
    if (node) node.parentId = parentId
    this.clearAbsPosCache()
    this.emitter.emit('node:reordered', childId, parentId, index)
  }

  deleteNode(id: string, options?: { permanent?: boolean }): void {
    deleteNodeImpl(this, id, options)
  }

  hitTest(px: number, py: number, scopeId?: string): SceneNode | null {
    return HitTest.hitTest(this, px, py, scopeId)
  }

  hitTestDeep(px: number, py: number, scopeId?: string): SceneNode | null {
    return HitTest.hitTestDeep(this, px, py, scopeId)
  }

  hitTestFrame(
    px: number,
    py: number,
    excludeIds: Set<string>,
    scopeId?: string
  ): SceneNode | null {
    return HitTest.hitTestFrame(this, px, py, excludeIds, scopeId)
  }

  cloneTree(
    sourceId: string,
    parentId: string,
    overrides: Partial<SceneNode> = {}
  ): SceneNode | null {
    return cloneTreeImpl(this, sourceId, parentId, overrides)
  }

  createInstance(
    componentId: string,
    parentId: string,
    overrides: Partial<SceneNode> = {}
  ): SceneNode | null {
    return Instances.createInstance(this, componentId, parentId, overrides)
  }

  populateInstanceChildren(instanceId: string, componentId: string): void {
    Instances.populateInstanceChildren(this, instanceId, componentId)
  }

  swapInstanceComponent(instanceId: string, componentId: string): void {
    Instances.swapInstanceComponent(this, instanceId, componentId)
  }

  syncInstances(componentId: string): void {
    Instances.syncInstances(this, componentId)
  }

  detachInstance(instanceId: string): void {
    Instances.detachInstance(this, instanceId)
  }

  getMainComponent(instanceId: string): SceneNode | undefined {
    return Instances.getMainComponent(this, instanceId)
  }

  getInstances(componentId: string): SceneNode[] {
    return Instances.getInstances(this, componentId)
  }

  flattenTree(parentId?: string, depth = 0): Array<{ node: SceneNode; depth: number }> {
    return flattenNodeTree(this, parentId, depth)
  }

  getSyncState(): GraphSyncState {
    if (this.syncState === null) {
      this.syncState = createGraphSyncState()
    }
    return this.syncState
  }

  resetSyncState(): void {
    if (this.syncState === null) {
      this.syncState = createGraphSyncState()
      return
    }
    resetGraphSyncState(this.syncState)
  }
}
