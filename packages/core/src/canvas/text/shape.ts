import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm'

import {
  EMPTY_EXPORT_RUNTIME,
  type FigNodeChangeExportRuntime,
  type PlacedTextGlyph,
  type ShapedText,
  type ShapedTextGlyph,
  type TextDecorationRecord
} from '@open-pencil/fig/node-change'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { buildParagraph, textVerticalOffset } from '#core/canvas/text'
import { textDecorationRects, type DecoratedGlyph } from '#core/canvas/text/decorations'
import { outlineInk, savedGlyphInk } from '#core/canvas/text/ink'
import { laidOutGlyphs } from '#core/canvas/text/placed'
import { getCanvasKit } from '#core/canvaskit'
import { shownText } from '#core/text/case'
import { fontManager } from '#core/text/fonts'

/**
 * Whether saved glyphs could stand for this text: case changes that alter its length move
 * glyphs off the characters they came from, and path text is placed along its path. Truncated
 * text saves the characters it shows and the ellipsis after them.
 */
function canShape(node: SceneNode, text: string): boolean {
  return node.text.length > 0 && text.length === node.text.length && !node.textPathData
}

/** Characters inside a glyph cluster or without a glyph take the offset of the one before. */
function completeCharacterOffsets(offsets: Array<number | undefined>): number[] {
  let previous = 0
  return offsets.map((offset) => {
    previous = offset ?? previous
    return previous
  })
}

/**
 * Lay a text node out as the renderer draws it and pair each shaped glyph with the outline of
 * the glyph ID CanvasKit chose, so ligatures and contextual forms keep their shapes. When a run's
 * font is missing, variable, or a fallback, no glyph gets an outline: the layout still stands,
 * and readers draw the text themselves.
 * Returns `null` for text saved glyphs cannot represent at all.
 */
export function shapeText(
  ck: CanvasKit,
  fontProvider: TypefaceFontProvider,
  node: SceneNode
): ShapedText | null {
  const text = shownText(node)
  if (!canShape(node, text)) return null

  const paragraph = buildParagraph({ ck, fontProvider, fontsLoaded: true }, node, undefined, {
    halfLeading: true
  })
  try {
    const offsetY = textVerticalOffset(node, paragraph.getHeight())
    const placed = laidOutGlyphs(node, paragraph, text, offsetY)
    if (!placed) return null
    const metrics = paragraph.getLineMetrics()
    const characterOffsets: Array<number | undefined> = Array.from({ length: text.length })
    const glyphs: ShapedTextGlyph[] = placed.map((glyph) => {
      if (glyph.firstCharacter !== undefined) {
        characterOffsets[glyph.firstCharacter] ??= glyph.x - glyph.lineLeft
      }
      return {
        commands: glyph.source?.outline(glyph.id, glyph.fontSize) ?? null,
        x: glyph.x,
        y: glyph.y,
        fontSize: glyph.fontSize,
        firstCharacter: glyph.firstCharacter,
        advance: glyph.advance
      }
    })
    // Outlines from some runs only would draw the text with characters missing.
    const outlined = glyphs.every((glyph) => glyph.commands)
    return {
      glyphs: outlined ? glyphs : glyphs.map((glyph) => ({ ...glyph, commands: null })),
      baselines: metrics.map((line) => ({
        firstCharacter: line.startIndex,
        endCharacter: Math.min(line.endIncludingNewline, text.length),
        position: { x: line.left, y: line.baseline + offsetY },
        width: line.width,
        lineY: line.baseline - line.ascent + offsetY,
        lineHeight: line.height,
        lineAscent: line.ascent
      })),
      logicalIndexToCharacterOffsetMap: completeCharacterOffsets(characterOffsets)
    }
  } finally {
    paragraph.delete()
  }
}

function decoratedGlyph(glyph: PlacedTextGlyph): DecoratedGlyph {
  const { commandsBlob, commands } = glyph
  return {
    ...glyph,
    ink: (top, bottom) => {
      if (commandsBlob) return savedGlyphInk(commandsBlob, glyph, top, bottom)
      return commands ? outlineInk(commands, glyph.x, glyph.y, top, bottom) : null
    }
  }
}

/** Decorations as Figma saves them, over glyphs saved or just shaped. */
function textDecorations(
  node: SceneNode,
  glyphs: readonly PlacedTextGlyph[]
): TextDecorationRecord[] {
  return textDecorationRects(node, glyphs.map(decoratedGlyph)).map(
    ({ firstCharacter, x, y, width, height }) => ({ firstCharacter, x, y, width, height })
  )
}

function needsShaping(graph: SceneGraph): boolean {
  for (const node of graph.nodes.values()) {
    if (node.type === 'TEXT' && node.text && !node.derivedTextGlyphs?.length) return true
  }
  return false
}

/**
 * Run a `.fig` or Figma clipboard write with text shaping. Unless the attached font provider
 * belongs to this CanvasKit, the loaded fonts are registered in one that lives for this write only.
 */
export async function withFigExportRuntime<T>(
  graph: SceneGraph,
  ck: CanvasKit | undefined,
  write: (runtime: FigNodeChangeExportRuntime) => Promise<T>
): Promise<T> {
  if (!needsShaping(graph)) return write({ ...EMPTY_EXPORT_RUNTIME, textDecorations })
  const canvasKit = ck ?? (await getCanvasKit())
  const reusable = fontManager.providerFor(canvasKit)
  const provider = reusable ?? canvasKit.TypefaceFontProvider.Make()
  if (!reusable) fontManager.attachProvider(canvasKit, provider)
  try {
    return await write({
      shapeText: (node) => shapeText(canvasKit, provider, node),
      textDecorations
    })
  } finally {
    if (!reusable) {
      fontManager.detachProvider(provider)
      provider.delete()
    }
  }
}
