import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

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

describe('instance override cache invalidation (KC-008)', () => {
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
