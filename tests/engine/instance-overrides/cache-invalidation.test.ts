import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

import {
  getCandidateCache,
  getComponentFindCache,
  getSiblingGroupCache,
  getSiblingIndexCache,
  setCandidateCache,
  setComponentFindCache,
  setSiblingGroupCache,
  setSiblingIndexCache
} from '#core/kiwi/fig/instance-overrides/cache'
import {
  clearInstanceOverrideCaches,
  getComponentRoot,
  preComputeRoots,
  repopulateInstance
} from '#core/kiwi/fig/instance-overrides/resolve'
import type { OverrideContext } from '#core/kiwi/fig/instance-overrides/types'

function buildCtx(graph: SceneGraph): OverrideContext {
  return {
    graph,
    changeMap: new Map(),
    guidToNodeId: new Map(),
    blobs: [],
    overrideKeyToGuid: new Map(),
    nodeIdToGuid: new Map(),
    propDefaults: new Map(),
    propNames: new Map(),
    preComputedRoot: new Map(),
    componentIdRoot: new Map(),
    swappedInstances: new Set(),
    protectedFields: new Map(),
    kiwiPropertyNodes: new Set(),
    geometryOverrideNodes: new Set()
  }
}

function componentWithChildRect(
  graph: SceneGraph,
  componentName: string,
  fill: { r: number; g: number; b: number }
) {
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id, {
    name: componentName,
    x: 0,
    y: 0,
    width: 100,
    height: 100
  })
  graph.createNode('RECTANGLE', component.id, {
    name: `${componentName} Child`,
    width: 100,
    height: 100,
    fills: [
      { type: 'SOLID', color: { ...fill, a: 1 }, opacity: 1, visible: true, blendMode: 'NORMAL' }
    ]
  })
  return component
}

describe('instance override cache invalidation (KC-008)', () => {
  test('repopulateInstance clears componentIdRoot and caches (KC-008)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const iconA = componentWithChildRect(graph, 'IconA', { r: 1, g: 0, b: 0 })
    const iconB = componentWithChildRect(graph, 'IconB', { r: 0, g: 1, b: 0 })

    const instance = graph.createNode('INSTANCE', page.id, {
      name: 'IconA',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      componentId: iconA.id
    })
    graph.populateInstanceChildren(instance.id, iconA.id)

    const ctx = buildCtx(graph)
    expect(ctx.componentIdRoot.size).toBe(0)

    preComputeRoots(ctx)
    getComponentRoot(ctx, instance.id)
    expect(ctx.componentIdRoot.size).toBeGreaterThan(0)
    expect(graph.getChildren(instance.id).length).toBe(1)
    expect(graph.getChildren(instance.id)[0]?.name).toBe('IconA Child')

    repopulateInstance(ctx, instance.id, iconB.id)

    expect(ctx.componentIdRoot.size).toBe(0)
    expect(graph.getChildren(instance.id).length).toBe(1)
    expect(graph.getChildren(instance.id)[0]?.name).toBe('IconB Child')
  })

  test('swapInstanceComponent refreshes children deterministically (KC-008)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const iconA = componentWithChildRect(graph, 'IconA', { r: 1, g: 0, b: 0 })
    const iconB = componentWithChildRect(graph, 'IconB', { r: 0, g: 1, b: 0 })

    const instance = graph.createNode('INSTANCE', page.id, {
      name: 'IconA',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      componentId: iconA.id
    })
    graph.populateInstanceChildren(instance.id, iconA.id)

    expect(graph.getChildren(instance.id).length).toBe(1)
    expect(graph.getChildren(instance.id)[0]?.name).toBe('IconA Child')

    graph.swapInstanceComponent(instance.id, iconB.id)

    expect(instance.componentId).toBe(iconB.id)
    expect(graph.getChildren(instance.id).length).toBe(1)
    expect(graph.getChildren(instance.id)[0]?.name).toBe('IconB Child')
  })

  test('clearInstanceOverrideCaches with no argument resets module-level caches without throwing', () => {
    const graph = new SceneGraph()
    const ctx = buildCtx(graph)
    preComputeRoots(ctx)
    expect(ctx.componentIdRoot.size).toBe(0)

    expect(() => clearInstanceOverrideCaches()).not.toThrow()
  })
})

describe('module-level WeakMap cache invalidation (H-14)', () => {
  test('repopulateInstance clears lookup caches but preserves sibling caches', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const iconA = componentWithChildRect(graph, 'IconA', { r: 1, g: 0, b: 0 })
    const iconB = componentWithChildRect(graph, 'IconB', { r: 0, g: 1, b: 0 })

    const instance = graph.createNode('INSTANCE', page.id, {
      name: 'IconA',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      componentId: iconA.id
    })
    graph.populateInstanceChildren(instance.id, iconA.id)

    const ctx = buildCtx(graph)
    preComputeRoots(ctx)
    getComponentRoot(ctx, instance.id)

    // Populate all 4 module-level caches with test data
    setCandidateCache(ctx, new Map([['test-key', ['val1', 'val2']]]))
    setComponentFindCache(ctx, new Map([['find-key', 'result-id']]))
    setSiblingIndexCache(ctx, new Map([['idx-key', 42]]))
    setSiblingGroupCache(ctx, new Map([['grp-key', ['a', 'b']]]))

    // Verify all caches are populated
    expect(getCandidateCache(ctx)).toBeDefined()
    expect(getComponentFindCache(ctx)).toBeDefined()
    expect(getSiblingIndexCache(ctx)).toBeDefined()
    expect(getSiblingGroupCache(ctx)).toBeDefined()

    // Call repopulateInstance — should clear lookup caches but preserve sibling caches
    repopulateInstance(ctx, instance.id, iconB.id)

    // Lookup caches should be cleared (candidateCache and componentFindCache)
    expect(getCandidateCache(ctx)).toBeUndefined()
    expect(getComponentFindCache(ctx)).toBeUndefined()

    // Sibling caches should be PRESERVED (the optimization claim)
    expect(getSiblingIndexCache(ctx)).toBeDefined()
    expect(getSiblingIndexCache(ctx)?.get('idx-key')).toBe(42)
    expect(getSiblingGroupCache(ctx)).toBeDefined()
    expect(getSiblingGroupCache(ctx)?.get('grp-key')).toEqual(['a', 'b'])
  })

  test('clearInstanceOverrideCaches(ctx) clears all 4 caches for the ctx', () => {
    const graph = new SceneGraph()
    const ctx = buildCtx(graph)

    // Populate all caches
    setCandidateCache(ctx, new Map([['k', ['v']]]))
    setComponentFindCache(ctx, new Map([['k', 'v']]))
    setSiblingIndexCache(ctx, new Map([['k', 1]]))
    setSiblingGroupCache(ctx, new Map([['k', ['v']]]))

    expect(getCandidateCache(ctx)).toBeDefined()
    expect(getComponentFindCache(ctx)).toBeDefined()
    expect(getSiblingIndexCache(ctx)).toBeDefined()
    expect(getSiblingGroupCache(ctx)).toBeDefined()

    clearInstanceOverrideCaches(ctx)

    expect(getCandidateCache(ctx)).toBeUndefined()
    expect(getComponentFindCache(ctx)).toBeUndefined()
    expect(getSiblingIndexCache(ctx)).toBeUndefined()
    expect(getSiblingGroupCache(ctx)).toBeUndefined()
  })
})
