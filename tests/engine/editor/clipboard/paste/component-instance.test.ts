import { describe, expect, test } from 'bun:test'

import { buildOpenPencilClipboardHTML } from '@open-pencil/core/clipboard'
import { createEditor } from '@open-pencil/core/editor'

import { getNodeOrThrow } from '#tests/helpers/assert'

function copyNodesHtml(
  source: ReturnType<typeof createEditor>,
  roots: Parameters<typeof buildOpenPencilClipboardHTML>[0]
) {
  return buildOpenPencilClipboardHTML(roots, source.graph)
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
})
