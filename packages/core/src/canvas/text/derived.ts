import type { Canvas, Path } from 'canvaskit-wasm'
import { fromUint8Array } from 'js-base64'

import {
  hasTextList,
  textListItems,
  textParagraphRanges,
  type Color,
  type Fill,
  type DerivedTextGlyph,
  type SceneNode,
  type Stroke,
  type TextParagraphRange
} from '@open-pencil/scene-graph'

import { ResourceCache } from '#core/cache/resource'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  drawTextDecorations,
  hasDecoration,
  savedTextDecorationRects
} from '#core/canvas/text/decorations'
import { geometryBlobToPath } from '#core/vector'

const MAX_GLYPH_SILHOUETTES = 512
/** Saved glyphs a renderer keeps decoded: every text on a page of saved text redraws at once. */
const MAX_DERIVED_GLYPH_PATHS = 16384

/** Decoded saved glyph outlines, by the glyph's command bytes, which a node keeps until it changes. */
export function createDerivedGlyphPathCache(): ResourceCache<Uint8Array, Path> {
  return new ResourceCache({
    maxEntries: MAX_DERIVED_GLYPH_PATHS,
    dispose: (path) => path.delete()
  })
}

/** A saved glyph's outline, decoded once and borrowed from the renderer's cache. */
function derivedGlyphPath(r: SkiaRenderer, blob: Uint8Array): Path {
  const cached = r.derivedGlyphPathCache.get(blob)
  if (cached) return cached
  const path = geometryBlobToPath(r.ck, blob, 'NONZERO')
  r.derivedGlyphPathCache.set(blob, path)
  return path
}

export function createGlyphSilhouetteCache(): ResourceCache<string, Path> {
  return new ResourceCache({ maxEntries: MAX_GLYPH_SILHOUETTES, dispose: (path) => path.delete() })
}

export function snapDerivedGlyphBaseline(y: number): number {
  return Math.round(y)
}

export function shouldUseHardDerivedGlyphCoverage(
  node: Pick<SceneNode, 'fontSize' | 'fontWeight'>
): boolean {
  return node.fontSize === 20 && node.fontWeight === 400
}

/**
 * Path-text glyphs carry non-zero Figma `Glyph.rotation` (radians). Used to
 * disable axis-aligned assumptions (baseline snap, underline decorations).
 */
export function hasRotatedDerivedGlyphs(node: Pick<SceneNode, 'derivedTextGlyphs'>): boolean {
  return node.derivedTextGlyphs?.some((glyph) => (glyph.rotation ?? 0) !== 0) === true
}

/**
 * Resize-reflowed TEXT_PATH node: glyphs were re-laid along the path and the
 * baked node-level strokeGeometry was cleared — strokes must be re-derived
 * per glyph (see drawReflowedPathTextSilhouettes).
 */
export function isReflowedPathText(node: SceneNode): boolean {
  return (
    node.type === 'TEXT' &&
    (node.derivedTextGlyphs?.length ?? 0) > 0 &&
    node.textPathBox !== null &&
    node.strokeGeometry.length === 0 &&
    node.textPathData !== null
  )
}

interface GlyphSilhouette {
  path: Path
  cached: boolean
}

/**
 * Silhouette = glyph outline dilated by the stroke weight, unioned with the
 * glyph itself (font units, so one cache entry serves every placement).
 * Cached paths are never deleted — the cache is content-keyed and bounded by
 * the number of distinct glyph outlines.
 *
 * ponytail: approximates every stroke.align as OUTSIDE (full-weight band
 * outside the glyph, backfilled by the union). Matches the baked path-text
 * stroke pipeline, which is OUTSIDE-oriented too, so it's consistent — but
 * CENTER sits too far out and INSIDE shows a band the fill should cover. Full
 * parity means per-align geometry (+ align in the cache key); deferred as the
 * reflow fallback only fires on resized stroked path text.
 */
