import type { SceneNode } from '@open-pencil/core/scene-graph'

import {
  YJS_ORIGINAL_SOURCE_ID_KEY,
  YJS_PARENT_INSTANCE_ID_KEY,
  YJS_PARENT_INSTANCE_PATH_KEY
} from './constants'
import {
  isArcData,
  isComponentPropertyDefinition,
  isExportSetting,
  isGridPosition,
  isGridTrack,
  isPluginDataEntry,
  isPluginRelaunchDataEntry,
  isSymbolLink,
  isVariantPropSpec,
  isVectorNetwork
} from './structured-node-values'
import {
  hasOnlyKeys,
  hasOptionalValue,
  isArrayOf,
  isFiniteNumber,
  isFiniteNumberArray,
  isNullableFiniteNumber,
  isOneOf,
  isPlainRecord,
  isStringArray,
  type Validator
} from './validation-primitives'

export { isPlainRecord } from './validation-primitives'

export const INVALID_YJS_NODE_VALUE = Symbol('invalid-yjs-node-value')

const NODE_TYPES = [
  'CANVAS',
  'FRAME',
  'GROUP',
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'LINE',
  'ELLIPSE',
  'POLYGON',
  'RECTANGLE',
  'TEXT',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'SECTION',
  'CONNECTOR',
  'SHAPE_WITH_TEXT',
  'ROUNDED_RECTANGLE'
] as const satisfies readonly SceneNode['type'][]

const BLEND_MODES = [
  'NORMAL',
  'DARKEN',
  'MULTIPLY',
  'COLOR_BURN',
  'LIGHTEN',
  'SCREEN',
  'COLOR_DODGE',
  'OVERLAY',
  'SOFT_LIGHT',
  'HARD_LIGHT',
  'DIFFERENCE',
  'EXCLUSION',
  'HUE',
  'SATURATION',
  'COLOR',
  'LUMINOSITY',
  'PASS_THROUGH'
] as const

const FILL_TYPES = [
  'SOLID',
  'GRADIENT_LINEAR',
  'GRADIENT_RADIAL',
  'GRADIENT_ANGULAR',
  'GRADIENT_DIAMOND',
  'IMAGE',
  'VIDEO',
  'PATTERN',
  'NOISE',
  'CUSTOM'
] as const

const IMAGE_SCALE_MODES = ['FILL', 'FIT', 'CROP', 'TILE'] as const
const NOISE_TYPES = ['MULTITONE', 'MONOTONE', 'DUOTONE'] as const
const PATTERN_TILE_TYPES = ['RECTANGULAR', 'HORIZONTAL_HEXAGONAL', 'VERTICAL_HEXAGONAL'] as const
const PATTERN_ALIGNMENTS = ['START', 'CENTER', 'END'] as const
const STROKE_ALIGNMENTS = ['INSIDE', 'CENTER', 'OUTSIDE'] as const
const STROKE_CAPS = ['NONE', 'ROUND', 'SQUARE', 'ARROW_LINES', 'ARROW_EQUILATERAL'] as const
const STROKE_JOINS = ['MITER', 'BEVEL', 'ROUND'] as const
const EFFECT_TYPES = [
  'DROP_SHADOW',
  'INNER_SHADOW',
  'LAYER_BLUR',
  'BACKGROUND_BLUR',
  'FOREGROUND_BLUR'
] as const
const CONSTRAINT_TYPES = ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE'] as const
const TEXT_ALIGN_HORIZONTAL = ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'] as const
const TEXT_DIRECTIONS = ['AUTO', 'LTR', 'RTL'] as const
const TEXT_ALIGN_VERTICAL = ['TOP', 'CENTER', 'BOTTOM'] as const
const TEXT_AUTO_RESIZE = ['NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT', 'TRUNCATE'] as const
const TEXT_CASES = ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE'] as const
const TEXT_DECORATIONS = ['NONE', 'UNDERLINE', 'STRIKETHROUGH'] as const
const TEXT_DECORATION_STYLES = ['SOLID', 'DOTTED', 'WAVY'] as const
const LEADING_TRIMS = ['NONE', 'CAP_HEIGHT'] as const
const LAYOUT_MODES = ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'] as const
const LAYOUT_DIRECTIONS = ['AUTO', 'LTR', 'RTL'] as const
const LAYOUT_WRAPS = ['NO_WRAP', 'WRAP'] as const
const LAYOUT_ALIGNS = ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'] as const
const LAYOUT_COUNTER_ALIGNS = ['MIN', 'CENTER', 'MAX', 'STRETCH', 'BASELINE'] as const
const LAYOUT_SIZING = ['FIXED', 'HUG', 'FILL'] as const
const LAYOUT_POSITIONING = ['AUTO', 'ABSOLUTE'] as const
const LAYOUT_ALIGN_SELF = ['AUTO', 'MIN', 'CENTER', 'MAX', 'STRETCH', 'BASELINE'] as const
const BOOLEAN_OPERATIONS = ['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE'] as const
const MASK_TYPES = ['ALPHA', 'VECTOR', 'LUMINANCE'] as const
const COUNTER_AXIS_ALIGN_CONTENT = ['AUTO', 'SPACE_BETWEEN'] as const
const TEXT_TRUNCATIONS = ['DISABLED', 'ENDING'] as const

