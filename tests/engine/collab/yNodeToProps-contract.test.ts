import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { yNodeToProps } from '@/app/collab/yjs-sync'

function makeYnode(): Y.Map<unknown> {
  return new Y.Doc().getMap<unknown>('test')
}

describe('yNodeToProps contract', () => {
  test('only allow-listed keys are returned', () => {
    const ynode = makeYnode()
    ynode.set('name', 'Hero')
    ynode.set('unknownKey', 'should be ignored')
    ynode.set('x', 12)
    ynode.set('sneakyId', '0:99')

    const props = yNodeToProps(ynode)

    expect(props.name).toBe('Hero')
    expect(props.x).toBe(12)
    expect(props.unknownKey).toBeUndefined()
    expect(props.sneakyId).toBeUndefined()
  })

  test('id and parentId pass through when allow-listed', () => {
    const ynode = makeYnode()
    ynode.set('id', 'stable:1')
    ynode.set('parentId', 'stable:0')
    ynode.set('componentId', 'stable:2')

    const props = yNodeToProps(ynode)

    expect(props.id).toBe('stable:1')
    expect(props.parentId).toBe('stable:0')
    expect(props.componentId).toBe('stable:2')
  })
})
