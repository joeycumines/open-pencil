import { describe, expect, test } from 'bun:test'

import { buildOpenPencilClipboardHTML, prefetchFigmaSchema } from '@open-pencil/core/clipboard'
import { createEditor } from '@open-pencil/core/editor'

import { getNodeOrThrow } from '#tests/helpers/assert'
import {
  assertRestoredComponentInstanceLink,
  componentInstanceClipboardHtml,
  createComponentInstanceBundle,
  createRuntimeIdOccupant,
  restoredComponentInstanceBundle
} from '#tests/helpers/component-instance-restore'

const EMPTY_FILE_LIST: FileList = {
  length: 0,
  item: () => null
}

const EMPTY_DATA_TRANSFER_ITEMS: DataTransferItemList = {
  length: 0,
  add: () => null,
  clear: () => undefined,
  item: () => null,
  remove: () => undefined
}

class ClipboardDataMock implements DataTransfer {
  private readonly data = new Map<string, string>()
  private finalized = false

  dropEffect: DataTransfer['dropEffect'] = 'none'
  effectAllowed: DataTransfer['effectAllowed'] = 'uninitialized'
  readonly files = EMPTY_FILE_LIST
  readonly items = EMPTY_DATA_TRANSFER_ITEMS

  get types(): readonly string[] {
    return [...this.data.keys()]
  }

  clearData(format?: string): void {
    if (format) {
      this.data.delete(format)
      return
    }
    this.data.clear()
  }

  setData(format: string, data: string): void {
    if (this.finalized) return
    this.data.set(format, data)
  }

  getData(format: string): string {
    return this.data.get(format) ?? ''
  }

  setDragImage(_image: Element, _x: number, _y: number): void {
    // The editor copy path never calls setDragImage; this fake only stores MIME data.
  }

  finalize(): void {
    this.finalized = true
  }
}

function copyNodesHtml(
  source: ReturnType<typeof createEditor>,
  roots: Parameters<typeof buildOpenPencilClipboardHTML>[0]
) {
  return buildOpenPencilClipboardHTML(roots, source.graph)
}

function createFloatVariable(
  editor: ReturnType<typeof createEditor>,
  name: string,
  value: number
): string {
  const collection = editor.graph.createCollection(`${name} collection`)
  return editor.graph.createVariable(name, 'FLOAT', collection.id, value).id
}

function selectedComponentAndInstance(editor: ReturnType<typeof createEditor>) {
  const selectedNodes = [...editor.state.selectedIds].map((id) => editor.graph.getNode(id))
  const component = selectedNodes.find((node) => node?.type === 'COMPONENT')
  const instance = selectedNodes.find((node) => node?.type === 'INSTANCE')
  if (!component || !instance) throw new Error('expected pasted component and instance')
  return { component, instance }
}