const BOOLEAN_KEYS = new Set<string>([
  'visible',
  'locked',
  'clipsContent',
  'independentCorners',
  'italic',
  'textDecorationSkipInk',
  'independentStrokeWeights',
  'isMask',
  'maskIsOutline',
  'itemReverseZIndex',
  'strokesIncludedInLayout',
  'expanded',
  'autoRename',
  'isPublishable',
  'isSymbolPublishable',
  'internalOnly',
  'flipX',
  'flipY'
])

const FINITE_NUMBER_KEYS = new Set<string>([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'cornerSmoothing',
  'fontSize',
  'fontWeight',
  'letterSpacing',
  'itemSpacing',
  'counterAxisSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'layoutGrow',
  'borderTopWeight',
  'borderRightWeight',
  'borderBottomWeight',
  'borderLeftWeight',
  'strokeMiterLimit',
  'gridColumnGap',
  'gridRowGap',
  'pointCount',
  'starInnerRadius'
])

const NULLABLE_NUMBER_KEYS = new Set<string>([
  'textDecorationThickness',
  'textUnderlineOffset',
  'lineHeight',
  'maxLines',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight'
])

const STRING_KEYS = new Set<string>([
  'id',
  'name',
  'text',
  'fontFamily',
  YJS_PARENT_INSTANCE_ID_KEY,
  YJS_ORIGINAL_SOURCE_ID_KEY,
  'sourceId',
  'symbolDescription',
  'sourceFig'
])

const NULLABLE_STRING_KEYS = new Set<string>([
  'parentId',
  'componentId',
  'sourceFormat',
  'componentKey',
  'sourceLibraryKey',
  'publishId',
  'overrideKey',
  'sharedSymbolVersion',
  'publishedVersion'
])
const STRING_ARRAY_KEYS = new Set<string>(['childIds', YJS_PARENT_INSTANCE_PATH_KEY])

const FIELD_VALIDATORS = createFieldValidators()

export function isSceneNodeType(value: unknown): value is SceneNode['type'] {
  return isOneOf(value, NODE_TYPES)
}

export function validateYNodePropertyValue(key: string, value: unknown): unknown {
  const validator = FIELD_VALIDATORS.get(key)
  if (validator === undefined) return value
  return validator(value) ? value : INVALID_YJS_NODE_VALUE
}

export function validateYNodeBareOverrideValue(key: string, prop: string, value: unknown): unknown {
  if (key !== prop) return INVALID_YJS_NODE_VALUE
  if (prop === 'boundVariables' && value === true) return true
  return INVALID_YJS_NODE_VALUE
}

