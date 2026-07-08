import { buildOpenPencilClipboardHTML } from '@open-pencil/core/clipboard'
import type { Editor } from '@open-pencil/core/editor'
import { createDefaultSource, type SceneNode } from '@open-pencil/scene-graph'

import { expectDefined, getNodeOrThrow } from './assert'

export const RESTORE_COMPONENT_NAME = 'Restore Button Component'
export const RESTORE_COMPONENT_CHILD_NAME = 'Restore Button Background'
export const RESTORE_INSTANCE_NAME = 'Restore Button Instance'

export interface ComponentInstanceBundle {
  component: SceneNode
  componentChild: SceneNode
  instance: SceneNode
  instanceChild: SceneNode
}

export function createComponentInstanceBundle(
  editor: Editor,
  parentId: string
): ComponentInstanceBundle {
  const component = editor.graph.createNode('COMPONENT', parentId, {
    name: RESTORE_COMPONENT_NAME,
    width: 120,
    height: 40
  })
  const componentChild = editor.graph.createNode('RECTANGLE', component.id, {
    name: RESTORE_COMPONENT_CHILD_NAME,
    width: 120,
    height: 40,
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  const instance = expectDefined(
    editor.graph.createInstance(component.id, parentId, { name: RESTORE_INSTANCE_NAME }),
    'component instance'
  )
  const instanceChild = getNodeOrThrow(
    editor.graph,
    expectDefined(instance.childIds[0], 'instance child id')
  )
  editor.graph.updateNode(instance.id, {
    overrides: {
      [`${instanceChild.id}:fills`]: [
        { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }
      ]
    }
  })

  return { component, componentChild, instance, instanceChild }
}

export function componentInstanceClipboardHtml(
  editor: Editor,
  bundle: ComponentInstanceBundle
): string {
  return buildOpenPencilClipboardHTML([bundle.component, bundle.instance], editor.graph)
}

export function createRuntimeIdOccupant(
  editor: Editor,
  parentId: string,
  id: string,
  name: string
): SceneNode {
  return editor.graph.createNode('RECTANGLE', parentId, {
    id,
    name,
    x: 300,
    y: 300,
    width: 10,
    height: 10,
    source: { ...createDefaultSource(), id: `occupant-${id}` }
  })
}

export function singleNodeNamed(editor: Editor, name: string): SceneNode {
  const matches = [...editor.graph.nodes.values()].filter((node) => node.name === name)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one node named ${name}, found ${matches.length}`)
  }
  return expectDefined(matches[0], name)
}

export function restoredComponentInstanceBundle(editor: Editor): ComponentInstanceBundle {
  const component = singleNodeNamed(editor, RESTORE_COMPONENT_NAME)
  const componentChild = expectDefined(
    editor.graph
      .getChildren(component.id)
      .find((node) => node.name === RESTORE_COMPONENT_CHILD_NAME),
    RESTORE_COMPONENT_CHILD_NAME
  )
  const instance = singleNodeNamed(editor, RESTORE_INSTANCE_NAME)
  const instanceChild = getNodeOrThrow(
    editor.graph,
    expectDefined(instance.childIds[0], 'restored instance child id')
  )
  return { component, componentChild, instance, instanceChild }
}

export function assertRestoredComponentInstanceLink(
  editor: Editor,
  bundle: ComponentInstanceBundle
): void {
  if (bundle.instance.componentId !== bundle.component.id) {
    throw new Error(
      `Expected restored instance ${bundle.instance.id} to point at component ${bundle.component.id}, got ${bundle.instance.componentId}`
    )
  }
  if (bundle.instanceChild.componentId !== bundle.componentChild.id) {
    throw new Error(
      `Expected restored instance child ${bundle.instanceChild.id} to point at component child ${bundle.componentChild.id}, got ${bundle.instanceChild.componentId}`
    )
  }
  const indexedInstanceIds = editor.graph.getInstances(bundle.component.id).map((node) => node.id)
  if (!indexedInstanceIds.includes(bundle.instance.id)) {
    throw new Error(
      `Expected instance index for ${bundle.component.id} to include ${bundle.instance.id}`
    )
  }
  const instanceChildStableId = editor.graph.identity.getStableId(bundle.instanceChild)
  if (!Object.hasOwn(bundle.instance.overrides, `${instanceChildStableId}:fills`)) {
    throw new Error(`Expected restored overrides to contain ${instanceChildStableId}:fills`)
  }
}
