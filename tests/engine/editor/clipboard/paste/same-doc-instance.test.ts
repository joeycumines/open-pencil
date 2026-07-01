import { describe, expect, test } from 'bun:test'

import { buildOpenPencilClipboardHTML } from '@open-pencil/core/clipboard'
import { createEditor } from '@open-pencil/core/editor'

function createFloatVariable(
  editor: ReturnType<typeof createEditor>,
  name: string,
  value: number
): string {
  const collection = editor.graph.createCollection(`${name} collection`)
  return editor.graph.createVariable(name, 'FLOAT', collection.id, value).id
}

describe('paste instance componentId preservation', () => {
  test('same-document paste of instance alone keeps valid componentId', async () => {
    const source = createEditor()
    const sourcePage = source.state.currentPageId

    const component = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Button',
      width: 120,
      height: 40
    })

    const instance = source.graph.createInstance(component.id, sourcePage)
    if (!instance) throw new Error('expected instance to be created')

    // Copy ONLY the instance — the component is NOT in the pasted subtree
    const html = buildOpenPencilClipboardHTML([instance], source.graph)

    // Paste into the SAME editor — the component already exists
    source.clearSelection()
    await source.pasteFromHTML(html)

    const pastedInstance = [...source.state.selectedIds]
      .map((id) => source.graph.getNode(id))
      .find((n) => n?.type === 'INSTANCE')

    expect(pastedInstance).toBeDefined()
    if (!pastedInstance) throw new Error('expected pasted instance')

    // The componentId must still point to the original component
    expect(pastedInstance.componentId).toBe(component.id)

    // The pasted instance must still be linked to a real COMPONENT
    const linkedComponent = source.graph.getNode(pastedInstance.componentId ?? '')
    expect(linkedComponent?.type).toBe('COMPONENT')
  })

  test('same-document paste of instance alone preserves bare root variable override guard', async () => {
    const source = createEditor()
    const sourcePage = source.state.currentPageId
    const componentVariableId = createFloatVariable(source, 'Component opacity', 0.5)
    const instanceVariableId = createFloatVariable(source, 'Instance opacity', 0.75)

    const component = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Button',
      width: 120,
      height: 40,
      opacity: 1
    })
    source.graph.bindVariable(component.id, 'opacity', componentVariableId)

    const instance = source.graph.createInstance(component.id, sourcePage)
    if (!instance) throw new Error('expected instance to be created')
    source.graph.bindVariable(instance.id, 'opacity', instanceVariableId)

    const html = buildOpenPencilClipboardHTML([instance], source.graph)
    source.clearSelection()
    await source.pasteFromHTML(html)

    const pastedInstance = [...source.state.selectedIds]
      .map((id) => source.graph.getNode(id))
      .find((n) => n?.type === 'INSTANCE')
    expect(pastedInstance).toBeDefined()
    if (!pastedInstance) throw new Error('expected pasted instance')

    expect(pastedInstance.componentId).toBe(component.id)
    expect(pastedInstance.overrides['boundVariables']).toBe(true)
    expect(pastedInstance.boundVariables['opacity']).toBe(instanceVariableId)

    source.graph.syncInstances(component.id)
    const syncedInstance = source.graph.getNode(pastedInstance.id)
    expect(syncedInstance?.boundVariables['opacity']).toBe(instanceVariableId)
    expect(syncedInstance?.overrides['boundVariables']).toBe(true)
  })

  test('cross-document paste of instance with absent component nulls componentId', async () => {
    const source = createEditor()
    const sourcePage = source.state.currentPageId

    const component = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Button',
      width: 120,
      height: 40
    })

    const instance = source.graph.createInstance(component.id, sourcePage)
    if (!instance) throw new Error('expected instance to be created')

    // Copy ONLY the instance
    const html = buildOpenPencilClipboardHTML([instance], source.graph)

    // Paste into a DIFFERENT editor — the component does NOT exist
    const target = createEditor()
    target.clearSelection()
    await target.pasteFromHTML(html)

    const pastedInstance = [...target.state.selectedIds]
      .map((id) => target.graph.getNode(id))
      .find((n) => n?.type === 'INSTANCE')

    expect(pastedInstance).toBeDefined()
    if (!pastedInstance) throw new Error('expected pasted instance')

    // The componentId must be null — the component is absent
    expect(pastedInstance.componentId).toBeNull()
  })

  test('same-document paste of component + instance bundle remaps to pasted component', async () => {
    const source = createEditor()
    const sourcePage = source.state.currentPageId

    const component = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Button',
      width: 120,
      height: 40
    })
    const _compChild = source.graph.createNode('RECTANGLE', component.id, {
      name: 'Bg',
      width: 120,
      height: 40,
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })

    const instance = source.graph.createInstance(component.id, sourcePage)
    if (!instance) throw new Error('expected instance to be created')

    // Copy BOTH the component and the instance
    const html = buildOpenPencilClipboardHTML([component, instance], source.graph)

    // Paste into the SAME editor
    source.clearSelection()
    await source.pasteFromHTML(html)

    const pastedInstance = [...source.state.selectedIds]
      .map((id) => source.graph.getNode(id))
      .find((n) => n?.type === 'INSTANCE')

    expect(pastedInstance).toBeDefined()
    if (!pastedInstance) throw new Error('expected pasted instance')

    // The componentId must point to the PASTED component, not the original
    expect(pastedInstance.componentId).not.toBe(component.id)
    const pastedComponent = source.graph.getNode(pastedInstance.componentId ?? '')
    expect(pastedComponent?.type).toBe('COMPONENT')
  })
})
