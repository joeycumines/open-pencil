import type { Editor } from '@open-pencil/core/editor'
import { stickySublayers } from '@open-pencil/scene-graph'

import { parentSpace } from '#vue/shared/input/draw'
import { findDrawParent } from '#vue/shared/input/drop-target'
import type { DragPlace, DragState } from '#vue/shared/input/types'

/** Places a note centred on the canvas point, then types into its body, as FigJam does. */
function placeSticky(editor: Editor, cx: number, cy: number) {
  const parentId = findDrawParent(cx, cy, 'STICKY', editor)
  const sticky = editor.createStickyNote(parentId, parentSpace(editor, parentId)(cx, cy))
  editor.setTool('SELECT')
  const body = stickySublayers(editor.graph, sticky)?.body
  if (body) editor.startTextEditing(body.id)
}

/** The sticky tool places a note where the pointer is released, a click or the end of a drag. */
export function startStickyPlace(
  cx: number,
  cy: number,
  editor: Editor,
  setDrag: (d: DragState) => void
) {
  const drag: DragPlace = {
    type: 'place',
    x: cx,
    y: cy,
    commit: () => placeSticky(editor, drag.x, drag.y)
  }
  setDrag(drag)
}
