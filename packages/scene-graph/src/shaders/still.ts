import type { Size } from '../primitives'

/**
 * How a shader paint's still frame is drawn and stored, for every renderer that draws one: the
 * editor's canvas and the tools that prebuild documents. The frame is an image fill in `.fig`
 * files, so Figma must be able to read it, which rules out WebP.
 */

/** Frames are drawn at twice the layer's size, for sharp high-density displays. */
const FRAME_SCALE = 2
/** The longest side a frame is drawn at, however large the layer. */
const MAX_FRAME_EDGE = 2048
/** JPEG quality for opaque frames: no visible difference from PNG at a fraction of the size. */
const JPEG_QUALITY = 0.9

/** The pixels a frame for a layer of `size` is drawn at. */
export function shaderFramePixels(size: Size): Size {
  const scale = Math.min(FRAME_SCALE, MAX_FRAME_EDGE / Math.max(size.width, size.height, 1))
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))
  }
}

export interface ShaderFrameEncoding {
  type: 'image/jpeg' | 'image/png'
  /** For `canvas.toBlob` and `toDataURL`; PNG takes none. */
  quality?: number
}

/**
 * The encoding a frame with these RGBA pixels is stored in: JPEG when every pixel is opaque, which
 * is about 25 times smaller than PNG for a shader, and PNG when any pixel lets the layer behind
 * show through, which JPEG cannot keep.
 */
export function shaderFrameEncoding(rgba: ArrayLike<number>): ShaderFrameEncoding {
  for (let alpha = 3; alpha < rgba.length; alpha += 4) {
    if (rgba[alpha] !== 255) return { type: 'image/png' }
  }
  return { type: 'image/jpeg', quality: JPEG_QUALITY }
}
