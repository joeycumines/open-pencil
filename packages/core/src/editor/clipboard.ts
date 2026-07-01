import {
  importClipboardNodes,
  parseFigmaClipboard,
  parseOpenPencilClipboard
} from '#core/clipboard'
import { computeAllLayouts } from '#core/layout'
import { createDefaultSource, joinOverrideKey, splitOverrideKey } from '#core/scene-graph'
import type { SceneGraph, SceneNode, SourceMetadata } from '#core/scene-graph'
import type { Vector } from '#core/types'

import { createClipboardCopyActions } from './clipboard/copy'
import { createClipboardExportActions } from './clipboard/export'
import { createClipboardFontActions } from './clipboard/fonts'
import { deleteIds, recreateSnapshots, restoreDeletedEntries } from './clipboard/history'
import { createClipboardImageActions } from './clipboard/images'
import { replaceTargetsWithCreated, selectedReplacementTargets } from './clipboard/paste-replace'
import { resolvePasteTarget } from './clipboard/paste-target'
import { createClipboardPlacementActions } from './clipboard/placement'
import { collectSubtrees, restoreSubtree, snapshotSubtree } from './clipboard/subtree-history'
import { remapRestoredSnapshotReferences } from './history/restore-references'
import type { EditorContext } from './types'

type PasteOptions = {
  replaceSelection?: boolean
}

type ClipboardSnapshot = SceneNode & { children?: ClipboardSnapshot[] }

type PasteReferencePair = {
  source: ClipboardSnapshot
  pastedStableId: string
}

