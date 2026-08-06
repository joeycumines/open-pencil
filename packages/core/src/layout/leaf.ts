import { Align, MeasureMode, type Node as YogaNode } from 'yoga-layout'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { estimateTextSize, getTextMeasurer } from './text-measurement'
import { applyMinMaxConstraints, mapAlignSelf } from './yoga-helpers'

export type AxisSizing = SceneNode['primaryAxisSizing']

export function sizesFitParent(
  parent: SceneNode,
  childCount: number,
  sizes: Array<number | undefined>,
  axis: 'width' | 'height'
): boolean {
  if (sizes.some((size) => size === undefined)) return false
  const padding =
    axis === 'width'
      ? parent.paddingLeft + parent.paddingRight
      : parent.paddingTop + parent.paddingBottom
  const gap =
    parent.primaryAxisAlign === 'SPACE_BETWEEN'
      ? 0
      : parent.itemSpacing * Math.max(0, childCount - 1)
  const available = axis === 'width' ? parent.width : parent.height
  const total = sizes.reduce<number>((sum, size) => sum + (size ?? 0), padding + gap)
  return Math.abs(total - available) < 0.001
}

function derivedGrowingLeafFitsParent(
  graph: SceneGraph,
  parent: SceneNode,
  child: SceneNode,
  axis: 'width' | 'height'
): boolean {
  if (
    child.type !== 'TEXT' ||
    child.layoutGrow <= 0 ||
    child.figmaDerivedLayout?.[axis] === undefined
  ) {
    return false
  }
  const children = graph
    .getChildren(parent.id)
    .filter((candidate) => candidate.visible && candidate.layoutPositioning !== 'ABSOLUTE')
  const sizes = children.map((candidate) => {
    if (candidate.layoutGrow > 0) return candidate.figmaDerivedLayout?.[axis]
    return axis === 'width' ? candidate.width : candidate.height
  })
  return sizesFitParent(parent, children.length, sizes, axis)
}

function configureTextLeafWithoutMeasurer(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  fixedDerivedMainAxis: boolean
): void {
  const hasStoredSize =
    child.width > 0 && child.height > 0 && !(child.width === 100 && child.height === 100)

  if (child.textAutoResize === 'WIDTH_AND_HEIGHT') {
    if (hasStoredSize) {
      yogaChild.setWidth(child.width)
      yogaChild.setHeight(child.height)
    } else {
      const estimated = estimateTextSize(child)
      yogaChild.setWidth(estimated.width)
      yogaChild.setHeight(estimated.height)
    }
    return
  }
  if (child.textAutoResize !== 'HEIGHT') return

  const isRow = parent.layoutMode === 'HORIZONTAL'
  const measurementWidth = fixedDerivedMainAxis
    ? (child.figmaDerivedLayout?.width ?? child.width)
    : child.width
  const stretches =
    child.layoutAlignSelf === 'STRETCH' ||
    (child.layoutAlignSelf === 'AUTO' && parent.counterAxisAlign === 'STRETCH')
  if (!(!isRow && stretches) && !fixedDerivedMainAxis) yogaChild.setWidth(child.width)
  if (hasStoredSize) yogaChild.setHeight(child.height)
  else yogaChild.setHeight(estimateTextSize(child, measurementWidth).height)
}

export function configureChildAsLeaf(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: SceneGraph
): void {
  const isRow = parent.layoutMode === 'HORIZONTAL'
  const selfOverride = child.layoutAlignSelf !== 'AUTO'
  const stretchCross = selfOverride
    ? child.layoutAlignSelf === 'STRETCH'
    : parent.counterAxisAlign === 'STRETCH'

  const isText = child.type === 'TEXT'
  const textMeasurer = getTextMeasurer()
  const needsMeasureFunc = isText && textMeasurer && child.textAutoResize !== 'NONE'

  const fixedDerivedMainAxis = isRow
    ? derivedGrowingLeafFitsParent(graph, parent, child, 'width')
    : derivedGrowingLeafFitsParent(graph, parent, child, 'height')

  if (fixedDerivedMainAxis) {
    if (isRow) yogaChild.setWidth(child.figmaDerivedLayout?.width ?? child.width)
    else yogaChild.setHeight(child.figmaDerivedLayout?.height ?? child.height)
  }

  if (needsMeasureFunc) {
    configureTextLeaf(yogaChild, child, parent, fixedDerivedMainAxis)
  } else if (isText && !textMeasurer && child.textAutoResize !== 'NONE') {
    configureTextLeafWithoutMeasurer(yogaChild, child, parent, fixedDerivedMainAxis)
  } else {
    configureNonTextLeaf(yogaChild, child, isRow, stretchCross)
  }

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  applyMinMaxConstraints(yogaChild, child)
}