function getGlyphSilhouette(
  r: SkiaRenderer,
  glyph: DerivedTextGlyph,
  stroke: Stroke
): GlyphSilhouette {
  const blob = glyph.commandsBlob
  const relativeWeight = stroke.weight / glyph.fontSize
  const key = `${fromUint8Array(blob)}:${relativeWeight.toFixed(5)}`
  const cached = r.glyphSilhouetteCache.peek(key)
  if (cached) return { path: cached, cached: true }

  const base = geometryBlobToPath(r.ck, blob, 'NONZERO')
  const outline = base.copy()
  // Round join/cap: miter spikes on glyph cusps (e.g. 'A' apex) shoot far
  // outside the letterform. Width doubles because half the band is swallowed
  // by the union with the glyph body (OUTSIDE-stroke look).
  const stroked = outline.makeStroked({
    width: relativeWeight * 2,
    join: r.ck.StrokeJoin.Round,
    cap: r.ck.StrokeCap.Round
  })
  const merged = stroked ? r.ck.Path.MakeFromOp(stroked, base, r.ck.PathOp.Union) : null
  if (!merged) {
    // Degenerate outline — draw the bare glyph, uncached so callers free it.
    outline.delete()
    stroked?.delete()
    return { path: base, cached: false }
  }
  base.delete()
  stroked?.delete()
  outline.delete()
  // Preserve reset-at-capacity for stroke-weight sweeps; the cache owns path disposal.
  if (r.glyphSilhouetteCache.size >= MAX_GLYPH_SILHOUETTES) r.glyphSilhouetteCache.clear()
  r.glyphSilhouetteCache.set(key, merged)
  return { path: merged, cached: true }
}

/**
 * Push a glyph's on-path transform: baseline → non-uniform scale → rotate →
 * font-units→px (Y-flipped). The fill and silhouette passes share it so they
 * stay registered; see drawDerivedText for the order rationale.
 */
function applyGlyphEmTransform(canvas: Canvas, glyph: DerivedTextGlyph, glyphY: number): void {
  canvas.translate(glyph.x, glyphY)
  const scaleX = glyph.scaleX ?? 1
  const scaleY = glyph.scaleY ?? 1
  if (scaleX !== 1 || scaleY !== 1) canvas.scale(scaleX, scaleY)
  const rotation = glyph.rotation ?? 0
  if (rotation !== 0) canvas.rotate((-rotation * 180) / Math.PI, 0, 0)
  canvas.scale(glyph.fontSize, -glyph.fontSize)
}

/**
 * Paint per-glyph stroke silhouettes under a reflowed path-text node.
 * Transform chain mirrors drawDerivedText exactly so silhouettes and
 * fills stay registered.
 */
export function drawReflowedPathTextSilhouettes(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  stroke: Stroke,
  color: Color
): void {
  const glyphs = node.derivedTextGlyphs
  if (!glyphs?.length || stroke.weight <= 0) return

  const snapBaselines = !hasRotatedDerivedGlyphs(node)
  const paint = new r.ck.Paint()
  paint.setAntiAlias(true)
  paint.setStyle(r.ck.PaintStyle.Fill)
  paint.setColor(r.ck.Color4f(color.r, color.g, color.b, color.a))
  paint.setAlphaf(stroke.opacity)
  try {
    for (const glyph of glyphs) {
      if (glyph.fontSize <= 0) continue
      const silhouette = getGlyphSilhouette(r, glyph, stroke)
      canvas.save()
      applyGlyphEmTransform(
        canvas,
        glyph,
        snapBaselines ? snapDerivedGlyphBaseline(glyph.y) : glyph.y
      )
      canvas.drawPath(silhouette.path, paint)
      canvas.restore()
      if (!silhouette.cached) silhouette.path.delete()
    }
  } finally {
    paint.delete()
  }
}

/**
 * Paint Figma-baked glyph outlines (missing-font / path-text fidelity path).
 *
 * Transform order is intentional and matched against real TEXT_PATH fixtures
 * (e.g. DomeSticker circular lettering):
 *
 *   1. translate(x, y)     — baseline on the path (already resize-scaled)
 *   2. scale(scaleX,Y)     — non-uniform resize (must be *outside* rotation;
 *                            S and R do not commute — see resize scaleX/Y)
 *   3. rotate(-θ°)         — negate: CanvasKit degrees + following Y-flip;
 *                            positive Figma radians would otherwise misalign
 *                            black fills vs white strokeGeometry
 *   4. scale(fontSize,-fs) — font units → px; Y flip (font space is up-positive)
 */