export function createClipboardActions(ctx: EditorContext) {
  function duplicateSelected(selectedNodes: SceneNode[]) {
    const prevSelection = new Set(ctx.state.selectedIds)
    const selectedSet = new Set(selectedNodes.map((n) => n.id))
    const topLevel = selectedNodes.filter((n) => !n.parentId || !selectedSet.has(n.parentId))

    const newRootIds: string[] = []
    const sourceToClone = new Map<string, string>()
    const allSnapshots = new Map<string, SceneNode>()

    for (const node of topLevel) {
      const parentId = node.parentId ?? ctx.state.currentPageId
      const clone = ctx.graph.cloneTree(node.id, parentId, {
        name: node.name + ' copy',
        x: node.x + 20,
        y: node.y + 20
      })
      if (!clone) continue
      newRootIds.push(clone.id)
      collectParallelCloneRuntimeMap(ctx.graph, node.id, clone.id, sourceToClone)
    }

    if (newRootIds.length > 0) {
      remapDuplicatedComponentIds(ctx.graph, newRootIds, sourceToClone)
      for (const rootId of newRootIds) {
        const subtree = snapshotSubtree(ctx.graph, rootId)
        for (const [id, snap] of subtree) allSnapshots.set(id, snap)
      }
      let currentRootIds = [...newRootIds]
      ctx.setSelectedIds(new Set(newRootIds))
      ctx.undo.push({
        label: 'Duplicate',
        forward: () => {
          const restoredRootIds: string[] = []
          const oldToNew = new Map<string, string>()
          for (const rootId of newRootIds) {
            const snapshot = allSnapshots.get(rootId)
            if (!snapshot) continue
            const parentId = snapshot.parentId ?? ctx.state.currentPageId
            const restored = restoreSubtree(ctx.graph, snapshot, parentId, allSnapshots, oldToNew)
            restoredRootIds.push(restored.rootId)
          }
          remapRestoredSnapshotReferences(ctx.graph, allSnapshots.values(), oldToNew)
          currentRootIds = restoredRootIds
          ctx.setSelectedIds(new Set(currentRootIds))
        },
        inverse: () => {
          for (const id of currentRootIds.slice().reverse()) {
            ctx.graph.deleteNode(id, { permanent: true })
          }
          currentRootIds = []
          ctx.setSelectedIds(prevSelection)
        }
      })
    }
  }

  function pushPasteUndo(created: string[], prevSelection: Set<string>) {
    const allNodes = collectSubtrees(ctx.graph, created)
    const pageId = ctx.state.currentPageId
    let currentCreated = [...created]
    ctx.undo.push({
      label: 'Paste',
      forward: () => {
        const restoredIds = recreateSnapshots(ctx, allNodes, pageId)
        currentCreated = created.map((id) => restoredIds.get(id) ?? id)
        computeAllLayouts(ctx.graph, pageId)
        ctx.setSelectedIds(new Set(currentCreated))
      },
      inverse: () => {
        deleteIds(ctx, currentCreated)
        currentCreated = []
        computeAllLayouts(ctx.graph, pageId)
        ctx.setSelectedIds(prevSelection)
      }
    })
  }

  async function pasteFromHTML(html: string, cursorPos?: Vector, options: PasteOptions = {}) {
    const openPencil = parseOpenPencilClipboard(html)
    if (openPencil) {
      pasteOpenPencilNodes(openPencil.nodes, openPencil.images, cursorPos, options)
      return
    }

    const figma = await parseFigmaClipboard(html)
    if (figma) {
      const prevSelection = new Set(ctx.state.selectedIds)
      const replacementTargets = options.replaceSelection ? selectedReplacementTargets(ctx) : []
      const pasteTarget = replacementTargets[0]?.parentId ?? resolvePasteTarget(ctx)
      const created = importClipboardNodes(figma.nodes, ctx.graph, pasteTarget, 0, 0, figma.blobs)
      if (created.length > 0) {
        if (replacementTargets.length > 0) {
          replaceTargetsWithCreated(
            ctx,
            placementActions.centerNodesAt,
            created,
            replacementTargets,
            prevSelection
          )
          void fontActions.loadFontsForNodes(created)
          warnMissingImages(created)
          ctx.requestRender()
          return
        }
        const { width: viewW, height: viewH } = ctx.getViewportSize()
        const cx = cursorPos?.x ?? (-ctx.state.panX + viewW / 2) / ctx.state.zoom
        const cy = cursorPos?.y ?? (-ctx.state.panY + viewH / 2) / ctx.state.zoom
        placementActions.centerNodesAt(created, cx, cy)
        computeAllLayouts(ctx.graph, ctx.state.currentPageId)
        ctx.setSelectedIds(new Set(created))

        pushPasteUndo(created, prevSelection)
        void fontActions.loadFontsForNodes(created)
        warnMissingImages(created)
        ctx.requestRender()
      }
    }
  }

  function pasteOpenPencilNodes(
    nodes: Array<SceneNode & { children?: SceneNode[] }>,
    images: Map<string, Uint8Array>,
    cursorPos?: Vector,
    options: PasteOptions = {}
  ) {
    const prevSelection = new Set(ctx.state.selectedIds)
    const replacementTargets = options.replaceSelection ? selectedReplacementTargets(ctx) : []
    for (const [hash, bytes] of images) ctx.graph.images.set(hash, bytes)

    const oldRuntimeToNew = new Map<string, string>()
    const oldStableToNew = new Map<string, string>()
    const sourceSnapshotByCreatedId = new Map<string, ClipboardSnapshot>()
    const createdRoots: string[] = []
    const createdIds = new Set<string>()

    const createWithFreshIds = (snapshot: ClipboardSnapshot, parentId: string): SceneNode => {
      const originalRuntimeId = snapshot.id
      const originalStableId = snapshot.source.id ?? null

      const sourceFromSnapshot: Partial<SourceMetadata> = {
        ...structuredClone(snapshot.source),
        id: null
      }

      const overrides: Partial<SceneNode> = {
        ...structuredClone(snapshot),
        id: undefined,
        childIds: [],
        source: { ...createDefaultSource(), ...sourceFromSnapshot }
      }

      const node = ctx.graph.createNode(snapshot.type, parentId, overrides, { mode: 'restore' })
      oldRuntimeToNew.set(originalRuntimeId, node.id)
      sourceSnapshotByCreatedId.set(node.id, snapshot)
      createdIds.add(node.id)
      if (originalStableId !== null) {
        oldStableToNew.set(originalStableId, node.id)
      }

      for (const child of snapshot.children ?? []) {
        createWithFreshIds(child, node.id)
      }

      return node
    }

    const mapRef = (oldId: string | null | undefined): string | undefined => {
      if (oldId === null || oldId === undefined) return undefined
      return oldRuntimeToNew.get(oldId) ?? oldStableToNew.get(oldId)
    }

    const pasteTarget = replacementTargets[0]?.parentId ?? resolvePasteTarget(ctx)
    for (const root of nodes) {
      createdRoots.push(createWithFreshIds(root, pasteTarget).id)
    }
    if (createdRoots.length === 0) return

    for (const id of createdIds) {
      const node = ctx.graph.getNode(id)
      if (!node) continue

      const changes: Partial<SceneNode> = {}

      if (node.componentId) {
        const newComponentId = mapRef(node.componentId)
        if (newComponentId) {
          changes.componentId = newComponentId
        } else if (!ctx.graph.getNode(node.componentId)) {
          // The component is not in the pasted subtree AND does not exist
          // in the destination graph (cross-document paste). Detach the
          // instance. If the component already exists in the destination
          // graph (same-document paste), keep the valid reference.
          changes.componentId = null
        }
      }

      if (node.type === 'INSTANCE') {
        const sourceSnapshot = sourceSnapshotByCreatedId.get(node.id)
        changes.overrides = sourceSnapshot
          ? remapPastedOverrideRecord(ctx.graph, sourceSnapshot, oldRuntimeToNew, node.overrides)
          : structuredClone(node.overrides)
      }

      if (Object.keys(changes).length > 0) {
        ctx.graph.updateNode(id, changes)
      }
    }

    if (replacementTargets.length > 0) {
      replaceTargetsWithCreated(
        ctx,
        placementActions.centerNodesAt,
        createdRoots,
        replacementTargets,
        prevSelection
      )
      return
    }

    if (cursorPos) placementActions.centerNodesAt(createdRoots, cursorPos.x, cursorPos.y)
    computeAllLayouts(ctx.graph, ctx.state.currentPageId)
    ctx.setSelectedIds(new Set(createdRoots))

    pushPasteUndo(createdRoots, prevSelection)
  }

  function warnMissingImages(nodeIds: string[]) {
    const allNodes = collectSubtrees(ctx.graph, nodeIds)
    return allNodes.some((n) =>
      n.fills.some((f) => f.type === 'IMAGE' && f.imageHash && !ctx.graph.images.has(f.imageHash))
    )
  }

  function deleteSelected() {
    const entries: Array<{
      id: string
      parentId: string
      index: number
      subtree: Map<string, SceneNode>
    }> = []
    for (const id of ctx.state.selectedIds) {
      const node = ctx.graph.getNode(id)
      if (!node || node.locked) continue
      const parentId = node.parentId ?? ctx.state.currentPageId
      const parent = ctx.graph.getNode(parentId)
      const index = parent?.childIds.indexOf(id) ?? -1
      entries.push({ id, parentId, index, subtree: snapshotSubtree(ctx.graph, id) })
    }
    if (entries.length === 0) return

    const prevSelection = new Set(ctx.state.selectedIds)
    for (const { id } of entries) ctx.graph.deleteNode(id, { permanent: true })
    let restoredIds = new Map<string, string>()

    ctx.undo.push({
      label: 'Delete',
      forward: () => {
        for (const { id } of entries) {
          ctx.graph.deleteNode(restoredIds.get(id) ?? id, { permanent: true })
        }
        restoredIds = new Map()
        ctx.setSelectedIds(new Set())
      },
      inverse: () => {
        restoredIds = restoreDeletedEntries(ctx, entries)
        ctx.setSelectedIds(mapSelection(prevSelection, restoredIds))
      }
    })
    ctx.setSelectedIds(new Set())
  }

  const copyActions = createClipboardCopyActions(ctx)
  const exportActions = createClipboardExportActions(ctx)
  const fontActions = createClipboardFontActions(ctx)
  const imageActions = createClipboardImageActions(ctx)
  const placementActions = createClipboardPlacementActions(ctx)

  return {
    collectSubtrees,
    ...placementActions,
    ...fontActions,
    duplicateSelected,
    ...copyActions,
    pasteFromHTML,
    warnMissingImages,
    deleteSelected,
    ...imageActions,
    ...exportActions
  }
}

