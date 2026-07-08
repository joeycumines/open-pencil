/**
 * Properties that affect the rendered text picture (visual preview).
 * When any of these change, `textPicture` must be invalidated because
 * the rendered output may differ.
 */
export const TEXT_PICTURE_KEYS: ReadonlySet<string> = new Set([
  'text',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'italic',
  'textAlignHorizontal',
  'textDirection',
  'textAlignVertical',
  'lineHeight',
  'letterSpacing',
  'textDecoration',
  'textCase',
  'styleRuns',
  'fills',
  'width',
  'height'
])

/**
 * Properties that affect glyph shapes and their positions.
 * When any of these change, `figmaDerivedTextGlyphs` must be invalidated
 * because the glyph outline data from Figma is no longer valid.
 *
 * This is a subset of `TEXT_PICTURE_KEYS` that EXCLUDES properties
 * affecting only rendering/layout (`fills`, `textDecoration`, `width`,
 * `height`). The distinction is critical during FIG import: the pipeline
 * sets `figmaDerivedTextGlyphs` via DSD propagation and then later
 * applies fills/layout overrides via `updateNode`. If fills/width/height
 * were in this set, those later overrides would null the glyphs.
 */
export const TEXT_GLYPH_KEYS: ReadonlySet<string> = new Set([
  'text',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'italic',
  'textAlignHorizontal',
  'textDirection',
  'textAlignVertical',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'styleRuns'
])
