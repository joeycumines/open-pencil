import type { SceneGraph } from '#core/scene-graph'
import { cloneNodeProps } from '#core/scene-graph/copy'
import { createDefaultSource } from '#core/scene-graph/node/defaults'
import type { SceneNode, SourceMetadata } from '#core/scene-graph/types'

export function cloneTree(
  graph: SceneGraph,
  sourceId: string,
  parentId: string,
  overrides: Partial<SceneNode> = {}
): SceneNode | null {
  const src = graph.nodes.get(sourceId)
  if (!src) return null

  const props = cloneNodeProps(src, null)
  // Null out Figma source identifiers so the clone is treated as local.
  const baseSource: SourceMetadata = props.source ?? createDefaultSource()
  props.source = { ...baseSource, id: null, orderKey: null }
  const clone = graph.createNode(src.type, parentId, { ...props, ...overrides })

  for (const childId of src.childIds) {
    cloneTree(graph, childId, clone.id)
  }

  return clone
}
