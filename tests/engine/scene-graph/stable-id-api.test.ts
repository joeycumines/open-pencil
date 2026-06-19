import { describe, test, expect } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

import { firstPageId } from '#tests/helpers/scene'

describe('GraphSyncState API', () => {
  test('getSyncState lazily creates state', () => {
    const graph = new SceneGraph()
    const state = graph.getSyncState()

    expect(state).toBeDefined()
    expect(state.rootMapped).toBe(false)
    expect(state.remoteRootStableId).toBeNull()
    expect(state.remoteToLocal.size).toBe(0)
    expect(state.localToRemote.size).toBe(0)
    expect(state.pendingParents.size).toBe(0)
    expect(state.pendingComponents.size).toBe(0)
    expect(state.pendingOverrideKeys.size).toBe(0)
    expect(state.pendingUntilRoot.size).toBe(0)

    expect(graph.getSyncState()).toBe(state)
  })

  test('resetSyncState clears all maps and flags', () => {
    const graph = new SceneGraph()
    const state = graph.getSyncState()
    state.remoteToLocal.set('a', 'b')
    state.localToRemote.set('b', 'a')
    state.pendingParents.set('p', new Set(['c']))
    state.pendingComponents.set('c', new Set(['i']))
    state.pendingOverrideKeys.set('k', new Set([{ remoteStableId: 'r', prop: 'x', value: 1 }]))
    state.pendingUntilRoot.add('z')
    state.rootMapped = true
    state.remoteRootStableId = 'root'

    graph.resetSyncState()

    expect(state.remoteToLocal.size).toBe(0)
    expect(state.localToRemote.size).toBe(0)
    expect(state.pendingParents.size).toBe(0)
    expect(state.pendingComponents.size).toBe(0)
    expect(state.pendingOverrideKeys.size).toBe(0)
    expect(state.pendingUntilRoot.size).toBe(0)
    expect(state.rootMapped).toBe(false)
    expect(state.remoteRootStableId).toBeNull()
  })

  test('getStableId returns source id when present', () => {
    const graph = new SceneGraph()
    const page = firstPageId(graph)
    const node = graph.createNode('RECTANGLE', page, { name: 'Box' })

    expect(graph.getStableId(node)).toBe(node.source.id)
    expect(node.source.id).toBeTruthy()
  })

  test('stableIdToRuntimeId returns runtime id for a matching source id', () => {
    const graph = new SceneGraph()
    const page = firstPageId(graph)
    const node = graph.createNode('RECTANGLE', page, { name: 'Box' })
    const stableId = node.source.id

    expect(stableId).toBeTruthy()
    expect(graph.stableIdToRuntimeId(stableId)).toBe(node.id)
    expect(graph.stableIdToRuntimeId('missing-stable')).toBeUndefined()
  })
})
