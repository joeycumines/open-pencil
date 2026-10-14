import type { Ref } from 'vue'

import { PEN_CLOSE_THRESHOLD } from '@open-pencil/core/constants'
import type { Editor } from '@open-pencil/core/editor'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { createPenDrag, handlePenDragMove } from '#vue/canvas/pen/drag'
import { PEN_CURSOR } from '#vue/editor/tool-cursor'
import type { DragState } from '#vue/shared/input/types'
import { handlePenNodeEditDown } from '#vue/shared/input/vector'

type SetDrag = (drag: DragState) => void

/** Whether a canvas point lies within the close threshold, in screen pixels, of the path's start. */
function nearFirstVertex(cx: number, cy: number, first: Vector, editor: Editor) {
  const zoom = editor.renderer?.zoom ?? 1
  return Math.hypot(cx - first.x, cy - first.y) < PEN_CLOSE_THRESHOLD / zoom
}

export function startPenInput(
  e: MouseEvent,
  cx: number,
  cy: number,
  editor: Editor,
  setDrag: SetDrag,
  cursorOverride: Ref<string | null>
): boolean {
  editor.state.penCursorX = null
  editor.state.penCursorY = null

  const nodeEditState = editor.state.nodeEditState
  if (nodeEditState) {
    handlePenNodeEditDown(e, cx, cy, editor)
    return true
  }

  const penState = editor.state.penState
  if (penState && penState.vertices.length > 2) {
    const first = penState.vertices[0]
    if (nearFirstVertex(cx, cy, first, editor)) {
      editor.penSetPendingClose(true)
      editor.penSetClosingToFirst(true)
      setDrag(createPenDrag(first.x, first.y))
      cursorOverride.value = PEN_CURSOR
      return true
    }
  }

  editor.penSetPendingClose(false)
  editor.penAddVertex(cx, cy)
  setDrag(createPenDrag(cx, cy))
  cursorOverride.value = PEN_CURSOR
  return true
}

export function updatePenHover(cx: number, cy: number, editor: Editor): boolean {
  if (editor.state.activeTool !== 'PEN' || !editor.state.penState) return false
  editor.state.penCursorX = cx
  editor.state.penCursorY = cy

  const first = editor.state.penState.vertices[0]
  if (editor.state.penState.vertices.length > 2) {
    editor.penSetClosingToFirst(nearFirstVertex(cx, cy, first, editor))
  }
  editor.requestRepaint()
  return true
}

export { handlePenDragMove }
