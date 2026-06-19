import { omit } from 'es-toolkit/object'

import type { SceneNode } from '#core/scene-graph/types'

export function removeStaleBindings(
  node: SceneNode,
  field: 'fills' | 'strokes',
  changes: Partial<SceneNode>
): void {
  const len = node[field].length
  const stale = Object.keys(node.boundVariables).filter((k) => {
    if (k === field) return true
    if (!k.startsWith(`${field}/`)) return false
    const i = Number.parseInt(k.split('/')[1] ?? '', 10)
    return Number.isNaN(i) || i < 0 || i >= len
  })
  if (stale.length > 0) {
    node.boundVariables = omit(node.boundVariables, stale)
    changes.boundVariables = { ...node.boundVariables }
  }
}

export interface NodeTreeAccess {
  getNode(id: string): SceneNode | undefined
  getChildren(id: string): SceneNode[]
  rootId: string
}

export function countDescendants(access: NodeTreeAccess, nodeId: string): number {
  const node = access.getNode(nodeId)
  if (!node) return 0
  let count = 0
  const stack = [...node.childIds]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined) break
    count++
    const child = access.getNode(id)
    if (child) {
      for (const childId of child.childIds) {
        stack.push(childId)
      }
    }
  }
  return count
}

export function flattenTree(
  access: NodeTreeAccess,
  parentId?: string,
  depth = 0
): Array<{ node: SceneNode; depth: number }> {
  const id = parentId ?? access.rootId
  const parent = access.getNode(id)
  if (!parent) return []
  const result: Array<{ node: SceneNode; depth: number }> = []
  for (const childId of parent.childIds) {
    const child = access.getNode(childId)
    if (!child) continue
    result.push({ node: child, depth })
    if (child.childIds.length > 0) {
      result.push(...flattenTree(access, childId, depth + 1))
    }
  }
  return result
}
