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

// Properties whose change alters imported glyph outlines or per-glyph
// positioning — the invalidation set for `figmaDerivedTextGlyphs`.
const GLYPH_SHAPING_KEYS = [
  'text',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'italic',
  'textDirection',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textLanguage',
  'fontVariations',
  'fontFeatures',
  'styleRuns'
] as const

// Layout, alignment, fill, and appearance properties that must NOT destroy
// authoritative imported glyph outlines (they are handled at render time).
const PICTURE_ONLY_KEYS = [
  'textAlignHorizontal',
  'textAlignVertical',
  'textAutoResize',
  'leadingTrim',
  'maxLines',
  'textTruncation',
  'width',
  'height',
  ...DECORATION_APPEARANCE_KEYS,
  'fills'
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
    for (const k of GLYPH_SHAPING_KEYS) {
      expect(keys.has(k)).toBe(true)
    }
    for (const k of [...PICTURE_ONLY_KEYS, 'opacity', 'visible', 'name']) {
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
