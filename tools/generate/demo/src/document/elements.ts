import { node, type DesignVariable, type TreeNode } from '@open-pencil/design-jsx'

export interface IconProps {
  /** An Iconify name the demo bundles, such as `lucide:play`. */
  name: `lucide:${string}`
  size: number
  /** The variable the icon's paths are bound to, so the icon follows the tour's modes. */
  color: DesignVariable
  label?: string
}

/** The variable each icon element binds its paths to, read when the icon is rendered. */
export const iconColors = new WeakMap<TreeNode, DesignVariable>()

/**
 * An icon layer, as `<Icon>` in a design JSX string renders one, drawn in the variable's
 * value and bound to it once rendered (`renderTree` in `./icons`).
 */
export function Icon({ color, ...props }: IconProps): TreeNode {
  const value = typeof color.value === 'string' ? color.value : '#000000'
  const tree = node('icon', { ...props, color: value })
  iconColors.set(tree, color)
  return tree
}