function mapSelection(selection: Set<string>, oldToNew: Map<string, string>) {
  return new Set([...selection].map((id) => oldToNew.get(id) ?? id))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pushPasteReferencePair(
  index: Map<string, PasteReferencePair[]>,
  key: string,
  pair: PasteReferencePair
): void {
  const existing = index.get(key)
  if (existing) {
    existing.push(pair)
  } else {
    index.set(key, [pair])
  }
}

function descendantPasteReferencePairs(
  graph: SceneGraph,
  sourceContext: ClipboardSnapshot,
  oldRuntimeToNew: ReadonlyMap<string, string>
): Map<string, PasteReferencePair[]> {
  const index = new Map<string, PasteReferencePair[]>()
  const visit = (snapshot: ClipboardSnapshot): void => {
    for (const child of snapshot.children ?? []) {
      const pastedId = oldRuntimeToNew.get(child.id)
      const pasted = pastedId ? graph.getNode(pastedId) : undefined
      if (pasted) {
        const pair = {
          source: child,
          pastedStableId: graph.identity.getStableId(pasted)
        }
        pushPasteReferencePair(index, child.id, pair)
        if (child.source.id) pushPasteReferencePair(index, child.source.id, pair)
      }
      visit(child)
    }
  }
  visit(sourceContext)
  return index
}

function remapPastedBindingRecord(bindings: Record<string, unknown>): Record<string, unknown> {
  const remapped: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(bindings)) {
    remapped[field] = structuredClone(value)
  }
  return remapped
}

