import { computed } from 'vue'

import { stickySublayers, stickyTextSize } from '@open-pencil/scene-graph'
import type { SceneNode, StickyTextSize } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { useEditor } from '#vue/editor/context'
import { useSelectionState } from '#vue/editor/selection-state/use'
import { useSceneComputed } from '#vue/internal/scene-computed/use'

/**
 * Headless state and actions for selected sticky notes: their colour, text size, and whether
 * they show their author. A selection of several notes reads its first note and edits them all.
 */
export function useStickyNote() {
  const editor = useEditor()
  const { selectedIds } = useSelectionState()

  const stickies = useSceneComputed(() => {
    const nodes = [...selectedIds.value].map((id) => editor.graph.getNode(id))
    return nodes.length > 0 && nodes.every((node) => node?.type === 'STICKY')
      ? nodes.filter((node): node is SceneNode => node !== undefined)
      : []
  })
  const active = computed(() => stickies.value.length > 0)
  const ids = computed(() => stickies.value.map((sticky) => sticky.id))
  const sublayers = useSceneComputed(() => {
    const first = stickies.value.at(0)
    return first ? stickySublayers(editor.graph, first) : null
  })

  const color = computed<Color | null>(() => stickies.value.at(0)?.fills.at(0)?.color ?? null)
  const textSize = computed<StickyTextSize | null>(() =>
    sublayers.value ? stickyTextSize(sublayers.value.body) : null
  )
  const authorVisible = computed(() => sublayers.value?.author.visible ?? false)

  function setColor(value: Color) {
    editor.setStickyColor(ids.value, value)
  }

  function setTextSize(value: StickyTextSize) {
    editor.setStickyTextSize(ids.value, value)
  }

  function setAuthorVisible(value: boolean) {
    editor.setStickyAuthorVisible(ids.value, value)
  }

  return { active, color, textSize, authorVisible, setColor, setTextSize, setAuthorVisible }
}
