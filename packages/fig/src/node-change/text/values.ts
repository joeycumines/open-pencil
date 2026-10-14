import type { TextDecoration } from '@open-pencil/scene-graph'

export function mapTextDecoration(d?: string): TextDecoration {
  switch (d) {
    case 'UNDERLINE':
      return 'UNDERLINE'
    case 'STRIKETHROUGH':
      return 'STRIKETHROUGH'
    default:
      return 'NONE'
  }
}

/** How Figma writes an auto line height; a percent the user set is a `RAW` multiplier. */
export const FIGMA_AUTO_LINE_HEIGHT = { value: 100, units: 'PERCENT' } as const

export function isFigmaAutoLineHeight(lh?: { value: number; units: string }): boolean {
  return lh?.units === FIGMA_AUTO_LINE_HEIGHT.units && lh.value === FIGMA_AUTO_LINE_HEIGHT.value
}

export function convertLineHeight(
  lh?: { value: number; units: string },
  fontSize?: number
): number | null {
  if (!lh || isFigmaAutoLineHeight(lh)) return null
  if (lh.units === 'PIXELS') return lh.value
  if (lh.units === 'PERCENT') return (lh.value / 100) * (fontSize ?? 14)
  if (lh.units === 'RAW') return lh.value * (fontSize ?? 14)
  return null
}

export function convertLetterSpacing(
  ls?: { value: number; units: string },
  fontSize?: number
): number {
  if (!ls) return 0
  if (ls.units === 'PIXELS') return ls.value
  if (ls.units === 'PERCENT') return (ls.value / 100) * (fontSize ?? 14)
  return ls.value
}
