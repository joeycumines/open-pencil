import { clearInstanceOverrideCaches } from '#core/kiwi/fig/instance-overrides/cache'

import type { SceneGraph, SceneNode } from './'
import { cloneNodeProps, copyEffects, copyFills, copyStrokes, copyStyleRuns } from './copy'

export function registerInstanceIndex(graph: SceneGraph, node: SceneNode): void {
  if (node.type !== 'INSTANCE' || !node.componentId) return
  let set = graph.instanceIndex.get(node.componentId)
  if (!set) {
    set = new Set()
    graph.instanceIndex.set(node.componentId, set)
  }
  set.add(node.id)
}

const INSTANCE_SYNC_PROPS: (keyof SceneNode)[] = [
  'width',
  'height',
  'fills',
  'strokes',
  'effects',
  'opacity',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'independentCorners',
  'layoutMode',
  'layoutDirection',
  'layoutWrap',
  'primaryAxisAlign',
  'counterAxisAlign',
  'primaryAxisSizing',
  'counterAxisSizing',
  'itemSpacing',
  'counterAxisSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumnGap',
  'gridRowGap',
  'gridPosition',
  'clipsContent',
  'independentStrokeWeights',
  'borderTopWeight',
  'borderRightWeight',
  'borderBottomWeight',
  'borderLeftWeight',
  'boundVariables'
]

function setSceneProp<K extends keyof SceneNode>(
  target: Partial<SceneNode>,
  key: K,
  value: SceneNode[K]
): void {
  target[key] = value
}

function copyProp(
  target: Partial<SceneNode> | SceneNode,
  source: SceneNode,
  key: keyof SceneNode
): void {
  if (key === 'fills') {
    setSceneProp(target, key, copyFills(source.fills))
  } else if (key === 'strokes') {
    setSceneProp(target, key, copyStrokes(source.strokes))
  } else if (key === 'effects') {
    setSceneProp(target, key, copyEffects(source.effects))
  } else if (key === 'styleRuns') {
    setSceneProp(target, key, copyStyleRuns(source.styleRuns))
  } else if (key === 'boundVariables') {
    // Shallow copy the binding map — values are variable IDs (strings), not objects
    setSceneProp(target, key, { ...source.boundVariables })
  } else if (key === 'gridPosition') {
    // Shallow copy the grid position object — all fields are primitives
    setSceneProp(target, key, source.gridPosition ? { ...source.gridPosition } : null)
  } else {
    const value = source[key]
    setSceneProp(target, key, Array.isArray(value) ? structuredClone(value) : value)
  }
}

function cloneChildrenWithMapping(
  graph: SceneGraph,
  sourceParentId: string,
  destParentId: string
): void {
  const sourceParent = graph.nodes.get(sourceParentId)
  if (!sourceParent) return

  for (const childId of sourceParent.childIds) {
    const src = graph.nodes.get(childId)
    if (!src) continue

    const clone = graph.createNode(src.type, destParentId, cloneNodeProps(src, childId))

    if (src.childIds.length > 0) {
      cloneChildrenWithMapping(graph, childId, clone.id)
    }
  }
}

function getMatchKey(graph: SceneGraph, childId: string): string {
  const child = graph.nodes.get(childId)
  return child ? graph.identity.getStableId(child) : childId
}

function syncOverrideProps(
  instChild: SceneNode,
  compChild: SceneNode,
  instChildStableId: string,
  overrides: Record<string, unknown>,
  props: readonly (keyof SceneNode)[]
): void {
  for (const key of props) {
    const overrideKey = `${instChildStableId}:${key}`
    if (overrideKey in overrides) continue
    copyProp(instChild, compChild, key)
  }
}

