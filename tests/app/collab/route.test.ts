import { describe, expect, test } from 'bun:test'

import { roomPathFor } from '@/app/collab/route'

const roomId = 'abcdefghijklmnopqrstuvwxyz012345'

describe('room address', () => {
  test('shows a shared room as its share link', () => {
    expect(roomPathFor(roomId, '/')).toBe(`/share/${roomId}`)
  })

  test('keeps a Cloud document room out of the address', () => {
    expect(roomPathFor('cloud:1413785f-37aa-4935-8bfb-e2cd81a035cf:0', '/')).toBe('/')
    expect(roomPathFor('cloud:1413785f-37aa-4935-8bfb-e2cd81a035cf:0', `/share/${roomId}`)).toBe(
      '/'
    )
  })

  test('leaves a share link for the home address when no room is active', () => {
    expect(roomPathFor(null, `/share/${roomId}`)).toBe('/')
    expect(roomPathFor(null, '/demo')).toBe('/demo')
  })
})
