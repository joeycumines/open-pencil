import { TEXT_GLYPH_KEYS, TEXT_PICTURE_KEYS } from '../text-picture'
import type { SceneNode } from '../types'

export interface NodeUpdateContext {
  instanceIndex: Map<string, Set<string>>
}

export function guardSourceChanges(
  node: SceneNode,
  changes: Partial<SceneNode>
): Partial<SceneNode> {
  if (changes.source === undefined) return changes

  let updatedSource = { ...node.source, ...changes.source }
  if (node.source.id !== null && updatedSource.id !== node.source.id) {
    updatedSource = { ...updatedSource, id: node.source.id }
  }
  if (node.source.format !== null) {
    updatedSource = { ...updatedSource, format: node.source.format }
  } else if (updatedSource.format !== null) {
    // Prevent transitioning source.format from null to non-null on
    // locally-created nodes — only import should set format to 'fig'.
    updatedSource = { ...updatedSource, format: node.source.format }
  }
  return { ...changes, source: updatedSource }
}

export function applyComponentIdChange(
  ctx: NodeUpdateContext,
  node: SceneNode,
  id: string,
  changes: Partial<SceneNode>
): void {
  if (
    node.type !== 'INSTANCE' ||
    !('componentId' in changes) ||
    changes.componentId === node.componentId
  ) {
    return
  }

  if (node.componentId) ctx.instanceIndex.get(node.componentId)?.delete(id)
  if (changes.componentId) {
    let set = ctx.instanceIndex.get(changes.componentId)
    if (!set) {
      set = new Set()
      ctx.instanceIndex.set(changes.componentId, set)
    }
    set.add(id)
  }
}

export function clearTextCaches(node: SceneNode, changes: Partial<SceneNode>): void {
  if (node.type !== 'TEXT') return
  const keys = Object.keys(changes)
  const pictureChanged = keys.some((k) => TEXT_PICTURE_KEYS.has(k))
  const glyphChanged = keys.some((k) => TEXT_GLYPH_KEYS.has(k))
  if (node.textPicture && pictureChanged) node.textPicture = null
  if (node.figmaDerivedTextGlyphs && glyphChanged) node.figmaDerivedTextGlyphs = null
}
