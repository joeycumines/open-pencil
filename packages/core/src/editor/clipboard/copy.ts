import type { SceneNode } from '@open-pencil/scene-graph'

import {
  buildFigmaClipboardHTML,
  buildFigmaClipboardHTMLSync,
  buildOpenPencilClipboardHTML
} from '#core/clipboard'
import type { EditorContext } from '#core/editor/types'

export function createClipboardCopyActions(ctx: EditorContext) {
  async function writeCopyData(clipboardData: DataTransfer, selectedNodes: SceneNode[]) {
    if (selectedNodes.length === 0) return

    const names = selectedNodes.map((n) => n.name).join('\n')
    const openPencilHTML = buildOpenPencilClipboardHTML(selectedNodes, ctx.graph)
    let clipboardHTML = openPencilHTML
    try {
      const syncFigmaHTML = buildFigmaClipboardHTMLSync(selectedNodes, ctx.graph)
      if (syncFigmaHTML) clipboardHTML = `${openPencilHTML}${syncFigmaHTML}`
    } catch {
      clipboardHTML = openPencilHTML
    }
    clipboardData.setData('text/html', clipboardHTML)
    clipboardData.setData('text/plain', names)

    const figmaHTML = await buildFigmaClipboardHTML(selectedNodes, ctx.graph).catch(() => null)
    if (figmaHTML) clipboardData.setData('text/html', `${openPencilHTML}${figmaHTML}`)
  }

  return { writeCopyData }
}