function createFieldValidators(): ReadonlyMap<string, Validator> {
  const validators = new Map<string, Validator>()
  const setAll = (keys: Iterable<string>, validator: Validator) => {
    for (const key of keys) validators.set(key, validator)
  }

  setAll(STRING_KEYS, (value) => typeof value === 'string')
  setAll(NULLABLE_STRING_KEYS, (value) => typeof value === 'string' || value === null)
  validators.set('sourceFormat', (value) => value === null || value === 'fig')
  setAll(BOOLEAN_KEYS, (value) => typeof value === 'boolean')
  setAll(FINITE_NUMBER_KEYS, isFiniteNumber)
  setAll(NULLABLE_NUMBER_KEYS, isNullableFiniteNumber)
  setAll(STRING_ARRAY_KEYS, isStringArray)
  validators.set('type', isSceneNodeType)
  validators.set('fills', arrayValidator(isFill))
  validators.set('textDecorationFills', arrayValidator(isFill))
  validators.set('strokes', arrayValidator(isStroke))
  validators.set('effects', arrayValidator(isEffect))
  validators.set('blendMode', oneOfValidator(BLEND_MODES))
  validators.set('textAlignHorizontal', oneOfValidator(TEXT_ALIGN_HORIZONTAL))
  validators.set('textDirection', oneOfValidator(TEXT_DIRECTIONS))
  validators.set('textAlignVertical', oneOfValidator(TEXT_ALIGN_VERTICAL))
  validators.set('textAutoResize', oneOfValidator(TEXT_AUTO_RESIZE))
  validators.set('textCase', oneOfValidator(TEXT_CASES))
  validators.set('textDecoration', oneOfValidator(TEXT_DECORATIONS))
  validators.set('textDecorationStyle', oneOfValidator(TEXT_DECORATION_STYLES))
  validators.set('leadingTrim', oneOfValidator(LEADING_TRIMS))
  validators.set('styleRuns', arrayValidator(isStyleRun))
  validators.set('fontVariations', arrayValidator(isFontVariation))
  validators.set('fontFeatures', arrayValidator(isFontFeature))
  validators.set('horizontalConstraint', oneOfValidator(CONSTRAINT_TYPES))
  validators.set('verticalConstraint', oneOfValidator(CONSTRAINT_TYPES))
  validators.set('constraints', isConstraints)
  validators.set('layoutMode', oneOfValidator(LAYOUT_MODES))
  validators.set('layoutDirection', oneOfValidator(LAYOUT_DIRECTIONS))
  validators.set('layoutWrap', oneOfValidator(LAYOUT_WRAPS))
  validators.set('primaryAxisAlign', oneOfValidator(LAYOUT_ALIGNS))
  validators.set('counterAxisAlign', oneOfValidator(LAYOUT_COUNTER_ALIGNS))
  validators.set('primaryAxisSizing', oneOfValidator(LAYOUT_SIZING))
  validators.set('counterAxisSizing', oneOfValidator(LAYOUT_SIZING))
  validators.set('layoutPositioning', oneOfValidator(LAYOUT_POSITIONING))
  validators.set('layoutAlignSelf', oneOfValidator(LAYOUT_ALIGN_SELF))
  validators.set('vectorNetwork', (value) => value === null || isVectorNetwork(value))
  validators.set('booleanOperation', oneOfValidator(BOOLEAN_OPERATIONS))
  validators.set('arcData', (value) => value === null || isArcData(value))
  validators.set('strokeCap', oneOfValidator(STROKE_CAPS))
  validators.set('strokeJoin', oneOfValidator(STROKE_JOINS))
  validators.set('dashPattern', isFiniteNumberArray)
  validators.set('maskType', oneOfValidator(MASK_TYPES))
  validators.set('gridTemplateColumns', arrayValidator(isGridTrack))
  validators.set('gridTemplateRows', arrayValidator(isGridTrack))
  validators.set('gridPosition', (value) => value === null || isGridPosition(value))
  validators.set('counterAxisAlignContent', oneOfValidator(COUNTER_AXIS_ALIGN_CONTENT))
  validators.set('textTruncation', oneOfValidator(TEXT_TRUNCATIONS))
  validators.set('componentPropertyDefinitions', arrayValidator(isComponentPropertyDefinition))
  validators.set('componentPropertyValues', isStringRecord)
  validators.set('boundVariables', isStringRecord)
  validators.set('overrides', isPlainRecord)
  validators.set('symbolLinks', arrayValidator(isSymbolLink))
  validators.set('variantPropSpecs', arrayValidator(isVariantPropSpec))
  validators.set('exportSettings', arrayValidator(isExportSetting))
  validators.set('pluginData', arrayValidator(isPluginDataEntry))
  validators.set('pluginRelaunchData', arrayValidator(isPluginRelaunchDataEntry))
  return validators
}