function syncChildren(
  graph: SceneGraph,
  compParentId: string,
  instParentId: string,
  overrides: Record<string, unknown>
): void {
  const compParent = graph.nodes.get(compParentId)
  const instParent = graph.nodes.get(instParentId)
  if (!compParent || !instParent) return

  // H-05: Match instance children to component children by stable ID
  // (not componentId which is a runtime ID that changes on graph rebuild)
  const instChildMap = new Map<string, SceneNode>()
  for (const childId of instParent.childIds) {
    const child = graph.nodes.get(childId)
    if (!child?.componentId) continue
    const compChild = graph.nodes.get(child.componentId)
    const matchKey = compChild ? graph.identity.getStableId(compChild) : child.componentId
    instChildMap.set(matchKey, child)
  }

  for (const compChildId of compParent.childIds) {
    const compChild = graph.nodes.get(compChildId)
    const matchKey = getMatchKey(graph, compChildId)
    if (!instChildMap.has(matchKey)) {
      const src = compChild
      if (!src) continue
      const clone = graph.createNode(src.type, instParentId, cloneNodeProps(src, compChildId))
      if (src.childIds.length > 0) {
        cloneChildrenWithMapping(graph, compChildId, clone.id)
      }
      instChildMap.set(matchKey, clone)
    }
  }

  const EXTRA_SYNC_PROPS = [
    'name',
    'text',
    'fontSize',
    'fontWeight',
    'fontFamily',
    'textDirection'
  ] as const

  for (const compChildId of compParent.childIds) {
    const compChild = graph.nodes.get(compChildId)
    const matchKey = getMatchKey(graph, compChildId)
    const instChild = instChildMap.get(matchKey)
    if (!compChild || !instChild) continue

    // C-01: Use stable ID for override keys so they survive runtime ID changes
    const instChildStableId = graph.identity.getStableId(instChild)
    syncOverrideProps(instChild, compChild, instChildStableId, overrides, INSTANCE_SYNC_PROPS)
    syncOverrideProps(instChild, compChild, instChildStableId, overrides, EXTRA_SYNC_PROPS)

    if (compChild.childIds.length > 0) {
      syncChildren(graph, compChildId, instChild.id, overrides)
    }
  }

  const compChildOrder = compParent.childIds
  instParent.childIds.sort((a, b) => {
    const nodeA = graph.nodes.get(a)
    const nodeB = graph.nodes.get(b)
    const idxA = nodeA?.componentId ? compChildOrder.indexOf(nodeA.componentId) : -1
    const idxB = nodeB?.componentId ? compChildOrder.indexOf(nodeB.componentId) : -1
    return idxA - idxB
  })
}

export function createInstance(
  graph: SceneGraph,
  componentId: string,
  parentId: string,
  overrides: Partial<SceneNode> = {}
): SceneNode | null {
  const component = graph.nodes.get(componentId)
  if (component?.type !== 'COMPONENT') return null

  const props: Partial<SceneNode> = { name: component.name, componentId }
  for (const key of INSTANCE_SYNC_PROPS) {
    copyProp(props, component, key)
  }

  const instance = graph.createNode('INSTANCE', parentId, { ...props, ...overrides })

  cloneChildrenWithMapping(graph, component.id, instance.id)

  return instance
}

export function populateInstanceChildren(
  graph: SceneGraph,
  instanceId: string,
  componentId: string
): void {
  const instance = graph.nodes.get(instanceId)
  const component = graph.nodes.get(componentId)
  if (!instance || !component || instance.type !== 'INSTANCE') return
  cloneChildrenWithMapping(graph, componentId, instanceId)
}

export function swapInstanceComponent(
  graph: SceneGraph,
  instanceId: string,
  componentId: string
): void {
  const instance = graph.nodes.get(instanceId)
  const component = graph.nodes.get(componentId)
  if (!instance || component?.type !== 'COMPONENT' || instance.type !== 'INSTANCE') return

  clearInstanceOverrideCaches()

  const previousComponent = instance.componentId ? graph.nodes.get(instance.componentId) : undefined
  const updates: Partial<SceneNode> = { componentId }
  for (const key of INSTANCE_SYNC_PROPS) {
    if (key in instance.overrides) continue
    copyProp(updates, component, key)
  }
  if (!previousComponent || instance.name === previousComponent.name) updates.name = component.name

  const childIds = Array.from(instance.childIds)
  for (const childId of childIds) graph.deleteNode(childId, { permanent: false })
  graph.updateNode(instanceId, updates)
  cloneChildrenWithMapping(graph, componentId, instanceId)

  clearInstanceOverrideCaches()
}

export function syncInstances(graph: SceneGraph, componentId: string): void {
  const component = graph.nodes.get(componentId)
  if (component?.type !== 'COMPONENT') return

  for (const instance of getInstances(graph, componentId)) {
    for (const key of INSTANCE_SYNC_PROPS) {
      if (key in instance.overrides) continue
      copyProp(instance, component, key)
    }

    syncChildren(graph, component.id, instance.id, instance.overrides)
  }
}

export function detachInstance(graph: SceneGraph, instanceId: string): void {
  const node = graph.nodes.get(instanceId)
  if (node?.type !== 'INSTANCE') return
  if (node.componentId) {
    graph.instanceIndex.get(node.componentId)?.delete(instanceId)
  }
  node.type = 'FRAME'
  node.componentId = null
  node.overrides = {}
}

export function getMainComponent(graph: SceneGraph, instanceId: string): SceneNode | undefined {
  const node = graph.nodes.get(instanceId)
  if (!node?.componentId) return undefined
  return graph.nodes.get(node.componentId)
}

export function getInstances(graph: SceneGraph, componentId: string): SceneNode[] {
  const ids = graph.instanceIndex.get(componentId)
  if (!ids) return []
  const instances: SceneNode[] = []
  for (const id of ids) {
    const node = graph.nodes.get(id)
    if (node) instances.push(node)
  }
  return instances
}
