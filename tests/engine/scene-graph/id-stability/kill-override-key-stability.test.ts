import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

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
 * When a component child is fig-imported (source.id !== node.id), the
 * instance child cloned from it also has source.id !== node.id. The
 * syncChildren function constructs override keys as `${instChild.id}:${key}`
 * (runtime ID), but the correct format should use `${instChild.source.id}:${key}`
 * (stable ID). After a graph rebuild that changes runtime IDs, override keys
 * with old runtime IDs become stale and overrides are silently lost.
 *
 * This test sets an override using the STABLE ID and verifies that
 * syncChildren fails to find it (because it constructs keys using the
 * runtime ID).
 *
 * How it fails: syncChildren constructs `${instChild.id}:visible` (runtime ID)
 * but the override was set as `${instChild.source.id}:visible` (stable ID).
 * These are different strings for fig-imported nodes, so the override is
 * not found and the component's property overwrites the user's override.
 *
 * Fix that makes it pass: syncChildren uses `graph.identity.getStableId(instChild)`
 * instead of `instChild.id` when constructing override keys.
 */
describe('C-01: Override keys use runtime IDs instead of stable IDs', () => {
  test('override set with stable ID is lost because syncChildren uses runtime ID', () => {
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

    // Set override using STABLE ID (the correct format after the fix)
    // 'fills' IS in INSTANCE_SYNC_PROPS, so syncChildren will check this key
    const stableOverrideKey = `${instChild.source.id}:fills`
    instance.overrides[stableOverrideKey] = blueFill

    // Run syncInstances — syncChildren constructs override keys using
    // instChild.id (runtime ID), which doesn't match the stable-ID key
    graph.syncInstances(component.id)

    // The instance child's fills should be blue (from override),
    // but syncChildren copied red from the component because the override
    // key didn't match (runtime ID vs stable ID)
    const refreshedInstChild = graph.getChildren(instance.id)[0]
    expect(refreshedInstChild.fills).toEqual(blueFill) // FAILS: fills is redFill
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

    // Set override using RUNTIME ID (current behavior)
    instance.overrides[`${oldRuntimeId}:fills`] = blueFill

    // Verify override works before runtime ID change
    graph.syncInstances(component.id)
    expect(graph.getChildren(instance.id)[0].fills).toEqual(blueFill)

    // Simulate runtime ID change: delete instance child and recreate
    // with same stable ID but different runtime ID
    graph.deleteNode(instChild.id, { permanent: false })

    // Recreate the instance child with restore mode (same stable ID)
    graph.createNode(
      'RECTANGLE',
      instance.id,
      {
        name: 'Child',
        width: 100,
        height: 100,
        fills: redFill,
        componentId: component.childIds[0],
        source: figSource(stableId)
      },
      { mode: 'restore' }
    )

    const newInstChild = graph.getChildren(instance.id)[0]
    expect(newInstChild.source.id).toBe(stableId)
    expect(newInstChild.id).not.toBe(oldRuntimeId) // runtime ID changed

    // Run syncInstances — constructs key using NEW runtime ID
    // Override key has OLD runtime ID → doesn't match → override lost
    graph.syncInstances(component.id)

    // Override should be preserved (fills = blueFill), but it's lost
    expect(graph.getChildren(instance.id)[0].fills).toEqual(blueFill) // FAILS: fills is redFill
  })
})