function oneOfValidator(allowed: readonly string[]): Validator {
  return (value) => isOneOf(value, allowed)
}
function arrayValidator(predicate: (item: unknown) => boolean): Validator {
  return (value) => isArrayOf(value, predicate)
}
function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}
function isColor(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'r g b a')) return false
  return ['r', 'g', 'b', 'a'].every((key) => isFiniteNumber(value[key]))
}
function isVector(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, 'x y') &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
  )
}
function isMatrix(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'm00 m01 m02 m10 m11 m12')) return false
  return ['m00', 'm01', 'm02', 'm10', 'm11', 'm12'].every((key) => isFiniteNumber(value[key]))
}

function isFill(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (
    !hasOnlyKeys(
      value,
      'type color opacity visible blendMode gradientStops gradientTransform imageHash imageScaleMode imageTransform sourceNodeId scale spacing patternSpacing patternTileType verticalAlignment horizontalAlignment noiseType density noiseSize customEffectId'
    )
  )
    return false
  if (!isOneOf(value.type, FILL_TYPES)) return false
  if (!isColor(value.color)) return false
  if (!isFiniteNumber(value.opacity)) return false
  if (typeof value.visible !== 'boolean') return false
  return (
    hasValidFillBlendAndGradientOptions(value) &&
    hasValidFillImageOptions(value) &&
    hasValidFillPatternOptions(value) &&
    hasValidFillNoiseOptions(value)
  )
}

function hasValidFillBlendAndGradientOptions(value: Record<string, unknown>): boolean {
  return (
    hasOptionalValue(value, 'blendMode', (entry): entry is (typeof BLEND_MODES)[number] =>
      isOneOf(entry, BLEND_MODES)
    ) &&
    hasOptionalValue(value, 'gradientStops', (entry) => isArrayOf(entry, isGradientStop)) &&
    hasOptionalValue(value, 'gradientTransform', isMatrix)
  )
}

function hasValidFillImageOptions(value: Record<string, unknown>): boolean {
  return (
    hasOptionalValue(value, 'imageHash', (entry) => typeof entry === 'string') &&
    hasOptionalValue(
      value,
      'imageScaleMode',
      (entry): entry is (typeof IMAGE_SCALE_MODES)[number] => isOneOf(entry, IMAGE_SCALE_MODES)
    ) &&
    hasOptionalValue(value, 'imageTransform', isMatrix) &&
    hasOptionalValue(value, 'sourceNodeId', (entry) => typeof entry === 'string') &&
    hasOptionalValue(value, 'scale', isFiniteNumber) &&
    hasOptionalValue(value, 'spacing', isFiniteNumber)
  )
}

function hasValidFillPatternOptions(value: Record<string, unknown>): boolean {
  return (
    hasOptionalValue(value, 'patternSpacing', isVector) &&
    hasOptionalValue(
      value,
      'patternTileType',
      (entry): entry is (typeof PATTERN_TILE_TYPES)[number] => isOneOf(entry, PATTERN_TILE_TYPES)
    ) &&
    hasOptionalValue(
      value,
      'verticalAlignment',
      (entry): entry is (typeof PATTERN_ALIGNMENTS)[number] => isOneOf(entry, PATTERN_ALIGNMENTS)
    ) &&
    hasOptionalValue(
      value,
      'horizontalAlignment',
      (entry): entry is (typeof PATTERN_ALIGNMENTS)[number] => isOneOf(entry, PATTERN_ALIGNMENTS)
    )
  )
}

function hasValidFillNoiseOptions(value: Record<string, unknown>): boolean {
  return (
    hasOptionalValue(value, 'noiseType', (entry): entry is (typeof NOISE_TYPES)[number] =>
      isOneOf(entry, NOISE_TYPES)
    ) &&
    hasOptionalValue(value, 'density', isFiniteNumber) &&
    hasOptionalValue(value, 'noiseSize', isVector) &&
    hasOptionalValue(value, 'customEffectId', (entry) => typeof entry === 'string')
  )
}

function isGradientStop(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, 'color position') &&
    isColor(value.color) &&
    isFiniteNumber(value.position)
  )
}

