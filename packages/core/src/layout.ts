import {
  Align,
  Direction,
  Display,
  FlexDirection,
  Gutter,
  Edge,
  Overflow,
  Wrap,
  type Node as YogaNode
} from 'yoga-layout'

import { applyYogaLayout } from './layout/apply'
import { usesDetachedDerivedLayout } from './layout/derived'
import { applyEffectiveGeneratedTextLayout } from './layout/effective-generated-text'
import { buildGridTree, createGridChildNode } from './layout/grid'
import {
  type AxisSizing,
  configureChildAsLeaf,
  setCrossAxisSizing,
  setMainAxisSizing,
  sizesFitParent
} from './layout/leaf'
import { resolveNodeLayoutDirection } from './text/direction'
export {
  estimateTextSize,
  getTextMeasurer,
  setTextMeasurer,
  type TextMeasurer
} from './layout/text-measurement'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  applyMinMaxConstraints,
  configureAbsoluteChild,
  createYogaNode,
  freeYogaTree,
  mapAlign,
  mapAlignSelf,
  mapGridTrack,
  mapJustify
} from './layout/yoga-helpers'

export function computeLayout(graph: SceneGraph, frameId: string): void {
  const frame = graph.getNode(frameId)
  if (!frame || frame.layoutMode === 'NONE') return

  const rootDirection = resolveComputedLayoutDirection(graph, frame)
  const yogaDirection = rootDirection === 'RTL' ? Direction.RTL : Direction.LTR
  const yogaRoot =
    frame.layoutMode === 'GRID'
      ? buildGridTree(graph, frame, rootDirection)
      : buildYogaTree(graph, frame, rootDirection)
  yogaRoot.calculateLayout(undefined, undefined, yogaDirection)
  applyYogaLayout(graph, frame, yogaRoot, computeLayout)
  freeYogaTree(yogaRoot)
}
function resolveComputedLayoutDirection(
  graph: SceneGraph,
  node: Pick<SceneNode, 'layoutDirection' | 'parentId'>
): 'LTR' | 'RTL' {
  const parent = node.parentId ? graph.getNode(node.parentId) : null
  const inheritedDirection = parent ? resolveComputedLayoutDirection(graph, parent) : 'LTR'
  return resolveNodeLayoutDirection(node, inheritedDirection)
}

export function computeAllLayouts(
  graph: SceneGraph,
  scopeId?: string,
  options: { preserveImportedInstanceLayout?: boolean } = {}
): void {
  graph.withLayoutMutations(() => {
    computeAllLayoutsUnscoped(graph, scopeId, options)
  })
}

function computeAllLayoutsUnscoped(
  graph: SceneGraph,
  scopeId?: string,
  options: { preserveImportedInstanceLayout?: boolean } = {}
): void {
  const visited = new Set<string>()
  const rootId = scopeId ?? graph.rootId
  const preserveImportedInstanceLayout = options.preserveImportedInstanceLayout ?? true
  // Skip subtrees inside an imported .fig instance when preserving — their stored
  // positions are the ground truth.
  if (preserveImportedInstanceLayout && isInsideImportedFigInstance(graph, rootId)) return
  computeLayoutsBottomUp(graph, rootId, visited, { preserveImportedInstanceLayout })
  // Applying effective generated-text layout (Font produced by CanvasKit shaping,
  // e.g. from imported FIG text) may change box sizes, so re-run after it applies.
  if (applyEffectiveGeneratedTextLayout(graph, rootId)) {
    computeLayoutsBottomUp(graph, rootId, new Set(), { preserveImportedInstanceLayout })
  }
}

function computeLayoutsBottomUp(
  graph: SceneGraph,
  nodeId: string,
  visited: Set<string>,
  options: { preserveImportedInstanceLayout: boolean }
): void {
  const node = graph.getNode(nodeId)
  if (!node || visited.has(nodeId)) return
  visited.add(nodeId)

  // Imported .fig instances keep authoritative stored geometry; skip recomputing
  // unless the caller opted out (e.g. the instance itself was just edited).
  const preserveThisNode =
    options.preserveImportedInstanceLayout && preservesImportedInstanceLayout(node)
  if (preserveThisNode) return

  for (const childId of node.childIds) {
    computeLayoutsBottomUp(graph, childId, visited, options)
  }

  if (node.layoutMode !== 'NONE') {
    computeLayout(graph, nodeId)
  }
}

function preservesImportedInstanceLayout(node: SceneNode): boolean {
  return node.type === 'INSTANCE' && node.source.format === 'fig'
}

function isInsideImportedFigInstance(graph: SceneGraph, nodeId: string): boolean {
  let node = graph.getNode(nodeId) ?? null
  while (node) {
    if (preservesImportedInstanceLayout(node)) return true
    node = node.parentId ? (graph.getNode(node.parentId) ?? null) : null
  }
  return false
}

