import type { Effect, SceneNode } from '@open-pencil/scene-graph'

import { parseColor } from '#core/color'
import { TRANSPARENT } from '#core/constants'

function isEffect(value: unknown): value is Effect {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'radius' in value &&
    'visible' in value
  )
}

export function applyShapeAndEffectOverrides(
  props: Record<string, unknown>,
  o: Partial<SceneNode>
): void {
  if (Array.isArray(props.effects)) {
    const effects = props.effects.filter(isEffect).map((effect) => structuredClone(effect))
    if (effects.length > 0) o.effects = effects
  }

  if (props.points !== undefined) o.pointCount = props.points as number
  if (props.innerRadius !== undefined) o.starInnerRadius = props.innerRadius as number
  if (props.pointCount !== undefined) o.pointCount = props.pointCount as number

  if (typeof props.shadow === 'string') {
    const parts = props.shadow.split(/\s+/)
    if (parts.length >= 4) {
      const c = parseColor(parts.slice(3).join(' '))
      o.effects = [
        ...(o.effects ?? []),
        {
          type: 'DROP_SHADOW',
          color: c,
          offset: { x: Number.parseFloat(parts[0]), y: Number.parseFloat(parts[1]) },
          radius: Number.parseFloat(parts[2]),
          spread: 0,
          visible: true
        }
      ]
    }
  }

  if (typeof props.blur === 'number') {
    o.effects = [
      ...(o.effects ?? []),
      {
        type: 'LAYER_BLUR',
        radius: props.blur,
        visible: true,
        color: { ...TRANSPARENT },
        offset: { x: 0, y: 0 },
        spread: 0
      }
    ]
  }
}