function isStroke(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'color weight opacity visible type align blendMode cap join dashPattern'))
    return false
  return (
    isColor(value.color) &&
    isFiniteNumber(value.weight) &&
    isFiniteNumber(value.opacity) &&
    typeof value.visible === 'boolean' &&
    hasOptionalValue(value, 'type', (entry): entry is (typeof FILL_TYPES)[number] =>
      isOneOf(entry, FILL_TYPES)
    ) &&
    hasOptionalValue(value, 'align', (entry): entry is (typeof STROKE_ALIGNMENTS)[number] =>
      isOneOf(entry, STROKE_ALIGNMENTS)
    ) &&
    hasOptionalValue(value, 'blendMode', (entry): entry is (typeof BLEND_MODES)[number] =>
      isOneOf(entry, BLEND_MODES)
    ) &&
    hasOptionalValue(value, 'cap', (entry): entry is (typeof STROKE_CAPS)[number] =>
      isOneOf(entry, STROKE_CAPS)
    ) &&
    hasOptionalValue(value, 'join', (entry): entry is (typeof STROKE_JOINS)[number] =>
      isOneOf(entry, STROKE_JOINS)
    ) &&
    hasOptionalValue(value, 'dashPattern', isFiniteNumberArray)
  )
}

function isEffect(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'type color offset radius spread visible blendMode showShadowBehindNode'))
    return false
  return (
    isOneOf(value.type, EFFECT_TYPES) &&
    isColor(value.color) &&
    isVector(value.offset) &&
    isFiniteNumber(value.radius) &&
    isFiniteNumber(value.spread) &&
    typeof value.visible === 'boolean' &&
    hasOptionalValue(value, 'blendMode', (entry): entry is (typeof BLEND_MODES)[number] =>
      isOneOf(entry, BLEND_MODES)
    ) &&
    hasOptionalValue(value, 'showShadowBehindNode', (entry) => typeof entry === 'boolean')
  )
}

function isStyleRun(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'start length style')) return false
  return (
    isFiniteNumber(value.start) && isFiniteNumber(value.length) && isCharacterStyle(value.style)
  )
}

function isCharacterStyle(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (
    !hasOnlyKeys(
      value,
      'fontWeight italic textDecoration textDecorationStyle textDecorationThickness textDecorationFills textDecorationSkipInk textUnderlineOffset fontSize fontFamily letterSpacing lineHeight fills fontVariations fontFeatures'
    )
  )
    return false
  return (
    hasOptionalValue(value, 'fontWeight', isFiniteNumber) &&
    hasOptionalValue(value, 'italic', (entry) => typeof entry === 'boolean') &&
    hasOptionalValue(value, 'textDecoration', (entry): entry is (typeof TEXT_DECORATIONS)[number] =>
      isOneOf(entry, TEXT_DECORATIONS)
    ) &&
    hasOptionalValue(
      value,
      'textDecorationStyle',
      (entry): entry is (typeof TEXT_DECORATION_STYLES)[number] =>
        isOneOf(entry, TEXT_DECORATION_STYLES)
    ) &&
    hasOptionalValue(value, 'textDecorationThickness', isNullableFiniteNumber) &&
    hasOptionalValue(value, 'textDecorationFills', (entry) => isArrayOf(entry, isFill)) &&
    hasOptionalValue(value, 'textDecorationSkipInk', (entry) => typeof entry === 'boolean') &&
    hasOptionalValue(value, 'textUnderlineOffset', isNullableFiniteNumber) &&
    hasOptionalValue(value, 'fontSize', isFiniteNumber) &&
    hasOptionalValue(value, 'fontFamily', (entry) => typeof entry === 'string') &&
    hasOptionalValue(value, 'letterSpacing', isFiniteNumber) &&
    hasOptionalValue(value, 'lineHeight', isNullableFiniteNumber) &&
    hasOptionalValue(value, 'fills', (entry) => isArrayOf(entry, isFill)) &&
    hasOptionalValue(value, 'fontVariations', (entry) => isArrayOf(entry, isFontVariation)) &&
    hasOptionalValue(value, 'fontFeatures', (entry) => isArrayOf(entry, isFontFeature))
  )
}

function isFontVariation(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, 'axis value') &&
    typeof value.axis === 'string' &&
    isFiniteNumber(value.value)
  )
}

function isFontFeature(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, 'tag enabled') &&
    typeof value.tag === 'string' &&
    typeof value.enabled === 'boolean'
  )
}

function isConstraints(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  if (!hasOnlyKeys(value, 'horizontal vertical')) return false
  return isOneOf(value.horizontal, CONSTRAINT_TYPES) && isOneOf(value.vertical, CONSTRAINT_TYPES)
}