function buildYogaTree(
  graph: SceneGraph,
  frame: SceneNode,
  inheritedDirection: 'LTR' | 'RTL'
): YogaNode {
  const root = createYogaNode()
  const direction = resolveNodeLayoutDirection(frame, inheritedDirection)

  if (frame.primaryAxisSizing === 'FIXED') {
    if (frame.layoutMode === 'HORIZONTAL') root.setWidth(frame.width)
    else root.setHeight(frame.height)
  }
  if (frame.counterAxisSizing === 'FIXED') {
    if (frame.layoutMode === 'HORIZONTAL') root.setHeight(frame.height)
    else root.setWidth(frame.width)
  }

  configureFlexContainer(root, frame, direction)

  const children = graph.getChildren(frame.id)
  for (const child of children) {
    const yogaChild = createYogaNode()

    if (child.layoutPositioning === 'ABSOLUTE') {
      configureAbsoluteChild(yogaChild, child)
    } else if (!child.visible) {
      yogaChild.setDisplay(Display.None)
    } else if (child.layoutMode === 'GRID') {
      configureChildAsGrid(yogaChild, child, frame, graph, direction)
    } else if (child.layoutMode !== 'NONE') {
      configureChildAsAutoLayout(yogaChild, child, frame, graph, direction)
    } else {
      configureChildAsLeaf(yogaChild, child, frame, graph)
    }

    root.insertChild(yogaChild, root.getChildCount())
  }

  return root
}

function configureFlexContainer(
  yogaNode: YogaNode,
  node: SceneNode,
  direction: Exclude<SceneNode['layoutDirection'], 'AUTO'>
): void {
  yogaNode.setDirection(direction === 'RTL' ? Direction.RTL : Direction.LTR)
  yogaNode.setFlexDirection(
    node.layoutMode === 'HORIZONTAL' ? FlexDirection.Row : FlexDirection.Column
  )
  yogaNode.setFlexWrap(node.layoutWrap === 'WRAP' ? Wrap.Wrap : Wrap.NoWrap)
  yogaNode.setJustifyContent(mapJustify(node.primaryAxisAlign))
  yogaNode.setAlignItems(mapAlign(node.counterAxisAlign))
  if (node.clipsContent) yogaNode.setOverflow(Overflow.Hidden)

  if (node.layoutWrap === 'WRAP' && node.counterAxisAlignContent === 'SPACE_BETWEEN') {
    yogaNode.setAlignContent(Align.SpaceBetween)
  }

  yogaNode.setPadding(Edge.Top, node.paddingTop)
  yogaNode.setPadding(Edge.Right, node.paddingRight)
  yogaNode.setPadding(Edge.Bottom, node.paddingBottom)
  yogaNode.setPadding(Edge.Left, node.paddingLeft)

  const primaryGap = node.primaryAxisAlign === 'SPACE_BETWEEN' ? 0 : node.itemSpacing
  yogaNode.setGap(
    Gutter.Column,
    node.layoutMode === 'HORIZONTAL' ? primaryGap : node.counterAxisSpacing
  )
  yogaNode.setGap(
    Gutter.Row,
    node.layoutMode === 'HORIZONTAL' ? node.counterAxisSpacing : primaryGap
  )

  applyMinMaxConstraints(yogaNode, node)
}

function configureChildAsGrid(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: SceneGraph,
  inheritedDirection: 'LTR' | 'RTL'
): void {
  const direction = resolveNodeLayoutDirection(child, inheritedDirection)
  yogaChild.setDisplay(Display.Grid)
  yogaChild.setDirection(direction === 'RTL' ? Direction.RTL : Direction.LTR)

  if (child.gridTemplateColumns.length > 0) {
    yogaChild.setGridTemplateColumns(child.gridTemplateColumns.map(mapGridTrack))
  }
  if (child.gridTemplateRows.length > 0) {
    yogaChild.setGridTemplateRows(child.gridTemplateRows.map(mapGridTrack))
  }

  yogaChild.setGap(Gutter.Column, child.gridColumnGap)
  yogaChild.setGap(Gutter.Row, child.gridRowGap)

  yogaChild.setPadding(Edge.Top, child.paddingTop)
  yogaChild.setPadding(Edge.Right, child.paddingRight)
  yogaChild.setPadding(Edge.Bottom, child.paddingBottom)
  yogaChild.setPadding(Edge.Left, child.paddingLeft)

  const isParentRow = parent.layoutMode === 'HORIZONTAL'
  const selfOverride = child.layoutAlignSelf !== 'AUTO'
  const stretchCross = selfOverride
    ? child.layoutAlignSelf === 'STRETCH'
    : parent.counterAxisAlign === 'STRETCH'

  if (child.layoutGrow > 0) {
    yogaChild.setFlexGrow(child.layoutGrow)
    yogaChild.setFlexShrink(1)
    yogaChild.setFlexBasis(0)
    if (!stretchCross) {
      if (isParentRow) yogaChild.setHeight(child.height)
      else yogaChild.setWidth(child.width)
    }
  } else {
    if (isParentRow) {
      yogaChild.setWidth(child.width)
      if (!stretchCross) yogaChild.setHeight(child.height)
    } else {
      if (child.gridTemplateRows.length > 0) yogaChild.setHeight(child.height)
      if (!stretchCross) yogaChild.setWidth(child.width)
    }
  }

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  applyMinMaxConstraints(yogaChild, child)

  const grandchildren = graph.getChildren(child.id)
  for (const gc of grandchildren) {
    if (gc.layoutPositioning === 'ABSOLUTE') {
      const yogaGC = createYogaNode()
      configureAbsoluteChild(yogaGC, gc)
      yogaChild.insertChild(yogaGC, yogaChild.getChildCount())
    } else {
      yogaChild.insertChild(createGridChildNode(gc), yogaChild.getChildCount())
    }
  }
}

