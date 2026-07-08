import { describe, test, expect } from 'bun:test'

import { createDefaultSource } from '@open-pencil/scene-graph'

import { expectDefined, getNodeOrThrow } from '#tests/helpers/assert'
import {
  assertRestoredComponentInstanceLink,
  createComponentInstanceBundle,
  createRuntimeIdOccupant,
  restoredComponentInstanceBundle
} from '#tests/helpers/component-instance-restore'
import { createHistoryFrame, setupEditorPage } from '#tests/helpers/editor-history'

describe('undo/redo multi-step sequences', () => {
  test('create → move → duplicate → move copy → undo all → redo all', () => {
    const { editor, pageId } = setupEditorPage()

    const frame = createHistoryFrame(editor, pageId, { x: 100, y: 100 })
    editor.select([frame.id])
    const createSnapshot = structuredClone(getNodeOrThrow(editor.graph, frame.id))
    editor.pushUndoEntry({
      label: 'Create',
      forward: () => {
        const { parentId: _p, childIds: _c, ...rest } = createSnapshot
        editor.graph.createNode('FRAME', pageId, rest)
      },
      inverse: () => editor.graph.deleteNode(frame.id)
    })

    editor.graph.updateNode(frame.id, { x: 300, y: 50 })
    editor.commitMove(new Map([[frame.id, { x: 100, y: 100 }]]))

    expect(getNodeOrThrow(editor.graph, frame.id).x).toBe(300)
    expect(getNodeOrThrow(editor.graph, frame.id).y).toBe(50)

    editor.duplicateSelected()
    const dupIds = [...editor.state.selectedIds]
    expect(dupIds).toHaveLength(1)
    const dupId = expectDefined(dupIds[0], 'duplicate id')
    expect(dupId).not.toBe(frame.id)

    editor.graph.updateNode(dupId, { x: 500, y: 200 })
    editor.commitMove(new Map([[dupId, { x: 320, y: 70 }]]))

    // Undo move copy
    editor.undo.undo()
    expect(getNodeOrThrow(editor.graph, dupId).x).toBe(320)

    // Undo duplicate
    editor.undo.undo()
    expect(editor.graph.getNode(dupId)).toBeUndefined()

    // Undo move
    editor.undo.undo()
    expect(getNodeOrThrow(editor.graph, frame.id).x).toBe(100)

    // Undo create
    editor.undo.undo()
    expect(editor.graph.getNode(frame.id)).toBeUndefined()

    // Redo create
    editor.undo.redo()
    expect(editor.graph.getNode(frame.id)).not.toBeUndefined()
    expect(getNodeOrThrow(editor.graph, frame.id).x).toBe(100)

    // Redo move
    editor.undo.redo()
    expect(getNodeOrThrow(editor.graph, frame.id).x).toBe(300)

    // Redo duplicate — must recreate with SAME ID
    editor.undo.redo()
    expect(editor.graph.getNode(dupId)).not.toBeUndefined()

    // Redo move copy — must find the node by same ID
    editor.undo.redo()
    expect(getNodeOrThrow(editor.graph, dupId).x).toBe(500)
    expect(getNodeOrThrow(editor.graph, dupId).y).toBe(200)
  })

  test('duplicate with children preserves subtree on redo', () => {
    const { editor, pageId } = setupEditorPage()

    const frame = createHistoryFrame(editor, pageId, { x: 50, y: 50 })
    editor.graph.createNode('TEXT', frame.id, {
      name: 'Title',
      text: 'Hello',
      x: 10,
      y: 10,
      width: 100,
      height: 20
    })

    editor.select([frame.id])
    editor.duplicateSelected()

    const dupFrameId = expectDefined([...editor.state.selectedIds][0], 'duplicated frame id')
    const dupChildren = getNodeOrThrow(editor.graph, dupFrameId).childIds
    expect(dupChildren).toHaveLength(1)
    const dupTextId = expectDefined(dupChildren[0], 'duplicated text id')
    expect(getNodeOrThrow(editor.graph, dupTextId).text).toBe('Hello')

    // Undo
    editor.undo.undo()
    expect(editor.graph.getNode(dupFrameId)).toBeUndefined()
    expect(editor.graph.getNode(dupTextId)).toBeUndefined()

    // Redo — must recreate with same IDs
    editor.undo.redo()
    expect(editor.graph.getNode(dupFrameId)).not.toBeUndefined()
    expect(editor.graph.getNode(dupTextId)).not.toBeUndefined()
    expect(getNodeOrThrow(editor.graph, dupFrameId).childIds).toContain(dupTextId)
    expect(getNodeOrThrow(editor.graph, dupTextId).text).toBe('Hello')
  })

  test('duplicate remaps selected top-level instance to selected top-level component copy', () => {
    const { editor, pageId } = setupEditorPage()
    const bundle = createComponentInstanceBundle(editor, pageId)

    editor.select([bundle.component.id, bundle.instance.id])
    editor.duplicateSelected()

    const duplicatedIds = [...editor.state.selectedIds]
    const duplicatedComponent = expectDefined(
      duplicatedIds
        .map((id) => editor.graph.getNode(id))
        .find((node) => node?.type === 'COMPONENT'),
      'duplicated component'
    )
    const duplicatedInstance = expectDefined(
      duplicatedIds.map((id) => editor.graph.getNode(id)).find((node) => node?.type === 'INSTANCE'),
      'duplicated instance'
    )

    expect(duplicatedInstance.componentId).toBe(duplicatedComponent.id)
    expect(editor.graph.getInstances(duplicatedComponent.id).map((node) => node.id)).toContain(
      duplicatedInstance.id
    )
    expect(editor.graph.getInstances(bundle.component.id).map((node) => node.id)).not.toContain(
      duplicatedInstance.id
    )

    editor.undo.undo()
    expect(editor.graph.getNode(duplicatedComponent.id)).toBeUndefined()
    expect(editor.graph.getNode(duplicatedInstance.id)).toBeUndefined()

    editor.undo.redo()
    const restoredIds = [...editor.state.selectedIds]
    const restoredComponent = expectDefined(
      restoredIds.map((id) => editor.graph.getNode(id)).find((node) => node?.type === 'COMPONENT'),
      'restored duplicated component'
    )
    const restoredInstance = expectDefined(
      restoredIds.map((id) => editor.graph.getNode(id)).find((node) => node?.type === 'INSTANCE'),
      'restored duplicated instance'
    )
    expect(restoredInstance.componentId).toBe(restoredComponent.id)
    expect(editor.graph.getInstances(restoredComponent.id).map((node) => node.id)).toContain(
      restoredInstance.id
    )
  })

  test('page snapshot restore preserves node IDs', () => {
    const { editor, pageId } = setupEditorPage()
    const frame = createHistoryFrame(editor, pageId)
    const child = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Bg',
      width: 200,
      height: 150
    })

    const snapshot = editor.snapshotPage()
    editor.graph.deleteNode(frame.id)
    editor.restorePageFromSnapshot(snapshot)

    expect(editor.graph.getNode(frame.id)).not.toBeUndefined()
    expect(editor.graph.getNode(child.id)).not.toBeUndefined()
    expect(getNodeOrThrow(editor.graph, frame.id).childIds).toEqual([child.id])
  })

  test('page snapshot restore uses returned IDs when old runtime IDs are occupied elsewhere', async () => {
    const { editor, pageId } = setupEditorPage()
    const frame = createHistoryFrame(editor, pageId, { name: 'Restored frame' })
    const child = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Restored child',
      width: 200,
      height: 150
    })
    const snapshot = editor.snapshotPage()

    editor.graph.deleteNode(frame.id, { permanent: true })
    const otherPageId = editor.addPage('Other page')
    await editor.switchPage(otherPageId)
    const occupant = editor.graph.createNode('RECTANGLE', otherPageId, {
      id: frame.id,
      source: { ...createDefaultSource(), id: frame.id },
      name: 'Occupies old frame runtime id',
      width: 20,
      height: 20
    })
    await editor.switchPage(pageId)

    editor.restorePageFromSnapshot(snapshot)

    expect(occupant.id).toBe(frame.id)
    const restoredFrame = expectDefined(
      editor.graph.getChildren(pageId).find((node) => node.name === 'Restored frame'),
      'restored frame'
    )
    const restoredChild = expectDefined(
      editor.graph.getChildren(restoredFrame.id).find((node) => node.name === child.name),
      'restored child'
    )
    expect(restoredFrame.id).not.toBe(frame.id)
    expect(restoredFrame.id).not.toBe(occupant.id)
    expect(getNodeOrThrow(editor.graph, occupant.id).parentId).toBe(otherPageId)
    expect(restoredFrame.childIds).toEqual([restoredChild.id])
    expect(restoredChild.parentId).toBe(restoredFrame.id)
  })

  test('page snapshot restore remaps component and instance references when old ids are occupied', async () => {
    const { editor, pageId } = setupEditorPage()
    const bundle = createComponentInstanceBundle(editor, pageId)
    const snapshot = editor.snapshotPage()

    editor.graph.deleteNode(bundle.component.id, { permanent: true })
    editor.graph.deleteNode(bundle.instance.id, { permanent: true })
    const otherPageId = editor.addPage('Component occupants')
    await editor.switchPage(otherPageId)
    createRuntimeIdOccupant(editor, otherPageId, bundle.component.id, 'Snapshot component occupant')
    createRuntimeIdOccupant(
      editor,
      otherPageId,
      bundle.componentChild.id,
      'Snapshot component child occupant'
    )
    createRuntimeIdOccupant(
      editor,
      otherPageId,
      bundle.instanceChild.id,
      'Snapshot instance child occupant'
    )
    await editor.switchPage(pageId)

    editor.restorePageFromSnapshot(snapshot)

    const restored = restoredComponentInstanceBundle(editor)
    expect(restored.component.id).not.toBe(bundle.component.id)
    expect(restored.componentChild.id).not.toBe(bundle.componentChild.id)
    expect(restored.instanceChild.id).not.toBe(bundle.instanceChild.id)
    expect(editor.graph.getNode(bundle.component.id)?.name).toBe('Snapshot component occupant')
    assertRestoredComponentInstanceLink(editor, restored)
  })

  test('delete frame with children → undo restores subtree', () => {
    const { editor, pageId } = setupEditorPage()

    const frame = createHistoryFrame(editor, pageId)
    const child = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Bg',
      x: 0,
      y: 0,
      width: 200,
      height: 150
    })

    editor.select([frame.id])
    editor.deleteSelected()

    expect(editor.graph.getNode(frame.id)).toBeUndefined()
    expect(editor.graph.getNode(child.id)).toBeUndefined()

    editor.undo.undo()
    expect(editor.graph.getNode(frame.id)).not.toBeUndefined()
    expect(editor.graph.getNode(child.id)).not.toBeUndefined()
    expect(getNodeOrThrow(editor.graph, frame.id).childIds).toContain(child.id)
  })

  test('KC-002: restoring a deleted node does not overwrite an unrelated live node', () => {
    const { editor, pageId } = setupEditorPage()

    const deletedRect = editor.graph.createNode('RECTANGLE', pageId, {
      name: 'Deleted',
      x: 0,
      y: 0,
      width: 10,
      height: 10
    })
    const deletedId = deletedRect.id
    const deletedStableId = deletedRect.source.id

    editor.select([deletedId])
    editor.deleteSelected()
    expect(editor.graph.getNode(deletedId)).toBeUndefined()

    const replacementRect = editor.graph.createNode('RECTANGLE', pageId, {
      name: 'Replacement',
      x: 100,
      y: 100,
      width: 20,
      height: 20
    })
    const replacementId = replacementRect.id

    editor.undo.undo()
    const restoredDeleted = editor.graph.getNode(deletedId)
    expect(restoredDeleted).toBeDefined()
    if (!restoredDeleted) throw new Error('expected restored node')

    expect(restoredDeleted.source.id).toBe(deletedStableId)

    const liveReplacement = editor.graph.getNode(replacementId)
    expect(liveReplacement?.id).toBe(replacementId)
    expect(liveReplacement?.name).toBe('Replacement')
  })

  test('delete undo selects and parents restored subtree when old root ID is occupied', () => {
    const { editor, pageId } = setupEditorPage()
    const deletedFrame = createHistoryFrame(editor, pageId, { name: 'Deleted frame' })
    const deletedFrameStableId = expectDefined(deletedFrame.source.id, 'deleted frame stable id')
    const deletedChild = editor.graph.createNode('RECTANGLE', deletedFrame.id, {
      name: 'Deleted child',
      width: 20,
      height: 20
    })
    editor.select([deletedFrame.id])
    editor.deleteSelected()
    expect(editor.graph.getNode(deletedFrame.id)).toBeUndefined()

    const occupant = editor.graph.createNode('RECTANGLE', pageId, {
      id: deletedFrame.id,
      source: { ...createDefaultSource(), id: `occupant-${deletedFrame.id}` },
      name: 'Occupies deleted runtime id',
      width: 10,
      height: 10
    })

    editor.undo.undo()

    expect(occupant.id).toBe(deletedFrame.id)
    const restoredFrame = expectDefined(
      editor.graph.getChildren(pageId).find((node) => node.name === deletedFrame.name),
      'restored deleted frame'
    )
    const restoredChild = expectDefined(
      editor.graph.getChildren(restoredFrame.id).find((node) => node.name === deletedChild.name),
      'restored deleted child'
    )
    expect(restoredFrame.id).not.toBe(deletedFrame.id)
    expect(restoredFrame.id).not.toBe(occupant.id)
    expect(editor.graph.stableIdToRuntimeId(deletedFrameStableId)).toBe(restoredFrame.id)
    expect(getNodeOrThrow(editor.graph, occupant.id).name).toBe('Occupies deleted runtime id')
    expect(restoredFrame.childIds).toEqual([restoredChild.id])
    expect(restoredChild.parentId).toBe(restoredFrame.id)
    expect(editor.state.selectedIds).toEqual(new Set([restoredFrame.id]))
  })

  test('delete undo remaps restored component and instance references when old ids are occupied', () => {
    const { editor, pageId } = setupEditorPage()
    const bundle = createComponentInstanceBundle(editor, pageId)

    editor.select([bundle.component.id, bundle.instance.id])
    editor.deleteSelected()
    createRuntimeIdOccupant(editor, pageId, bundle.component.id, 'Deleted component occupant')
    createRuntimeIdOccupant(
      editor,
      pageId,
      bundle.componentChild.id,
      'Deleted component child occupant'
    )
    createRuntimeIdOccupant(
      editor,
      pageId,
      bundle.instanceChild.id,
      'Deleted instance child occupant'
    )

    editor.undo.undo()

    const restored = restoredComponentInstanceBundle(editor)
    expect(restored.component.id).not.toBe(bundle.component.id)
    expect(restored.componentChild.id).not.toBe(bundle.componentChild.id)
    expect(restored.instanceChild.id).not.toBe(bundle.instanceChild.id)
    expect(editor.graph.getNode(bundle.component.id)?.name).toBe('Deleted component occupant')
    assertRestoredComponentInstanceLink(editor, restored)
    expect(editor.state.selectedIds).toEqual(new Set([restored.component.id, restored.instance.id]))
  })

  test('duplicate redo remaps restored component and instance references when old ids are occupied', () => {
    const { editor, pageId } = setupEditorPage()
    const bundle = createComponentInstanceBundle(editor, pageId)

    editor.select([bundle.component.id, bundle.instance.id])
    editor.commitDuplicateMove([bundle.component.id, bundle.instance.id], new Set())

    editor.undo.undo()
    createRuntimeIdOccupant(editor, pageId, bundle.component.id, 'Duplicate component occupant')
    createRuntimeIdOccupant(
      editor,
      pageId,
      bundle.componentChild.id,
      'Duplicate component child occupant'
    )
    createRuntimeIdOccupant(
      editor,
      pageId,
      bundle.instanceChild.id,
      'Duplicate instance child occupant'
    )

    editor.undo.redo()

    const restored = restoredComponentInstanceBundle(editor)
    expect(restored.component.id).not.toBe(bundle.component.id)
    expect(restored.componentChild.id).not.toBe(bundle.componentChild.id)
    expect(restored.instanceChild.id).not.toBe(bundle.instanceChild.id)
    expect(editor.graph.getNode(bundle.component.id)?.name).toBe('Duplicate component occupant')
    assertRestoredComponentInstanceLink(editor, restored)
  })
})