function configureTextLeaf(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  fixedDerivedMainAxis = false
): void {
  const autoResize = child.textAutoResize
  const isRow = parent.layoutMode === 'HORIZONTAL'

  if (child.layoutGrow > 0 && !fixedDerivedMainAxis) {
    yogaChild.setFlexGrow(child.layoutGrow)
  }

  const cache = new Map<number, { width: number; height: number }>()
  const UNCONSTRAINED_KEY = -1

  if (autoResize === 'WIDTH_AND_HEIGHT') {
    const importedSize = child.figmaDerivedLayout
    if (importedSize?.width !== undefined && importedSize.height !== undefined) {
      yogaChild.setWidth(child.width)
      yogaChild.setHeight(child.height)
      return
    }

    yogaChild.setMeasureFunc((width, widthMode, _height, _heightMode) => {
      const maxW = widthMode === MeasureMode.Undefined ? undefined : width
      const cacheKey = maxW === undefined ? UNCONSTRAINED_KEY : Math.round(maxW)
      const cached = cache.get(cacheKey)
      if (cached) return cached

      const measured = getTextMeasurer()?.(child, maxW)
      const result = measured ?? estimateTextSize(child, maxW)
      cache.set(cacheKey, result)
      return result
    })
  } else if (autoResize === 'HEIGHT') {
    const stretchesCross =
      child.layoutAlignSelf === 'STRETCH' ||
      (child.layoutAlignSelf === 'AUTO' && parent.counterAxisAlign === 'STRETCH')
    // Let Yoga stretch fill-width text instead of fixing its stored width.
    const fillsWidth = !isRow && stretchesCross
    const fixedWidth = fixedDerivedMainAxis
      ? (child.figmaDerivedLayout?.width ?? child.width)
      : child.width
    if (child.layoutGrow <= 0 && !fillsWidth) {
      yogaChild.setWidth(fixedWidth)
    }
    yogaChild.setMeasureFunc((width, widthMode, _height, _heightMode) => {
      let constraintW = fixedWidth
      if (fillsWidth) {
        if (widthMode !== MeasureMode.Undefined) constraintW = width
      } else if (widthMode !== MeasureMode.Undefined) {
        constraintW = Math.min(width, fixedWidth || width)
      }
      const cacheKey = Math.round(constraintW)
      const cached = cache.get(cacheKey)
      if (cached) return cached

      const measured = getTextMeasurer()?.(child, constraintW)
      const result = {
        width: constraintW,
        height: measured?.height ?? estimateTextSize(child, constraintW).height
      }
      cache.set(cacheKey, result)
      return result
    })
  }
}

function configureNonTextLeaf(
  yogaChild: YogaNode,
  child: SceneNode,
  isRow: boolean,
  stretchCross: boolean
): void {
  const w = child.width
  const h = child.height

  if (child.layoutGrow > 0) {
    yogaChild.setFlexGrow(child.layoutGrow)
    if (!stretchCross) {
      if (isRow) yogaChild.setHeight(h)
      else yogaChild.setWidth(w)
    }
  } else {
    if (isRow) {
      yogaChild.setWidth(w)
      if (!stretchCross) yogaChild.setHeight(h)
    } else {
      yogaChild.setHeight(h)
      if (!stretchCross) yogaChild.setWidth(w)
    }
  }
}

export function setMainAxisSizing(
  yogaNode: YogaNode,
  axis: 'width' | 'height',
  sizing: AxisSizing,
  fixedValue: number,
  grow: number
): void {
  if (grow > 0) {
    yogaNode.setFlexGrow(grow)
    yogaNode.setFlexShrink(1)
    yogaNode.setFlexBasis(0)
    return
  }

  switch (sizing) {
    case 'FIXED':
      if (axis === 'width') yogaNode.setWidth(fixedValue)
      else yogaNode.setHeight(fixedValue)
      break
    case 'HUG':
      break
    case 'FILL':
      yogaNode.setFlexGrow(1)
      yogaNode.setFlexShrink(1)
      yogaNode.setFlexBasis(0)
      break
  }
}

export function setCrossAxisSizing(
  yogaNode: YogaNode,
  axis: 'width' | 'height',
  sizing: AxisSizing,
  fixedValue: number
): void {
  switch (sizing) {
    case 'FIXED':
      if (axis === 'width') yogaNode.setWidth(fixedValue)
      else yogaNode.setHeight(fixedValue)
      break
    case 'HUG':
      break
    case 'FILL':
      yogaNode.setAlignSelf(Align.Stretch)
      break
  }
}