function derivedMainAxisFitsParent(
  graph: SceneGraph,
  parent: SceneNode,
  child: SceneNode,
  axis: 'width' | 'height'
): boolean {
  const children = graph
    .getChildren(parent.id)
    .filter((candidate) => candidate.visible && candidate.layoutPositioning !== 'ABSOLUTE')
  if (children.length === 0) return false

  const sizes = children.map((candidate) => candidate.figmaDerivedLayout?.[axis])
  return (
    sizesFitParent(parent, children.length, sizes, axis) &&
    child.figmaDerivedLayout?.[axis] !== undefined
  )
}

function usesAuthoritativeGeneratedStretch(parent: SceneNode, child: SceneNode): boolean {
  if (
    child.layoutAlignSelf !== 'STRETCH' ||
    parent.source.format === 'fig' ||
    !parent.figmaDerivedLayout
  ) {
    return false
  }
  const derivedCrossSize =
    parent.layoutMode === 'HORIZONTAL'
      ? parent.figmaDerivedLayout.height
      : parent.figmaDerivedLayout.width
  const parentCrossSize = parent.layoutMode === 'HORIZONTAL' ? parent.height : parent.width
  return derivedCrossSize !== undefined && Math.abs(derivedCrossSize - parentCrossSize) < 0.001
}

function configureAutoLayoutChildSizing(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: SceneGraph,
  widthSizing: AxisSizing,
  heightSizing: AxisSizing
): void {
  const isParentRow = parent.layoutMode === 'HORIZONTAL'
  const fixedDerivedMainAxis = isParentRow
    ? derivedMainAxisFitsParent(graph, parent, child, 'width')
    : derivedMainAxisFitsParent(graph, parent, child, 'height')
  const stretchesAuthoritativeCrossAxis = usesAuthoritativeGeneratedStretch(parent, child)

  if (isParentRow) {
    if (fixedDerivedMainAxis) yogaChild.setWidth(child.figmaDerivedLayout?.width ?? child.width)
    else setMainAxisSizing(yogaChild, 'width', widthSizing, child.width, child.layoutGrow)
    if (!stretchesAuthoritativeCrossAxis) {
      setCrossAxisSizing(yogaChild, 'height', heightSizing, child.height)
    }
    return
  }

  if (!stretchesAuthoritativeCrossAxis) {
    setCrossAxisSizing(yogaChild, 'width', widthSizing, child.width)
  }
  if (fixedDerivedMainAxis) yogaChild.setHeight(child.figmaDerivedLayout?.height ?? child.height)
  else setMainAxisSizing(yogaChild, 'height', heightSizing, child.height, child.layoutGrow)
}

function configureChildAsAutoLayout(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: SceneGraph,
  inheritedDirection: 'LTR' | 'RTL'
): void {
  const direction = resolveNodeLayoutDirection(child, inheritedDirection)
  const isChildRow = child.layoutMode === 'HORIZONTAL'
  const widthSizing = isChildRow ? child.primaryAxisSizing : child.counterAxisSizing
  const heightSizing = isChildRow ? child.counterAxisSizing : child.primaryAxisSizing

  configureAutoLayoutChildSizing(yogaChild, child, parent, graph, widthSizing, heightSizing)

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  if (usesDetachedDerivedLayout(child)) {
    const derived = child.figmaDerivedLayout
    if (widthSizing === 'HUG') yogaChild.setWidth(derived?.width ?? child.width)
    if (heightSizing === 'HUG') yogaChild.setHeight(derived?.height ?? child.height)
    applyMinMaxConstraints(yogaChild, child)
    return
  }

  configureFlexContainer(yogaChild, child, direction)

  const grandchildren = graph.getChildren(child.id)
  for (const gc of grandchildren) {
    const yogaGC = createYogaNode()
    if (gc.layoutPositioning === 'ABSOLUTE') {
      configureAbsoluteChild(yogaGC, gc)
    } else if (!gc.visible) {
      yogaGC.setDisplay(Display.None)
    } else if (gc.layoutMode === 'GRID') {
      configureChildAsGrid(yogaGC, gc, child, graph, direction)
    } else if (gc.layoutMode !== 'NONE') {
      configureChildAsAutoLayout(yogaGC, gc, child, graph, direction)
    } else {
      configureChildAsLeaf(yogaGC, gc, child, graph)
    }
    yogaChild.insertChild(yogaGC, yogaChild.getChildCount())
  }
}
