import { getCurrentScope, onScopeDispose, shallowReactive } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/core/scene-graph'

import { getStoreFigmaAPI } from '@/app/automation/bridge/figma-factory'
import {
  getActiveEditorStore,
  setActiveEditorStore,
  useEditorStore
} from '@/app/editor/active-store'
import { loadFont } from '@/app/editor/fonts'
import {
  createEditorComputedRefs,
  createEditorStoreModules,
  defineEditorStoreAccessors
} from '@/app/editor/session/modules'
import { createInitialAppEditorState, type AppEditorState } from '@/app/editor/session/types'

export { EDITOR_TOOLS as TOOLS, TOOL_SHORTCUTS } from '@open-pencil/core/editor'
export type { EditorToolDef as ToolDef, Tool } from '@open-pencil/core/editor'

export function createEditorStore(initialGraph?: SceneGraph) {
  const graph = initialGraph ?? new SceneGraph()

  const state = shallowReactive<AppEditorState>(createInitialAppEditorState(graph.getPages()[0].id))

  const viewportSize = { width: 0, height: 0 }
  const editor = createEditor({
    graph,
    state,
    loadFont,
    skipInitialGraphSetup: !!initialGraph,
    getViewportSize: () =>
      viewportSize.width > 0 && viewportSize.height > 0
        ? viewportSize
        : { width: window.innerWidth, height: window.innerHeight }
  })
  const io = new IORegistry(BUILTIN_IO_FORMATS)

  if (initialGraph) {
    editor.subscribeToGraph()
  }

  const unbindGraphReplaced = editor.onEditorEvent('graph:replaced', ({ graph, translation }) => {
    getStoreFigmaAPI(store).setGraph(graph, translation)
  })

  const unbindNodeDeleted = editor.onEditorEvent('node:deleted', () => {
    getStoreFigmaAPI(store).clearNodeCache()
  })

  const { selectedNodes, selectedNode, layerTree } = createEditorComputedRefs(editor, state)

  const modules = createEditorStoreModules(editor, state, io, viewportSize)

  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    unbindGraphReplaced()
    unbindNodeDeleted()
    modules.dispose()
  }

  // ─── Public API ───────────────────────────────────────────────
  // Spread all core Editor methods, then override getters and add app-specific.

  const store = {
    ...editor,
    state,
    selectedNodes,
    selectedNode,
    layerTree,

    // App-specific overrides and additions
    ...modules,
    dispose
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose)
  }

  defineEditorStoreAccessors(store, editor)

  return store
}

export type EditorStore = ReturnType<typeof createEditorStore>

export { getActiveEditorStore, setActiveEditorStore, useEditorStore }
