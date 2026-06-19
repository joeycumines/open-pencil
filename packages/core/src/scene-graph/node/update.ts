import { TEXT_PICTURE_KEYS } from '#core/scene-graph/text-picture'
import type { SceneNode } from '#core/scene-graph/types'

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
  const textChanged = Object.keys(changes).some((k) => TEXT_PICTURE_KEYS.has(k))
  if (node.textPicture && textChanged) node.textPicture = null
  if (node.figmaDerivedTextGlyphs && 'text' in changes) node.figmaDerivedTextGlyphs = null
}