describe('paste component + instance identity', () => {
  test('pasted component and instance stay linked and overrides map to pasted child ids', async () => {
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
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })

    const instance = source.graph.createInstance(component.id, sourcePage)
    if (!instance) throw new Error('expected instance to be created')

    const instChild = getNodeOrThrow(source.graph, instance.childIds[0])
    const overrideValue = [
      {
        type: 'SOLID',
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
    source.graph.updateNode(instance.id, {
      overrides: { [`${instChild.id}:fills`]: overrideValue }
    })

    const html = copyNodesHtml(source, [component, instance])

    const target = createEditor()
    target.clearSelection()
    await target.pasteFromHTML(html)

    const pastedInstance = [...target.state.selectedIds]
      .map((id) => target.graph.getNode(id))
      .find((n) => n?.type === 'INSTANCE')
    expect(pastedInstance).toBeDefined()
    if (!pastedInstance) throw new Error('expected pasted instance')

    const pastedComponent = target.graph.getNode(pastedInstance.componentId ?? '')
    expect(pastedComponent?.type).toBe('COMPONENT')

    const newInstChild = getNodeOrThrow(target.graph, pastedInstance.childIds[0])
    expect(newInstChild.type).toBe('RECTANGLE')

    const overrideKeys = Object.keys(pastedInstance.overrides)
    expect(overrideKeys).toHaveLength(1)
    expect(overrideKeys[0]).toBe(`${newInstChild.id}:fills`)
  })

  test('component bundle paste preserves instance root overrides and child override remaps', async () => {
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
    source.graph.createNode('RECTANGLE', component.id, {
      name: 'Bg',
      width: 120,
      height: 40,
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })

    const instance = source.graph.createInstance(component.id, sourcePage)
    if (!instance) throw new Error('expected instance to be created')
    const instanceChild = getNodeOrThrow(source.graph, instance.childIds[0])
    source.graph.bindVariable(instance.id, 'opacity', instanceVariableId)
    source.graph.updateNode(instance.id, {
      overrides: { ...instance.overrides, [`${instanceChild.id}:width`]: 22 }
    })

    const html = copyNodesHtml(source, [component, instance])
    source.clearSelection()
    await source.pasteFromHTML(html)

    const selectedNodes = [...source.state.selectedIds].map((id) => source.graph.getNode(id))
    const pastedComponent = selectedNodes.find((node) => node?.type === 'COMPONENT')
    const pastedInstance = selectedNodes.find((node) => node?.type === 'INSTANCE')
    expect(pastedComponent).toBeDefined()
    expect(pastedInstance).toBeDefined()
    if (!pastedComponent || !pastedInstance) throw new Error('expected pasted component bundle')

    const pastedInstanceChild = getNodeOrThrow(source.graph, pastedInstance.childIds[0])
    expect(pastedInstance.componentId).toBe(pastedComponent.id)
    expect(pastedInstance.overrides['boundVariables']).toBe(true)
    expect(pastedInstance.boundVariables['opacity']).toBe(instanceVariableId)
    expect(pastedInstance.overrides[`${pastedInstanceChild.id}:width`]).toBe(22)

    source.graph.syncInstances(pastedComponent.id)
    const syncedInstance = getNodeOrThrow(source.graph, pastedInstance.id)
    expect(syncedInstance.boundVariables['opacity']).toBe(instanceVariableId)
    expect(syncedInstance.overrides['boundVariables']).toBe(true)
    expect(syncedInstance.overrides[`${pastedInstanceChild.id}:width`]).toBe(22)
  })

  test('component bundle paste remaps stable child bound variable override keys', async () => {
    const source = createEditor()
    const sourcePage = source.state.currentPageId
    const widthVariableId = createFloatVariable(source, 'Instance width', 88)

    const component = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Button',
      width: 120,
      height: 40
    })
    source.graph.createNode('RECTANGLE', component.id, {
      name: 'Bg',
      width: 120,
      height: 40
    })

    const instance = source.graph.createInstance(component.id, sourcePage)
    if (!instance) throw new Error('expected instance to be created')
    const instanceChild = getNodeOrThrow(source.graph, instance.childIds[0])
    const sourceStableChildId = source.graph.identity.getStableId(instanceChild)
    source.graph.bindVariable(instanceChild.id, 'width', widthVariableId)

    const sourceInstance = getNodeOrThrow(source.graph, instance.id)
    expect(sourceInstance.overrides[`${sourceStableChildId}:boundVariables`]).toEqual({
      width: widthVariableId
    })

    const html = copyNodesHtml(source, [component, sourceInstance])
    source.clearSelection()
    await source.pasteFromHTML(html)

    const { component: pastedComponent, instance: pastedInstance } =
      selectedComponentAndInstance(source)
    const pastedComponentChild = getNodeOrThrow(source.graph, pastedComponent.childIds[0])
    const pastedInstanceChild = getNodeOrThrow(source.graph, pastedInstance.childIds[0])
    const pastedComponentChildStable = source.graph.identity.getStableId(pastedComponentChild)
    const pastedInstanceChildStable = source.graph.identity.getStableId(pastedInstanceChild)

    expect(pastedInstance.overrides[`${pastedComponentChildStable}:boundVariables`]).toBeUndefined()
    expect(pastedInstance.overrides[`${pastedInstanceChildStable}:boundVariables`]).toEqual({
      width: widthVariableId
    })

    source.graph.syncInstances(pastedComponent.id)
    const syncedChild = getNodeOrThrow(source.graph, pastedInstanceChild.id)
    expect(syncedChild.boundVariables['width']).toBe(widthVariableId)
  })

  test('component bundle paste recursively remaps nested instance override records', async () => {
    const source = createEditor()
    const sourcePage = source.state.currentPageId

    const innerComponent = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Inner',
      width: 80,
      height: 40
    })
    source.graph.createNode('RECTANGLE', innerComponent.id, {
      name: 'Inner child',
      width: 60,
      height: 20
    })

    const outerComponent = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Outer',
      width: 160,
      height: 80
    })
    const nestedInComponent = source.graph.createInstance(innerComponent.id, outerComponent.id)
    if (!nestedInComponent) throw new Error('expected nested instance in component')

    const outerInstance = source.graph.createInstance(outerComponent.id, sourcePage)
    if (!outerInstance) throw new Error('expected outer instance')
    const nestedInInstance = getNodeOrThrow(source.graph, outerInstance.childIds[0])
    const nestedChild = getNodeOrThrow(source.graph, nestedInInstance.childIds[0])
    const nestedStable = source.graph.identity.getStableId(nestedInInstance)
    const nestedChildStable = source.graph.identity.getStableId(nestedChild)

    source.graph.updateNode(outerInstance.id, {
      overrides: { [`${nestedStable}:overrides`]: { [`${nestedChildStable}:width`]: 84 } }
    })
    source.graph.updateNode(nestedChild.id, { width: 84 })

    const html = copyNodesHtml(source, [
      outerComponent,
      getNodeOrThrow(source.graph, outerInstance.id)
    ])
    source.clearSelection()
    await source.pasteFromHTML(html)

    const { component: pastedOuterComponent, instance: pastedOuterInstance } =
      selectedComponentAndInstance(source)
    const pastedNested = getNodeOrThrow(source.graph, pastedOuterInstance.childIds[0])
    const pastedNestedChild = getNodeOrThrow(source.graph, pastedNested.childIds[0])
    const pastedNestedStable = source.graph.identity.getStableId(pastedNested)
    const pastedNestedChildStable = source.graph.identity.getStableId(pastedNestedChild)

    expect(pastedOuterInstance.overrides).toEqual({
      [`${pastedNestedStable}:overrides`]: { [`${pastedNestedChildStable}:width`]: 84 }
    })

    source.graph.syncInstances(pastedOuterComponent.id)
    const syncedNestedChild = getNodeOrThrow(source.graph, pastedNestedChild.id)
    expect(syncedNestedChild.width).toBe(84)
  })

  test('component bundle paste preserves nested instance child variable bindings', async () => {
    const source = createEditor()
    const sourcePage = source.state.currentPageId
    const widthVariableId = createFloatVariable(source, 'Nested width', 72)

    const innerComponent = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Inner',
      width: 80,
      height: 40
    })
    source.graph.createNode('RECTANGLE', innerComponent.id, {
      name: 'Inner child',
      width: 60,
      height: 20
    })
    const outerComponent = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Outer',
      width: 160,
      height: 80
    })
    const nestedInComponent = source.graph.createInstance(innerComponent.id, outerComponent.id)
    if (!nestedInComponent) throw new Error('expected nested instance in component')

    const outerInstance = source.graph.createInstance(outerComponent.id, sourcePage)
    if (!outerInstance) throw new Error('expected outer instance')
    const nestedInInstance = getNodeOrThrow(source.graph, outerInstance.childIds[0])
    const nestedChild = getNodeOrThrow(source.graph, nestedInInstance.childIds[0])
    source.graph.bindVariable(nestedChild.id, 'width', widthVariableId)

    const sourceNestedStable = source.graph.identity.getStableId(nestedInInstance)
    const sourceNestedChildStable = source.graph.identity.getStableId(nestedChild)
    expect(outerInstance.overrides[`${sourceNestedStable}:overrides`]).toEqual({
      [`${sourceNestedChildStable}:boundVariables`]: { width: widthVariableId }
    })

    const html = copyNodesHtml(source, [
      outerComponent,
      getNodeOrThrow(source.graph, outerInstance.id)
    ])
    source.clearSelection()
    await source.pasteFromHTML(html)

    const { component: pastedOuterComponent, instance: pastedOuterInstance } =
      selectedComponentAndInstance(source)
    const pastedNested = getNodeOrThrow(source.graph, pastedOuterInstance.childIds[0])
    const pastedNestedChild = getNodeOrThrow(source.graph, pastedNested.childIds[0])
    const pastedNestedStable = source.graph.identity.getStableId(pastedNested)
    const pastedNestedChildStable = source.graph.identity.getStableId(pastedNestedChild)

    expect(pastedOuterInstance.overrides).toEqual({
      [`${pastedNestedStable}:overrides`]: {
        [`${pastedNestedChildStable}:boundVariables`]: { width: widthVariableId }
      }
    })
    expect(pastedNestedChild.boundVariables['width']).toBe(widthVariableId)

    source.graph.syncInstances(pastedOuterComponent.id)
    const syncedNestedChild = getNodeOrThrow(source.graph, pastedNestedChild.id)
    expect(syncedNestedChild.boundVariables['width']).toBe(widthVariableId)
  })

  test('component bundle paste preserves mixed nested overrides and child variable bindings', async () => {
    const source = createEditor()
    const sourcePage = source.state.currentPageId
    const heightVariableId = createFloatVariable(source, 'Nested height', 48)

    const innerComponent = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Inner',
      width: 80,
      height: 40
    })
    source.graph.createNode('RECTANGLE', innerComponent.id, {
      name: 'Inner child',
      width: 60,
      height: 20
    })
    const outerComponent = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Outer',
      width: 160,
      height: 80
    })
    const nestedInComponent = source.graph.createInstance(innerComponent.id, outerComponent.id)
    if (!nestedInComponent) throw new Error('expected nested instance in component')

    const outerInstance = source.graph.createInstance(outerComponent.id, sourcePage)
    if (!outerInstance) throw new Error('expected outer instance')
    const nestedInInstance = getNodeOrThrow(source.graph, outerInstance.childIds[0])
    const nestedChild = getNodeOrThrow(source.graph, nestedInInstance.childIds[0])
    const sourceNestedStable = source.graph.identity.getStableId(nestedInInstance)
    const sourceNestedChildStable = source.graph.identity.getStableId(nestedChild)

    source.graph.updateNode(outerInstance.id, {
      overrides: {
        [`${sourceNestedStable}:overrides`]: { [`${sourceNestedChildStable}:width`]: 84 }
      }
    })
    source.graph.updateNode(nestedChild.id, { width: 84 })
    source.graph.bindVariable(nestedChild.id, 'height', heightVariableId)

    expect(outerInstance.overrides[`${sourceNestedStable}:overrides`]).toEqual({
      [`${sourceNestedChildStable}:width`]: 84,
      [`${sourceNestedChildStable}:boundVariables`]: { height: heightVariableId }
    })

    const html = copyNodesHtml(source, [
      outerComponent,
      getNodeOrThrow(source.graph, outerInstance.id)
    ])
    source.clearSelection()
    await source.pasteFromHTML(html)

    const { component: pastedOuterComponent, instance: pastedOuterInstance } =
      selectedComponentAndInstance(source)
    const pastedNested = getNodeOrThrow(source.graph, pastedOuterInstance.childIds[0])
    const pastedNestedChild = getNodeOrThrow(source.graph, pastedNested.childIds[0])
    const pastedNestedStable = source.graph.identity.getStableId(pastedNested)
    const pastedNestedChildStable = source.graph.identity.getStableId(pastedNestedChild)

    expect(pastedOuterInstance.overrides).toEqual({
      [`${pastedNestedStable}:overrides`]: {
        [`${pastedNestedChildStable}:width`]: 84,
        [`${pastedNestedChildStable}:boundVariables`]: { height: heightVariableId }
      }
    })

    source.graph.syncInstances(pastedOuterComponent.id)
    const syncedNestedChild = getNodeOrThrow(source.graph, pastedNestedChild.id)
    expect(syncedNestedChild.width).toBe(84)
    expect(syncedNestedChild.boundVariables['height']).toBe(heightVariableId)
  })

  test('production writeCopyData preserves OpenPencil payload before Figma HTML', async () => {
    await prefetchFigmaSchema()

    const source = createEditor()
    const sourcePage = source.state.currentPageId

    const component = source.graph.createNode('COMPONENT', sourcePage, {
      name: 'Button',
      width: 120,
      height: 40
    })
    source.graph.createNode('RECTANGLE', component.id, {
      name: 'Bg',
      width: 120,
      height: 40,
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })

    const instance = source.graph.createInstance(component.id, sourcePage)
    if (!instance) throw new Error('expected instance to be created')

    const instChild = getNodeOrThrow(source.graph, instance.childIds[0])
    const overrideValue = [
      {
        type: 'SOLID',
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
    source.graph.updateNode(instance.id, {
      overrides: { [`${instChild.id}:fills`]: overrideValue }
    })
    source.select([component.id, instance.id])

    const clipboardData = new ClipboardDataMock()
    const write = source.writeCopyData(clipboardData)
    clipboardData.finalize()
    await write

    const html = clipboardData.getData('text/html')
    expect(html).toContain('(openpencil)')
    expect(html).toContain('(figma)')

    const target = createEditor()
    target.clearSelection()
    await target.pasteFromHTML(html)

    const pastedInstance = [...target.state.selectedIds]
      .map((id) => target.graph.getNode(id))
      .find((n) => n?.type === 'INSTANCE')
    expect(pastedInstance).toBeDefined()
    if (!pastedInstance) throw new Error('expected pasted instance')

    const pastedComponent = target.graph.getNode(pastedInstance.componentId ?? '')
    expect(pastedComponent?.type).toBe('COMPONENT')

    const newInstChild = getNodeOrThrow(target.graph, pastedInstance.childIds[0])
    const overrideKeys = Object.keys(pastedInstance.overrides)
    expect(overrideKeys).toHaveLength(1)
    expect(overrideKeys[0]).toBe(`${newInstChild.id}:fills`)
  })

  test('paste redo remaps restored component and instance references when old ids are occupied', async () => {
    const source = createEditor()
    const sourceBundle = createComponentInstanceBundle(source, source.state.currentPageId)
    const html = componentInstanceClipboardHtml(source, sourceBundle)

    const target = createEditor()
    await target.pasteFromHTML(html)
    const pasted = restoredComponentInstanceBundle(target)
    const oldComponentId = pasted.component.id
    const oldComponentChildId = pasted.componentChild.id
    const oldInstanceChildId = pasted.instanceChild.id

    target.undo.undo()
    createRuntimeIdOccupant(
      target,
      target.state.currentPageId,
      oldComponentId,
      'Component occupant'
    )
    createRuntimeIdOccupant(
      target,
      target.state.currentPageId,
      oldComponentChildId,
      'Component child occupant'
    )
    createRuntimeIdOccupant(
      target,
      target.state.currentPageId,
      oldInstanceChildId,
      'Instance child occupant'
    )

    target.undo.redo()

    const restored = restoredComponentInstanceBundle(target)
    expect(restored.component.id).not.toBe(oldComponentId)
    expect(restored.componentChild.id).not.toBe(oldComponentChildId)
    expect(restored.instanceChild.id).not.toBe(oldInstanceChildId)
    expect(target.graph.getNode(oldComponentId)?.name).toBe('Component occupant')
    assertRestoredComponentInstanceLink(target, restored)
  })
})
