import type { CanvasKit } from 'canvaskit-wasm'
import { createNanoEvents } from 'nanoevents'
import type { Emitter } from 'nanoevents'

import {
  SceneGraph,
  migrateOverrideKeys,
  setInstanceStructureChangeHandler
} from '@open-pencil/scene-graph'
import { UndoManager } from '@open-pencil/scene-graph/undo'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { prefetchFigmaSchema } from '#core/clipboard'
import { IS_BROWSER } from '#core/constants'
import { clearInstanceOverrideCaches } from '#core/kiwi/fig/instance-overrides/cache'
import { setTextMeasurer } from '#core/layout'
import { TextEditor } from '#core/text/editor'
import { fontManager } from '#core/text/fonts'

import { createAlignmentActions } from './alignment'
import { createClipboardBridge } from './bridges/clipboard'
import { createComponentBridge } from './bridges/components'
import { createStructureBridge } from './bridges/structure'
import { createUndoBridge } from './bridges/undo'
import { createClipboardActions } from './clipboard'
import { createColorSpaceActions } from './color-space'
import { createComponentSyncScheduler } from './component-sync'
import { createComponentActions } from './components'
import { createGraphEventSubscription } from './events/graph'
import { createGraphReadActions } from './graph-reads'
import { createLayoutRunner } from './layout-runner'
import { createNodeActions } from './nodes'
import { createPageActions } from './pages'
import { createSelectionActions } from './selection'
import { createShapeActions } from './shapes'
import { createDefaultEditorState } from './state'
import { createStructureActions } from './structure'
import { createTextActions } from './text'
import type {
  EditorContext,
  EditorEventName,
  EditorEvents,
  EditorOptions,
  EditorState,
  GraphReplacedPayload
} from './types'
import { createUndoActions } from './undo'
import { createVariableActions } from './variables'
import { createViewportActions } from './viewport'

export { createDefaultEditorState } from './state'

