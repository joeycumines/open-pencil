import { describe, expect, test } from 'bun:test'

import { computeImageHash, imageMimeType } from '@open-pencil/scene-graph'

describe('computeImageHash', () => {
  test('names bytes by their SHA-1, as Figma names images', () => {
    expect(computeImageHash(new TextEncoder().encode('abc'))).toBe(
      'a9993e364706816aba3e25717850c26c9cd0d89d'
    )
    expect(computeImageHash(new Uint8Array())).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
  })
})

describe('imageMimeType', () => {
  test('reads the type from the bytes', () => {
    expect(imageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png'
    )
    expect(imageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(imageMimeType(new TextEncoder().encode('GIF89a'))).toBe('image/gif')
    expect(imageMimeType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
  })

  test('reports bytes with no known signature as PNG', () => {
    expect(imageMimeType(new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt '))).toBe('image/png')
    expect(imageMimeType(new Uint8Array())).toBe('image/png')
  })
})
