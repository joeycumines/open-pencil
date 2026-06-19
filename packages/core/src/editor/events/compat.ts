import type { GraphReplacedPayload } from '#core/editor/types'
import type { SceneGraph } from '#core/scene-graph'

export function graphReplacedPayloadGraph(payload: GraphReplacedPayload): SceneGraph {
  return payload.graph
}
