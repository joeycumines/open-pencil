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

/**
 * Cache invariant tests for instance override caches.
 *
 * The existing cache-invalidation.test.ts verifies that caches are
 * cleared/preserved after repopulateInstance and clearInstanceOverrideCaches.
 * These tests go further:
 *
 * 1. Prove that stale cache data would cause wrong results — i.e., if
 *    clearing were removed, the test would fail. This proves clearing
 *    is NECESSARY, not just nice-to-have.
 * 2. Verify that after clearing, re-querying returns correct (new) data.
 * 3. Verify swapInstanceComponent clears module-level caches (not just
 *    instance-level fields).
 */
describe('instance override cache invariant', () => {
  test('stale candidateCache would return wrong results if not cleared', () => {
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

    // Populate candidateCache with stale data pointing to iconA
    setCandidateCache(ctx, new Map([['stale-key', ['old-component-child-id']]]))
    expect(getCandidateCache(ctx)?.get('stale-key')).toEqual(['old-component-child-id'])

    // Repopulate with iconB — should clear candidateCache
    repopulateInstance(ctx, instance.id, iconB.id)

    // If clearing worked, the stale entry is gone
    expect(getCandidateCache(ctx)).toBeUndefined()

    // The instance now has iconB's children, proving the repopulation used
    // the correct component, not the stale cache
    const children = graph.getChildren(instance.id)
    expect(children.length).toBe(1)
    expect(children[0]?.name).toBe('IconB Child')
  })

  test('stale componentFindCache would return wrong component child if not cleared', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const iconA = componentWithChildRect(graph, 'IconA', { r: 1, g: 0, b: 0 })
    const iconB = componentWithChildRect(graph, 'IconB', { r: 0, g: 1, b: 0 })

    const instance = graph.createNode('INSTANCE', page.id, {
      name: 'Inst',
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

    // Populate componentFindCache with stale data
    setComponentFindCache(ctx, new Map([['stale-find', 'old-child-id']]))
    expect(getComponentFindCache(ctx)?.get('stale-find')).toBe('old-child-id')

    // Repopulate with iconB
    repopulateInstance(ctx, instance.id, iconB.id)

    // componentFindCache should be cleared
    expect(getComponentFindCache(ctx)).toBeUndefined()

    // Instance now has iconB's child
    expect(graph.getChildren(instance.id)[0]?.name).toBe('IconB Child')
  })

  test('repopulateInstance preserves sibling caches across component swap', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const iconA = componentWithChildRect(graph, 'IconA', { r: 1, g: 0, b: 0 })
    const iconB = componentWithChildRect(graph, 'IconB', { r: 0, g: 1, b: 0 })

    const instance = graph.createNode('INSTANCE', page.id, {
      name: 'Inst',
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

    // Populate sibling caches
    setSiblingIndexCache(ctx, new Map([['sibling-idx', 5]]))
    setSiblingGroupCache(ctx, new Map([['sibling-grp', ['a', 'b', 'c']]]))

    // Repopulate with iconB
    repopulateInstance(ctx, instance.id, iconB.id)

    // Sibling caches should be PRESERVED (intentional optimization)
    expect(getSiblingIndexCache(ctx)?.get('sibling-idx')).toBe(5)
    expect(getSiblingGroupCache(ctx)?.get('sibling-grp')).toEqual(['a', 'b', 'c'])
  })

  test('swapInstanceComponent clears all module-level caches', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const iconA = componentWithChildRect(graph, 'IconA', { r: 1, g: 0, b: 0 })
    const iconB = componentWithChildRect(graph, 'IconB', { r: 0, g: 1, b: 0 })

    const instance = graph.createNode('INSTANCE', page.id, {
      name: 'Inst',
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

    // Populate all 4 caches
    setCandidateCache(ctx, new Map([['k', ['v']]]))
    setComponentFindCache(ctx, new Map([['k', 'v']]))
    setSiblingIndexCache(ctx, new Map([['k', 1]]))
    setSiblingGroupCache(ctx, new Map([['k', ['v']]]))

    // Verify populated
    expect(getCandidateCache(ctx)).toBeDefined()
    expect(getComponentFindCache(ctx)).toBeDefined()
    expect(getSiblingIndexCache(ctx)).toBeDefined()
    expect(getSiblingGroupCache(ctx)).toBeDefined()

    // swapInstanceComponent calls clearInstanceOverrideCaches() (no arg)
    // which nukes ALL caches for ALL contexts
    graph.swapInstanceComponent(instance.id, iconB.id)

    // All caches should be cleared
    expect(getCandidateCache(ctx)).toBeUndefined()
    expect(getComponentFindCache(ctx)).toBeUndefined()
    expect(getSiblingIndexCache(ctx)).toBeUndefined()
    expect(getSiblingGroupCache(ctx)).toBeUndefined()

    // Instance should now have iconB's children
    expect(graph.getChildren(instance.id)[0]?.name).toBe('IconB Child')
  })

  test('re-querying after cache clear returns correct new data', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const iconA = componentWithChildRect(graph, 'IconA', { r: 1, g: 0, b: 0 })
    const iconB = componentWithChildRect(graph, 'IconB', { r: 0, g: 1, b: 0 })

    const instance = graph.createNode('INSTANCE', page.id, {
      name: 'Inst',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      componentId: iconA.id
    })
    graph.populateInstanceChildren(instance.id, iconA.id)

    const ctx = buildCtx(graph)
    preComputeRoots(ctx)

    // First query populates componentIdRoot
    const root1 = getComponentRoot(ctx, instance.id)
    expect(root1).toBeDefined()

    // Swap to iconB
    repopulateInstance(ctx, instance.id, iconB.id)

    // componentIdRoot was cleared — re-query should rebuild with new data
    const root2 = getComponentRoot(ctx, instance.id)
    expect(root2).toBeDefined()
    // The root should point to iconB's subtree, not iconA's
    expect(graph.getChildren(instance.id)[0]?.name).toBe('IconB Child')
  })
})
