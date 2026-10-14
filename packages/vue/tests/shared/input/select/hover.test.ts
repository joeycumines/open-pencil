import { afterEach, expect, test } from 'bun:test'

import { createEditor, type Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  cornerRotationCursor,
  getHitHandleByMatrix,
  buildResizeCursor
} from '#vue/shared/input/geometry'
import { updateHoverCursor } from '#vue/shared/input/select/hover'

let editor: Editor

afterEach(() => editor.dispose())

/** A selected 240×160 frame at the origin, viewed at 100%, with its label under every point. */
function selectedFrame(labelled: boolean) {
  editor = createEditor()
  const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    width: 240,
    height: 160
  })
  editor.select([frame.id])
  const fns = {
    hitTestInScope: () => null,
    hitTestFrameTitle: (): SceneNode | null => (labelled ? frame : null),
    hitTestSectionTitle: () => null,
    hitTestComponentLabel: () => null
  }
  return { frame, cursorAt: (x: number, y: number) => updateHoverCursor(x, y, editor, fns) }
}

test('outside a corner rotates, unless a label is there, as in Figma', () => {
  const plain = selectedFrame(false)
  expect(plain.cursorAt(-9, -6)).toBe(cornerRotationCursor('nw', plain.frame, editor.graph))
  editor.dispose()
  const labelled = selectedFrame(true)
  expect(labelled.cursorAt(-9, -6)).toBeNull()
})

test('a label does not take the press from a resize band', () => {
  const { frame, cursorAt } = selectedFrame(true)
  const hit = getHitHandleByMatrix(-3, -3, frame, editor.graph)
  expect(hit?.handle).toBe('nw')
  expect(cursorAt(-3, -3)).toBe(buildResizeCursor(hit?.rotation ?? 0))
  expect(getHitHandleByMatrix(120, -5, frame, editor.graph)?.handle).toBe('n')
})
