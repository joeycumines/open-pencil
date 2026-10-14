import type { Fill } from '@open-pencil/scene-graph'
import { colorToFill } from '@open-pencil/scene-graph/color'
import type { Color } from '@open-pencil/scene-graph/primitives'

export function isColor(value: unknown): value is Color {
  return (
    value !== null &&
    typeof value === 'object' &&
    'r' in value &&
    'g' in value &&
    'b' in value &&
    'a' in value
  )
}

function isFill(value: unknown): value is Fill {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'color' in value &&
    'visible' in value
  )
}

/** A paint as props write it: a colour string, a colour, or a paint from a helper. */
export function isFillValue(value: unknown): value is string | Color | Fill {
  return typeof value === 'string' || isColor(value) || isFill(value)
}

export function fillFromValue(value: string | Color | Fill): Fill {
  return isFill(value) ? structuredClone(value) : colorToFill(value)
}
