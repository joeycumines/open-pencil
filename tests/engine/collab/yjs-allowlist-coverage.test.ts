import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

import { EXCLUDED_SYNC_KEYS, YJS_NODE_PROPERTY_KEYS } from '@/app/collab/yjs-sync'

describe('Yjs node property allowlist coverage', () => {
  test('every serialisable SceneNode field is allow-listed for sync', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Rect'
    })

    const nodeKeys = Object.keys(rect)
    const missing: string[] = []
    for (const key of nodeKeys) {
      if (key === 'source') continue
      if (EXCLUDED_SYNC_KEYS.has(key)) continue
      if (!YJS_NODE_PROPERTY_KEYS.has(key)) {
        missing.push(key)
      }
    }

    expect(missing).toEqual([])
  })
})
