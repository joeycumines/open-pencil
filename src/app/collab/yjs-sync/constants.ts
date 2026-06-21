import type * as Y from 'yjs'

import type { EditorStore } from '@/app/editor/active-store'
import { YJS_JSON_FIELDS } from '@/constants'

export type YNodes = Y.Map<Y.Map<unknown>>
export type YImages = Y.Map<Uint8Array>
export type YVariables = Y.Map<Y.Map<unknown>>
export type YCollections = Y.Map<Y.Map<unknown>>

export type NodeProps = Record<string, unknown>

export type GraphBindingOptions = {
  store: EditorStore
  getYdoc: () => Y.Doc | null
  getYnodes: () => YNodes | null
  getSuppressGraphSync: () => boolean
  setSuppressYjsEvents: (value: boolean) => void
  syncNodeToYjs: (nodeId: string) => void
  syncVariableToYjs: (variableId: string) => void
  syncCollectionToYjs: (collectionId: string) => void
}

export type ReconcileRootFn = (
  store: EditorStore,
  remoteRootStableId: string,
  ynode: Y.Map<unknown>,
  ynodes: YNodes
) => void

export type YjsObserverOptions = {
  store: EditorStore
  ynodes: Y.Map<Y.Map<unknown>>
  yimages: Y.Map<Uint8Array>
  yvariables: YVariables
  ycollections: YCollections
  getSuppressYjsEvents: () => boolean
  setSuppressGraphSync: (value: boolean) => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  reconcileRemoteRoot?: ReconcileRootFn
}

export type YjsGraphSyncOptions = {
  getStore: () => EditorStore
  getYdoc: () => Y.Doc | null
  getYnodes: () => YNodes | null
  getYimages: () => YImages | null
  getYvariables: () => YVariables | null
  getYcollections: () => YCollections | null
  setSuppressYjsEvents: (value: boolean) => void
}

export const EXCLUDED_SYNC_KEYS = new Set<string>([
  'source',
  'fillGeometry',
  'strokeGeometry',
  'textPicture',
  'figmaDerivedLayout',
  'figmaDerivedTextGlyphs'
])

export const YJS_NODE_PROPERTY_KEYS = new Set<string>([
  'id',
  'type',
  'name',
  'parentId',
  'childIds',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'locked',
  'clipsContent',
  'blendMode',
  'fills',
  'strokes',
  'effects',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'independentCorners',
  'cornerSmoothing',
  'text',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'italic',
  'textAlignHorizontal',
  'textDirection',
  'textAlignVertical',
  'textAutoResize',
  'textCase',
  'textDecoration',
  'textDecorationStyle',
  'textDecorationThickness',
  'textDecorationFills',
  'textDecorationSkipInk',
  'textUnderlineOffset',
  'leadingTrim',
  'lineHeight',
  'letterSpacing',
  'maxLines',
  'styleRuns',
  'fontVariations',
  'fontFeatures',
  'horizontalConstraint',
  'verticalConstraint',
  'constraints',
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
  'layoutPositioning',
  'layoutGrow',
  'layoutAlignSelf',
  'vectorNetwork',
  'booleanOperation',
  'arcData',
  'strokeCap',
  'strokeJoin',
  'dashPattern',
  'borderTopWeight',
  'borderRightWeight',
  'borderBottomWeight',
  'borderLeftWeight',
  'independentStrokeWeights',
  'strokeMiterLimit',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'isMask',
  'maskType',
  'maskIsOutline',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumnGap',
  'gridRowGap',
  'gridPosition',
  'counterAxisAlignContent',
  'itemReverseZIndex',
  'strokesIncludedInLayout',
  'expanded',
  'textTruncation',
  'autoRename',
  'pointCount',
  'starInnerRadius',
  'componentId',
  'overrides',
  'componentPropertyDefinitions',
  'componentPropertyValues',
  'componentKey',
  'sourceLibraryKey',
  'publishId',
  'overrideKey',
  'sharedSymbolVersion',
  'publishedVersion',
  'isPublishable',
  'isSymbolPublishable',
  'symbolDescription',
  'symbolLinks',
  'variantPropSpecs',
  'boundVariables',
  'exportSettings',
  'pluginData',
  'pluginRelaunchData',
  'internalOnly',
  'flipX',
  'flipY',
  'sourceId',
  'sourceFormat',
  'sourceFig'
])

export const JSON_PROPERTY_KEYS = new Set<string>([
  ...YJS_JSON_FIELDS,
  'constraints',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridPosition',
  'pluginData',
  'pluginRelaunchData',
  'textDecorationFills',
  'fontVariations',
  'fontFeatures',
  'arcData',
  'componentPropertyDefinitions',
  'componentPropertyValues',
  'symbolLinks',
  'variantPropSpecs',
  'exportSettings',
  'dashPattern',
  'overrides',
  'childIds',
  'boundVariables'
])