export function createEditor(options?: EditorOptions) {
  let _graph = options?.graph ?? new SceneGraph()
  setInstanceStructureChangeHandler(() => clearInstanceOverrideCaches())
  const skipInitialGraphSetup = options?.skipInitialGraphSetup ?? false
  const undo = new UndoManager()
  const _loadFont = options?.loadFont ?? fontManager.loadFont.bind(fontManager)
  const _getViewportSize =
    options?.getViewportSize ??
    (() => {
      if (IS_BROWSER) return { width: window.innerWidth, height: window.innerHeight }
      return { width: 800, height: 600 }
    })
  let _ck: CanvasKit | null = null
  let _renderer: SkiaRenderer | null = null
  const _renderers = new Set<SkiaRenderer>()
  let _textEditor: TextEditor | null = null
  const events: Emitter<EditorEvents> = createNanoEvents()

  void prefetchFigmaSchema()

  const state: EditorState = options?.state ?? createDefaultEditorState(_graph.getPages()[0].id)

  function emitEditorEvent<K extends EditorEventName>(
    event: K,
    ...args: Parameters<EditorEvents[K]>
  ) {
    events.emit(event, ...args)
  }

  function onEditorEvent<K extends EditorEventName>(event: K, handler: EditorEvents[K]) {
    return events.on(event, handler)
  }

  function requestRender() {
    state.renderVersion++
    state.sceneVersion++
    emitEditorEvent('render:requested', {
      renderVersion: state.renderVersion,
      sceneVersion: state.sceneVersion
    })
  }

  function requestRepaint() {
    state.renderVersion++
    emitEditorEvent('repaint:requested', {
      renderVersion: state.renderVersion,
      sceneVersion: state.sceneVersion
    })
  }

  function setSelectedIds(ids: Set<string>) {
    const previous = [...state.selectedIds]
    state.selectedIds = ids
    const selected = [...ids]
    if (
      previous.length !== selected.length ||
      previous.some((id, index) => id !== selected[index])
    ) {
      emitEditorEvent('selection:changed', selected, previous)
    }
  }

  function setActiveTool(tool: EditorState['activeTool']) {
    const previous = state.activeTool
    state.activeTool = tool
    if (previous !== tool) emitEditorEvent('tool:changed', tool, previous)
  }

  const graphReads = createGraphReadActions(() => _graph)
  const { runLayoutForNode } = createLayoutRunner(() => _graph)
  const { scheduleComponentSync } = createComponentSyncScheduler(() => _graph, requestRender)

  const { subscribeToGraph } = createGraphEventSubscription({
    getGraph: () => _graph,
    getRenderers: () => _renderers,
    scheduleComponentSync,
    requestRender,
    emitEditorEvent
  })

  if (!skipInitialGraphSetup) {
    subscribeToGraph()
  }

  // Build the shared context
  const ctx: EditorContext = {
    get graph() {
      return _graph
    },
    set graph(g) {
      _graph = g
    },
    undo,
    state,
    loadFont: _loadFont,
    getViewportSize: _getViewportSize,
    getCk: () => _ck,
    getRenderer: () => _renderer,
    getTextEditor: () => _textEditor,
    requestRender,
    requestRepaint,
    emitEditorEvent,
    setSelectedIds,
    setActiveTool,
    runLayoutForNode,
    subscribeToGraph
  }

  // Assemble domain modules
  const viewport = createViewportActions(ctx)
  const selection = createSelectionActions(ctx)
  const pages = createPageActions(ctx)
  const shapes = createShapeActions(ctx)
  const structure = createStructureActions(ctx)
  const components = createComponentActions(ctx)
  const clipboard = createClipboardActions(ctx)
  const colorSpace = createColorSpaceActions(ctx)
  const undoActions = createUndoActions(ctx)
  const text = createTextActions(ctx)
  const nodes = createNodeActions(ctx)
  const variables = createVariableActions(ctx)
  const alignment = createAlignmentActions(ctx)
  const clipboardBridge = createClipboardBridge(clipboard, selection)
  const componentBridge = createComponentBridge(components, selection, structure, pages)
  const structureBridge = createStructureBridge(structure, selection)
  const undoBridge = createUndoBridge(undoActions, selection)

  function setCanvasKit(ck: CanvasKit, renderer: SkiaRenderer) {
    _ck = ck
    _renderer = renderer
    _renderers.add(renderer)
    _textEditor ??= new TextEditor(ck)
    setTextMeasurer(
      typeof renderer.measureTextNode === 'function'
        ? (node, maxWidth) => renderer.measureTextNode(node, maxWidth)
        : null
    )
  }

  function removeCanvasRenderer(renderer: SkiaRenderer) {
    _renderers.delete(renderer)
    if (_renderer === renderer) {
      _renderer = _renderers.values().next().value ?? null
    }
  }

  function buildReplaceGraphTranslation(
    oldGraph: SceneGraph,
    newGraph: SceneGraph
  ): Map<string, string> {
    const translation = new Map<string, string>()
    translation.set(oldGraph.rootId, newGraph.rootId)
    // Build a stable-id → runtime-id index from the old graph so each lookup
    // is O(1) instead of O(n) via stableIdToRuntimeId's linear scan.
    // Preserve first-match semantics to match stableIdToRuntimeId (which
    // returns the first node with a matching source.id). Duplicate stable
    // ids should never occur (the identity layer guarantees uniqueness), but
    // we keep the same behavior for defense-in-depth.
    const oldStableToRuntime = new Map<string, string>()
    for (const node of oldGraph.nodes.values()) {
      if (node.source.id !== null && !oldStableToRuntime.has(node.source.id)) {
        oldStableToRuntime.set(node.source.id, node.id)
      }
    }
    for (const node of newGraph.nodes.values()) {
      const sourceId = node.source.id
      if (sourceId === null) continue
      const oldRuntimeId = oldStableToRuntime.get(sourceId)
      if (oldRuntimeId !== undefined) {
        translation.set(oldRuntimeId, node.id)
      }
    }
    return translation
  }

  function replaceGraph(newGraph: SceneGraph) {
    newGraph.migrateLegacySourceIds()
    newGraph.recomputeReservedRuntimeIds()
    migrateOverrideKeys(newGraph)
    const oldGraph = _graph
    const translation = buildReplaceGraphTranslation(oldGraph, newGraph)
    _graph = newGraph
    subscribeToGraph()
    const previousPageId = state.currentPageId
    state.currentPageId = newGraph.getPages()[0]?.id ?? newGraph.rootId
    setSelectedIds(new Set())
    state.hoveredNodeId = null
    pages.clearPageViewports()
    undo.clear()
    const payload: GraphReplacedPayload = { graph: newGraph, translation }
    emitEditorEvent('graph:replaced', payload)
    if (previousPageId !== state.currentPageId) {
      emitEditorEvent('page:changed', state.currentPageId, previousPageId)
    }
    requestRender()
  }

  return {
    get graph() {
      return _graph
    },
    get renderer() {
      return _renderer
    },
    get canvasRenderers() {
      return [..._renderers]
    },
    get textEditor() {
      return _textEditor
    },
    undo,
    state,

    // Graph reads
    ...graphReads,

    // Lifecycle
    requestRender,
    requestRepaint,
    onEditorEvent,
    setCanvasKit,
    removeCanvasRenderer,
    replaceGraph,
    subscribeToGraph,

    // Selection
    ...selection,

    // Pages
    ...pages,

    // Shapes & tools
    ...shapes,

    // Structure (group, reorder, reparent, z-order)
    ...structure,

    // Nodes (update, layout)
    ...nodes,

    // Alignment (align, flip, rotate)
    ...alignment,

    // Variables
    ...variables,

    // Text editing
    ...text,

    // Viewport
    ...viewport,

    // Undo — bridge functions that need cross-module refs
    ...undoBridge,

    setDocumentColorSpace: colorSpace.setDocumentColorSpace,

    // Clipboard — bridge functions that need selectedNodes
    ...clipboardBridge,

    // Components — bridge functions
    ...componentBridge,

    // Structure — bridge functions that need selectedNodes
    ...structureBridge
  }
}

export type Editor = ReturnType<typeof createEditor>
