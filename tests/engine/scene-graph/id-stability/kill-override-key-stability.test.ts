import { describe, expect, test } from 'bun:test'

import { migrateOverrideKeys, SceneGraph } from '@open-pencil/core'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

function figSource(id: string) {
  return {
    format: 'fig' as const,
    id,
    orderKey: null,
    fig: {
      rawSize: null,
      rawTransform: null,
      rawNodeFields: {},
      layout: null,
      symbolOverrides: [],
      componentPropAssignments: [],
      derivedSymbolData: [],
      derivedSymbolDataLayoutVersion: null,
      uniformScaleFactor: null
    }
  }
}

/**
 * C-01: Override keys use runtime IDs, not stable IDs.
 *
 * syncChildren constructs override keys as `${instChild.id}:${key}` (runtime ID).
 * When a component child is fig-imported (source.id !== node.id), the instance
 * child's runtime ID differs from its stable ID. An override set with the
 * STABLE ID won't be found by syncChildren (which looks up with runtime ID),
 * causing the component's property to overwrite the user's override.
 *
 * How it fails: syncChildren constructs `${instChild.id}:fills` (runtime ID)
 * but the override was set as `${instChild.source.id}:fills` (stable ID).
 * These are different strings for fig-imported nodes, so the override is
 * not found and copyProp overwrites the child's property.
 *
 * Fix that makes it pass: syncChildren uses graph.identity.getStableId(instChild)
 * instead of instChild.id when constructing override keys.
 */
describe('C-01: Override keys use runtime IDs instead of stable IDs', () => {
  test('override set with stable ID prevents syncChildren from overwriting', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const redFill = [
      {
        type: 'SOLID' as const,
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        blendMode: 'NORMAL' as const
      }
    ]
    const blueFill = [
      {
        type: 'SOLID' as const,
        color: { r: 0, g: 0, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        blendMode: 'NORMAL' as const
      }
    ]

    // Create component with fig-imported child (source.id = '0:50')
    const component = graph.createNode('COMPONENT', page, { name: 'Comp' })
    graph.createNode('RECTANGLE', component.id, {
      name: 'Child',
      width: 100,
      height: 100,
      fills: redFill,
      source: figSource('0:50')
    })

    // Create instance — instance child is cloned from component child
    const instance = graph.createInstance(component.id, page)
    expect(instance).not.toBeNull()
    if (!instance) return

    const instChildren = graph.getChildren(instance.id)
    expect(instChildren.length).toBe(1)
    const instChild = instChildren[0]

    // For fig-imported nodes, source.id !== node.id (runtime ID differs from stable ID)
    expect(instChild.source.id).toBe('0:50')
    expect(instChild.id).not.toBe('0:50')

    // Simulate user override: change the child's fills to blue
    graph.updateNode(instChild.id, { fills: blueFill })
    expect(graph.getNode(instChild.id)!.fills).toEqual(blueFill)

    // Set override using STABLE ID (the correct format after the fix)
    // This tells syncChildren "don't overwrite fills from component"
    const stableOverrideKey = `${instChild.source.id}:fills`
    instance.overrides[stableOverrideKey] = blueFill

    // Run syncInstances — syncChildren should find the override key
    // and NOT overwrite the child's fills with the component's red fills
    graph.syncInstances(component.id)

    // The child's fills should still be blue (override preserved)
    // FAILS on old code: syncChildren constructs key with runtime ID,
    // doesn't find the stable-ID override, copies red from component
    const refreshedInstChild = graph.getChildren(instance.id)[0]
    expect(refreshedInstChild.fills).toEqual(blueFill)
  })

  test('override set with runtime ID is lost after simulated runtime ID change', () => {
    const graph = new SceneGraph()
    const page = pageId(graph)

    const redFill = [
      {
        type: 'SOLID' as const,
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        blendMode: 'NORMAL' as const
      }
    ]
    const blueFill = [
      {
        type: 'SOLID' as const,
        color: { r: 0, g: 0, b: 1, a: 1 },
        opacity: 1,
        visible: true,
        blendMode: 'NORMAL' as const
      }
    ]

    // Create component with fig-imported child
    const component = graph.createNode('COMPONENT', page, { name: 'Comp' })
    graph.createNode('RECTANGLE', component.id, {
      name: 'Child',
      width: 100,
      height: 100,
      fills: redFill,
      source: figSource('0:60')
    })

    // Create instance
    const instance = graph.createInstance(component.id, page)
    expect(instance).not.toBeNull()
    if (!instance) return

    const instChild = graph.getChildren(instance.id)[0]
    const oldRuntimeId = instChild.id
    const stableId = instChild.source.id!

    // Simulate user override: change child's fills to blue
    graph.updateNode(instChild.id, { fills: blueFill })

    // Set override using RUNTIME ID (current/old behavior)
    instance.overrides[`${oldRuntimeId}:fills`] = blueFill

    // Migrate override keys from runtime-ID format to stable-ID format
    // (as replaceGraph does in production — before any sync)
    migrateOverrideKeys(graph)

    // Verify override works after migration (before runtime ID change)
    graph.syncInstances(component.id)
    expect(graph.getChildren(instance.id)[0].fills).toEqual(blueFill)

    // Simulate runtime ID change: delete instance child and recreate
    // with same stable ID but different runtime ID
    graph.deleteNode(instChild.id, { permanent: false })

    graph.createNode(
      'RECTANGLE',
      instance.id,
      {
        name: 'Child',
        width: 100,
        height: 100,
        fills: blueFill,
        componentId: component.childIds[0],
        source: figSource(stableId)
      },
      { mode: 'restore' }
    )

    const newInstChild = graph.getChildren(instance.id)[0]
    expect(newInstChild.source.id).toBe(stableId)
    expect(newInstChild.id).not.toBe(oldRuntimeId) // runtime ID changed

    // Run syncInstances — constructs key using stable ID (with fix)
    // The migrated override key matches → override preserved
    graph.syncInstances(component.id)

    // Override should be preserved (fills = blueFill)
    expect(graph.getChildren(instance.id)[0].fills).toEqual(blueFill)
  })
})
