import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import type { SceneNode } from '@open-pencil/core/scene-graph'

import {
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc,
  reconcileRemoteRoot
} from './helpers'

describe('collab property round-trip', () => {
  test('object/array node properties survive Yjs serialization (fills/effects/constraints)', () => {
    const hostDoc = new Y.Doc()
    const joinerDoc = new Y.Doc()
    const hostStore = createTestStore()
    const hostSync = createTestYjsSync(hostStore, hostDoc)
    makeHostRootState(hostStore)

    const page = hostStore.graph.getPages()[0]
    hostStore.graph.createNode('RECTANGLE', page.id, {
      name: 'Colored Rect',
      width: 100,
      height: 100,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ],
      effects: [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.25 },
          offset: { x: 0, y: 4 },
          radius: 4,
          spread: 0,
          visible: true
        }
      ],
      constraints: { horizontal: 'SCALE', vertical: 'SCALE' }
    })

    const joinerStore = createTestStore()
    const joinerSync = createTestYjsSync(joinerStore, joinerDoc)
    observeTargetDoc(joinerStore, joinerDoc, joinerSync.applyYjsToGraph, reconcileRemoteRoot)

    hostSync.syncAllNodesToYjs()

    encodeAndApply(hostDoc, joinerDoc)

    let child: ReturnType<typeof joinerStore.graph.getNode>
    for (const node of joinerStore.graph.getAllNodes()) {
      if (node.name === 'Colored Rect') {
        child = node
        break
      }
    }
    expect(child).toBeDefined()
    expect(child?.name).toBe('Colored Rect')

    expect(Array.isArray(child?.fills)).toBe(true)
    expect(child?.fills).toHaveLength(1)
    expect(child?.fills[0]?.type).toBe('SOLID')
    expect(child?.fills[0]?.color).toEqual({ r: 1, g: 0, b: 0, a: 1 })

    expect(Array.isArray(child?.effects)).toBe(true)
    expect(child?.effects[0]?.type).toBe('DROP_SHADOW')

    expect(child?.constraints).toEqual({ horizontal: 'SCALE', vertical: 'SCALE' })
  })

  test('primitive, text, and shape properties survive Yjs serialization', () => {
    const hostDoc = new Y.Doc()
    const joinerDoc = new Y.Doc()
    const hostStore = createTestStore()
    const hostSync = createTestYjsSync(hostStore, hostDoc)
    makeHostRootState(hostStore)

    const page = hostStore.graph.getPages()[0]
    hostStore.graph.createNode('TEXT', page.id, {
      name: 'Title',
      text: 'Hello {{world}}',
      fontSize: 42,
      fontFamily: 'Inter',
      fontWeight: 700,
      letterSpacing: -0.5,
      lineHeight: 48,
      textAlignHorizontal: 'CENTER'
    })

    hostStore.graph.createNode('RECTANGLE', page.id, {
      name: 'Rounded',
      width: 80,
      height: 80,
      cornerRadius: 12,
      topLeftRadius: 4,
      independentCorners: true,
      strokeCap: 'ROUND',
      dashPattern: [4, 2],
      strokes: [
        {
          type: 'SOLID',
          weight: 2,
          color: { r: 0, g: 0, b: 1, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ]
    })

    const joinerStore = createTestStore()
    const joinerSync = createTestYjsSync(joinerStore, joinerDoc)
    observeTargetDoc(joinerStore, joinerDoc, joinerSync.applyYjsToGraph, reconcileRemoteRoot)

    hostSync.syncAllNodesToYjs()
    encodeAndApply(hostDoc, joinerDoc)

    const byName = new Map<string, ReturnType<typeof joinerStore.graph.getNode>>()
    for (const node of joinerStore.graph.getAllNodes()) {
      if (node.name) byName.set(node.name, node)
    }

    const textNode = byName.get('Title')
    expect(textNode).toBeDefined()
    expect(textNode?.text).toBe('Hello {{world}}')
    expect(textNode?.fontSize).toBe(42)
    expect(textNode?.fontFamily).toBe('Inter')
    expect(textNode?.fontWeight).toBe(700)
    expect(textNode?.letterSpacing).toBe(-0.5)
    expect(textNode?.lineHeight).toBe(48)
    expect(textNode?.textAlignHorizontal).toBe('CENTER')

    const rectNode = byName.get('Rounded')
    expect(rectNode).toBeDefined()
    expect(rectNode?.cornerRadius).toBe(12)
    expect(rectNode?.topLeftRadius).toBe(4)
    expect(rectNode?.independentCorners).toBe(true)
    expect(rectNode?.strokeCap).toBe('ROUND')
    expect(rectNode?.dashPattern).toEqual([4, 2])
    expect(rectNode?.strokes).toHaveLength(1)
    expect(rectNode?.strokes[0]?.type).toBe('SOLID')
    expect(rectNode?.strokes[0]?.weight).toBe(2)
  })

  test('derived geometry blobs are not serialized over Yjs', () => {
    const hostDoc = new Y.Doc()
    const joinerDoc = new Y.Doc()
    const hostStore = createTestStore()
    const hostSync = createTestYjsSync(hostStore, hostDoc)
    makeHostRootState(hostStore)

    const page = hostStore.graph.getPages()[0]
    const cached = hostStore.graph.createNode('RECTANGLE', page.id, {
      name: 'Cached',
      width: 10,
      height: 10
    })
    const source = cached.source

    hostStore.graph.updateNode(cached.id, {
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array([1, 2, 3]) }]
    } as Partial<SceneNode>)

    const joinerStore = createTestStore()
    const joinerSync = createTestYjsSync(joinerStore, joinerDoc)
    observeTargetDoc(joinerStore, joinerDoc, joinerSync.applyYjsToGraph, reconcileRemoteRoot)

    hostSync.syncAllNodesToYjs()

    const ynode = hostSync.ynodes.get(source.id)
    expect(ynode).toBeDefined()
    expect(ynode?.has('fillGeometry')).toBe(false)
    expect(ynode?.has('strokeGeometry')).toBe(false)

    encodeAndApply(hostDoc, joinerDoc)

    let joinerCached: ReturnType<typeof joinerStore.graph.getNode>
    for (const node of joinerStore.graph.getAllNodes()) {
      if (node.name === 'Cached') {
        joinerCached = node
        break
      }
    }
    expect(joinerCached).toBeDefined()
    expect(joinerCached?.fillGeometry).toEqual([])
  })

  test('remote reparent updates child ids consistently', () => {
    const hostDoc = new Y.Doc()
    const joinerDoc = new Y.Doc()
    const hostStore = createTestStore()
    const hostSync = createTestYjsSync(hostStore, hostDoc)
    makeHostRootState(hostStore)

    const page = hostStore.graph.getPages()[0]
    const frame = hostStore.graph.createNode('FRAME', page.id, {
      name: 'Frame',
      width: 200,
      height: 200
    })
    const child = hostStore.graph.createNode('RECTANGLE', page.id, {
      name: 'Child',
      x: 0,
      y: 0,
      width: 20,
      height: 20
    })

    const joinerStore = createTestStore()
    const joinerSync = createTestYjsSync(joinerStore, joinerDoc)
    observeTargetDoc(joinerStore, joinerDoc, joinerSync.applyYjsToGraph, reconcileRemoteRoot)

    hostSync.syncAllNodesToYjs()
    encodeAndApply(hostDoc, joinerDoc)

    const initialPage = joinerStore.graph.getNode(page.id)
    expect(initialPage?.childIds).toContain(joinerStore.graph.getNode(child.id)?.id)

    hostStore.graph.reparentNode(child.id, frame.id)
    hostSync.syncNodeToYjs(child.id)
    encodeAndApply(hostDoc, joinerDoc)

    const joinerChild = joinerStore.graph.getNode(child.id)
    const joinerFrame = joinerStore.graph.getNode(frame.id)
    expect(joinerChild?.parentId).toBe(joinerFrame?.id)
    expect(joinerFrame?.childIds).toContain(joinerChild?.id)
    const joinerPage = joinerStore.graph.getNode(page.id)
    expect(joinerPage?.childIds).not.toContain(joinerChild?.id)
  })
})