/** The paragraph holding text index `index`, found by bisection: saved glyphs can be many. */
function rangeIndexAt(ranges: readonly TextParagraphRange[], index: number): number {
  let lo = 0
  let hi = ranges.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ranges[mid].start <= index) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * The character whose style each saved list marker takes: the first of its list, as Figma
 * draws markers. Figma saves a marker, with no character of its own, before its item's glyphs.
 */
function markerStyleCharacters(node: SceneNode): Map<number, number> {
  const characters = new Map<number, number>()
  if (!hasTextList(node)) return characters
  const ranges = textParagraphRanges(node.text)
  const listStarts = new Map(
    textListItems(node.text, node.textParagraphs).map((item) => [
      item.paragraph,
      ranges[item.groupStart].start
    ])
  )
  let markers: number[] = []
  for (const [index, glyph] of (node.derivedTextGlyphs ?? []).entries()) {
    if (glyph.firstCharacter === undefined) {
      markers.push(index)
      continue
    }
    const start = listStarts.get(rangeIndexAt(ranges, glyph.firstCharacter))
    if (start !== undefined) for (const marker of markers) characters.set(marker, start)
    markers = []
  }
  return characters
}

function savedTextEligibility(node: SceneNode): boolean {
  // Glyphs without a character are list markers in a list, and unknown text otherwise.
  const charactersKnown = hasTextList(node)
    ? !!node.derivedTextGlyphs?.some((glyph) => glyph.firstCharacter !== undefined)
    : !!node.derivedTextGlyphs?.every((glyph) => glyph.firstCharacter !== undefined)
  return (
    node.styleRuns.length === 0 ||
    (node.fills.filter((paint) => paint.visible).length === 1 &&
      charactersKnown &&
      node.styleRuns.every(
        (run) =>
          !run.style.fills ||
          run.style.fills.every(
            (paint) => paint.type === 'SOLID' && (!paint.blendMode || paint.blendMode === 'NORMAL')
          )
      ))
  )
}

export function canDrawSavedText(node: SceneNode, fill?: Fill): boolean {
  if (fill && fill.type !== 'SOLID') return false
  return savedTextEligibility(node)
}

export function drawDerivedText(r: SkiaRenderer, canvas: Canvas, node: SceneNode): boolean {
  if (!node.derivedTextGlyphs?.length) return false

  // Pixel-snap is for horizontal Figma baselines only — on a curve it stair-steps
  // letter positions and breaks registration with strokeGeometry.
  const snapBaselines = !hasRotatedDerivedGlyphs(node)
  const savedTextEligible = savedTextEligibility(node)
  const markerCharacters = markerStyleCharacters(node)
  for (const [index, glyph] of node.derivedTextGlyphs.entries()) {
    const glyphY = snapBaselines ? snapDerivedGlyphBaseline(glyph.y) : glyph.y
    const path = derivedGlyphPath(r, glyph.commandsBlob)
    canvas.save()
    applyGlyphEmTransform(canvas, glyph, glyphY)
    const shouldUseHardCoverage = shouldUseHardDerivedGlyphCoverage(node)
    if (shouldUseHardCoverage) r.fillPaint.setAntiAlias(false)
    const character = glyph.firstCharacter ?? markerCharacters.get(index)
    const run =
      character === undefined
        ? undefined
        : node.styleRuns.find((run) => character >= run.start && character < run.start + run.length)
    const fills = run?.style.fills
    if (fills && savedTextEligible) {
      const paint = r.fillPaint.copy()
      try {
        for (const fill of fills) {
          if (!fill.visible || fill.type !== 'SOLID') continue
          const color = fill.color
          paint.setColor(r.ck.Color4f(color.r, color.g, color.b, color.a * fill.opacity))
          canvas.drawPath(path, paint)
        }
      } finally {
        paint.delete()
      }
    } else canvas.drawPath(path, r.fillPaint)
    if (shouldUseHardCoverage) r.fillPaint.setAntiAlias(true)
    canvas.restore()
  }

  // Decorations follow horizontal lines; path text has none.
  if (snapBaselines && hasDecoration(node)) {
    const glyphs = node.derivedTextGlyphs
    const rects = savedTextDecorationRects(r.derivedDecorationCache, node, glyphs, r.fontGeneration)
    drawTextDecorations(r.ck, canvas, rects, r.fillPaint)
  }
  return true
}
