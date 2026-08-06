import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

const SHARED_TEXT_KEYS = [
  'text',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'italic',
  'textAlignHorizontal',
  'textDirection',
  'textAlignVertical',
  'textAutoResize',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textLanguage',
  'leadingTrim',
  'maxLines',
  'styleRuns',
  'fontVariations',
  'fontFeatures',
  'textTruncation',
  'width',
  'height'
] as const

const DECORATION_APPEARANCE_KEYS = [
  'textDecoration',
  'textDecorationStyle',
  'textDecorationThickness',
  'textDecorationFills',
  'textDecorationSkipInk',
  'textUnderlineOffset'
] as const

describe('TEXT_PICTURE_KEYS membership', () => {
  test('contains text rendering properties', () => {
    const keys = SceneGraph.TEXT_PICTURE_KEYS
    for (const k of [...SHARED_TEXT_KEYS, ...DECORATION_APPEARANCE_KEYS, 'fills']) {
      expect(keys.has(k)).toBe(true)
    }
  })

  test('keeps imported glyph geometry invalidation narrower than text pictures', () => {
    const keys = SceneGraph.FIGMA_DERIVED_TEXT_GLYPH_KEYS
    for (const k of SHARED_TEXT_KEYS) {
      expect(keys.has(k)).toBe(true)
    }
    for (const k of [...DECORATION_APPEARANCE_KEYS, 'fills', 'opacity', 'visible', 'name']) {
      expect(keys.has(k)).toBe(false)
    }
  })

  test('does NOT contain non-text properties', () => {
    const keys = SceneGraph.TEXT_PICTURE_KEYS
    for (const k of ['x', 'y', 'rotation', 'opacity', 'visible', 'name']) {
      expect(keys.has(k)).toBe(false)
    }
  })
})
