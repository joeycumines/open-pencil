import * as v from 'valibot'

import type { Fill, SceneNode } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { TEXT_DECORATION_STYLE } from '../enums'
import { parseScriptInput } from '../validation'
import { fillFromValue, isFillValue } from './fills'

/** Lengths that follow the font unless set take `'auto'`, as in CSS. */
export const AUTO = 'auto'
/** The decoration colour that follows the text's, as in CSS. */
export const CURRENT_COLOR = 'currentColor'

const Length = v.pipe(v.number(), v.finite())
const AutoLength = v.union([Length, v.literal(AUTO)])

const TextProps = v.object({
  // Read by TEXT_DECORATION_STYLE, so an unknown style warns rather than failing the render.
  textDecorationStyle: v.optional(v.string()),
  textDecorationColor: v.optional(
    v.custom<string | Color | Fill>(isFillValue, 'Expected a colour or a paint')
  ),
  textDecorationThickness: v.optional(AutoLength),
  textUnderlineOffset: v.optional(AutoLength),
  textDecorationSkipInk: v.optional(v.boolean()),
  paragraphSpacing: v.optional(Length),
  listSpacing: v.optional(Length),
  paragraphIndent: v.optional(Length),
  hangingList: v.optional(v.boolean())
})

function autoLength(value: number | typeof AUTO): number | null {
  return value === AUTO ? null : value
}

/** The decoration details and text-wide paragraph spacing a `<Text>` or `<Span>` sets. */
export function applyTextDetailOverrides(
  props: Record<string, unknown>,
  o: Partial<SceneNode>
): void {
  const parsed = parseScriptInput('Invalid <Text> props', TextProps, props)
  const color = parsed.textDecorationColor
  const style = TEXT_DECORATION_STYLE.parse(parsed.textDecorationStyle)
  if (style) o.textDecorationStyle = style
  if (color !== undefined) {
    o.textDecorationFills =
      typeof color === 'string' && color.toLowerCase() === CURRENT_COLOR.toLowerCase()
        ? []
        : [fillFromValue(color)]
  }
  if (parsed.textDecorationThickness !== undefined)
    o.textDecorationThickness = autoLength(parsed.textDecorationThickness)
  if (parsed.textUnderlineOffset !== undefined)
    o.textUnderlineOffset = autoLength(parsed.textUnderlineOffset)
  if (parsed.textDecorationSkipInk !== undefined)
    o.textDecorationSkipInk = parsed.textDecorationSkipInk
  if (parsed.paragraphSpacing !== undefined) o.paragraphSpacing = parsed.paragraphSpacing
  if (parsed.listSpacing !== undefined) o.listSpacing = parsed.listSpacing
  if (parsed.paragraphIndent !== undefined) o.paragraphIndent = parsed.paragraphIndent
  if (parsed.hangingList !== undefined) o.hangingList = parsed.hangingList
}
