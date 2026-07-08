import type { Color } from './primitives'

export const BLACK: Color = { r: 0, g: 0, b: 0, a: 1 }
export const TRANSPARENT: Color = { r: 0, g: 0, b: 0, a: 0 }
export const DEFAULT_FONT_FAMILY = 'Inter'
export const DEFAULT_STROKE_MITER_LIMIT = 4

export const LAYOUT_AFFECTING_KEYS: ReadonlySet<string> = new Set([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'flipX',
  'flipY',
  'layoutMode',
  'layoutDirection',
  'itemSpacing',
  'counterAxisSpacing',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'primaryAxisAlign',
  'counterAxisAlign',
  'counterAxisAlignContent',
  'layoutWrap',
  'primaryAxisSizing',
  'counterAxisSizing',
  'layoutPositioning',
  'layoutGrow',
  'layoutAlignSelf',
  'strokesIncludedInLayout',
  'horizontalConstraint',
  'verticalConstraint',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumnGap',
  'gridRowGap',
  'gridPosition',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight'
])