function remapPastedOverrideValue(
  graph: SceneGraph,
  sourceContext: ClipboardSnapshot,
  oldRuntimeToNew: ReadonlyMap<string, string>,
  prop: string,
  value: unknown
): unknown {
  if (prop === 'overrides' && isRecord(value)) {
    return remapPastedOverrideRecord(graph, sourceContext, oldRuntimeToNew, value)
  }
  if (prop === 'boundVariables' && isRecord(value)) {
    return remapPastedBindingRecord(value)
  }
  return structuredClone(value)
}

function remapPastedOverrideRecord(
  graph: SceneGraph,
  sourceContext: ClipboardSnapshot,
  oldRuntimeToNew: ReadonlyMap<string, string>,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const pairsByOriginalKey = descendantPasteReferencePairs(graph, sourceContext, oldRuntimeToNew)
  const remapped: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(overrides)) {
    const { childId, prop } = splitOverrideKey(key)
    if (childId === '') {
      remapped[key] = remapPastedOverrideValue(graph, sourceContext, oldRuntimeToNew, prop, value)
      continue
    }

    const pairs = pairsByOriginalKey.get(childId)
    if (!pairs) {
      remapped[key] = remapPastedOverrideValue(graph, sourceContext, oldRuntimeToNew, prop, value)
      continue
    }

    for (const pair of pairs) {
      remapped[joinOverrideKey(pair.pastedStableId, prop)] = remapPastedOverrideValue(
        graph,
        pair.source,
        oldRuntimeToNew,
        prop,
        value
      )
    }
  }

  return remapped
}

function collectParallelCloneRuntimeMap(
  graph: SceneGraph,
  sourceId: string,
  cloneId: string,
  sourceToClone: Map<string, string>
): void {
  const source = graph.getNode(sourceId)
  const clone = graph.getNode(cloneId)
  if (!source || !clone) return
  sourceToClone.set(source.id, clone.id)

  const childCount = Math.min(source.childIds.length, clone.childIds.length)
  for (let index = 0; index < childCount; index++) {
    const sourceChildId = source.childIds[index]
    const cloneChildId = clone.childIds[index]
    if (sourceChildId && cloneChildId) {
      collectParallelCloneRuntimeMap(graph, sourceChildId, cloneChildId, sourceToClone)
    }
  }
}

function remapDuplicatedComponentIds(
  graph: SceneGraph,
  duplicatedRootIds: readonly string[],
  sourceToClone: ReadonlyMap<string, string>
): void {
  for (const rootId of duplicatedRootIds) {
    for (const node of snapshotSubtree(graph, rootId).values()) {
      if (!node.componentId) continue
      const clonedComponentId = sourceToClone.get(node.componentId)
      if (clonedComponentId && clonedComponentId !== node.componentId) {
        graph.updateNode(node.id, { componentId: clonedComponentId })
      }
    }
  }
}
