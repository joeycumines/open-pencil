import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { FigmaAPI } from '@open-pencil/core/figma-api'

import { stableIdForCollection, stableIdForMode, stableIdForVariable } from '@/app/collab/yjs-sync'

import {
  createRemoteCollectionMap,
  createRemoteVariableMap,
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '#tests/engine/collab/helpers'
import { bindHostGraphEvents } from '#tests/engine/collab/pending/helpers'

function syncHostToJoiner(hostStore: ReturnType<typeof createTestStore>) {
  const hostYdoc = new Y.Doc()
  const hostSync = createTestYjsSync(hostStore, hostYdoc)
  makeHostRootState(hostStore)
  hostSync.syncAllNodesToYjs()

  const joinerStore = createTestStore()
  const joinerYdoc = new Y.Doc()
  const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
  observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
  encodeAndApply(hostYdoc, joinerYdoc)

  return { hostYdoc, hostSync, joinerStore, joinerYdoc }
}

describe('variables synced over Yjs', () => {
  test('host variable and collection appear on joiner after sync', () => {
    const hostStore = createTestStore()
    const collection = hostStore.graph.createCollection('Tokens')
    hostStore.graph.createVariable('Primary', 'COLOR', collection.id, {
      r: 1,
      g: 0,
      b: 0,
      a: 1
    })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    expect(joinerStore.graph.variableCollections.size).toBe(1)
    expect(joinerStore.graph.variables.size).toBe(1)

    const joinerCollections = [...joinerStore.graph.variableCollections.values()]
    expect(joinerCollections[0].name).toBe('Tokens')

    const joinerVariables = [...joinerStore.graph.variables.values()]
    expect(joinerVariables[0].name).toBe('Primary')
    expect(joinerVariables[0].type).toBe('COLOR')
  })

  test('boundVariables binding survives collab sync', () => {
    const hostStore = createTestStore()
    const page = hostStore.graph.getPages()[0].id
    const collection = hostStore.graph.createCollection('Colors')
    const variable = hostStore.graph.createVariable('Primary', 'COLOR', collection.id, {
      r: 0,
      g: 1,
      b: 0,
      a: 1
    })

    // Create a node with a bound fills variable
    hostStore.graph.createNode('RECTANGLE', page, {
      name: 'Box',
      width: 100,
      height: 100,
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 1, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ],
      boundVariables: { fills: variable.id }
    })

    const varStableId = stableIdForVariable(variable)

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    // Joiner should have the variable
    expect(joinerStore.graph.variables.size).toBe(1)

    // Joiner should have the node
    const joinerNodes = [...joinerStore.graph.nodes.values()].filter((n) => n.type === 'RECTANGLE')
    expect(joinerNodes.length).toBe(1)

    // The binding should resolve to a local variable ID
    const joinerNode = joinerNodes[0]
    const boundVarId = joinerNode.boundVariables.fills
    expect(boundVarId).toBeDefined()
    if (boundVarId === undefined) return

    // The bound variable ID should refer to a real variable on the joiner
    const joinerVariable = joinerStore.graph.variables.get(boundVarId)
    expect(joinerVariable).toBeDefined()
    if (!joinerVariable) return
    expect(joinerVariable.name).toBe('Primary')

    // The stable ID of the joiner's variable should match the host's
    expect(stableIdForVariable(joinerVariable)).toBe(varStableId)
  })

  test('variable valuesByMode sync across peers with mode remapping', () => {
    const hostStore = createTestStore()
    const collection = hostStore.graph.createCollection('Themes')
    // Add a second mode
    const modeId = hostStore.graph.generateNodeId()
    hostStore.graph.addMode(collection.id, modeId, 'Dark')

    hostStore.graph.createVariable('Bg', 'COLOR', collection.id, {
      r: 1,
      g: 1,
      b: 1,
      a: 1
    })

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)

    encodeAndApply(hostYdoc, joinerYdoc)

    // Joiner should have the collection with 2 modes
    expect(joinerStore.graph.variableCollections.size).toBe(1)
    const joinerCollection = [...joinerStore.graph.variableCollections.values()][0]
    expect(joinerCollection.modes.length).toBe(2)
    expect(joinerCollection.modes.map((m) => m.name)).toContain('Mode 1')
    expect(joinerCollection.modes.map((m) => m.name)).toContain('Dark')

    // Joiner should have the variable with values for both modes
    expect(joinerStore.graph.variables.size).toBe(1)
    const joinerVariable = [...joinerStore.graph.variables.values()][0]
    expect(Object.keys(joinerVariable.valuesByMode).length).toBe(2)
  })

  test('duplicate mode ids across collections remap values per collection', () => {
    const hostStore = createTestStore()
    hostStore.graph.addCollection({
      id: 'col:a',
      name: 'A',
      modes: [{ modeId: 'default', name: 'Mode 1' }],
      defaultModeId: 'default',
      variableIds: []
    })
    hostStore.graph.addCollection({
      id: 'col:b',
      name: 'B',
      modes: [{ modeId: 'default', name: 'Mode 1' }],
      defaultModeId: 'default',
      variableIds: []
    })
    hostStore.graph.addVariable({
      id: 'var:a',
      name: 'Avar',
      type: 'FLOAT',
      collectionId: 'col:a',
      valuesByMode: { default: 1 },
      description: '',
      hiddenFromPublishing: false
    })
    hostStore.graph.addVariable({
      id: 'var:b',
      name: 'Bvar',
      type: 'FLOAT',
      collectionId: 'col:b',
      valuesByMode: { default: 2 },
      description: '',
      hiddenFromPublishing: false
    })

    const { joinerStore } = syncHostToJoiner(hostStore)

    const collectionsByName = new Map(
      [...joinerStore.graph.variableCollections.values()].map(
        (collection) => [collection.name, collection] as const
      )
    )
    const collectionA = collectionsByName.get('A')
    const collectionB = collectionsByName.get('B')
    expect(collectionA).toBeDefined()
    expect(collectionB).toBeDefined()
    if (collectionA === undefined || collectionB === undefined) return

    const variableA = [...joinerStore.graph.variables.values()].find(
      (variable) => variable.name === 'Avar'
    )
    const variableB = [...joinerStore.graph.variables.values()].find(
      (variable) => variable.name === 'Bvar'
    )
    expect(variableA).toBeDefined()
    expect(variableB).toBeDefined()
    if (variableA === undefined || variableB === undefined) return

    const modeA = collectionA.modes[0]
    const modeB = collectionB.modes[0]
    expect(modeA).toBeDefined()
    expect(modeB).toBeDefined()
    if (modeA === undefined || modeB === undefined) return

    expect(modeA.modeId).not.toBe(modeB.modeId)
    expect(variableA.valuesByMode).toEqual({ [modeA.modeId]: 1 })
    expect(variableB.valuesByMode).toEqual({ [modeB.modeId]: 2 })
  })

  test('live variable renames and value changes propagate after initial sync', () => {
    const hostStore = createTestStore()
    const collection = hostStore.graph.createCollection('Themes')
    const variable = hostStore.graph.createVariable('Bg', 'COLOR', collection.id, {
      r: 1,
      g: 1,
      b: 1,
      a: 1
    })
    const modeStableId = stableIdForMode(collection.modes[0])

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)

    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)
    hostStore.graph.renameVariable(variable.id, 'Surface')
    hostStore.graph.updateVariableValue(variable.id, collection.defaultModeId, {
      r: 0.125,
      g: 0.25,
      b: 0.5,
      a: 1
    })
    encodeAndApply(hostYdoc, joinerYdoc)
    unbind()

    const joinerVariable = [...joinerStore.graph.variables.values()][0]
    expect(joinerVariable.name).toBe('Surface')
    const joinerCollection = [...joinerStore.graph.variableCollections.values()][0]
    const joinerMode = joinerCollection.modes.find((mode) => stableIdForMode(mode) === modeStableId)
    expect(joinerMode).toBeDefined()
    if (joinerMode === undefined) return
    expect(joinerVariable.valuesByMode[joinerMode.modeId]).toEqual({
      r: 0.125,
      g: 0.25,
      b: 0.5,
      a: 1
    })
  })

  test('live collection renames mode renames and default mode changes propagate', () => {
    const hostStore = createTestStore()
    const collection = hostStore.graph.createCollection('Themes')
    const darkModeId = hostStore.graph.generateNodeId()
    hostStore.graph.addMode(collection.id, darkModeId, 'Dark')
    const darkMode = collection.modes.find((mode) => mode.modeId === darkModeId)
    if (darkMode === undefined) throw new Error('expected dark mode')
    const darkModeStableId = stableIdForMode(darkMode)

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)

    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)
    hostStore.graph.renameCollection(collection.id, 'Brand themes')
    hostStore.graph.renameMode(collection.id, darkModeId, 'Night')
    hostStore.graph.setDefaultMode(collection.id, darkModeId)
    encodeAndApply(hostYdoc, joinerYdoc)
    unbind()

    const joinerCollection = [...joinerStore.graph.variableCollections.values()][0]
    expect(joinerCollection.name).toBe('Brand themes')
    const joinerDarkMode = joinerCollection.modes.find(
      (mode) => stableIdForMode(mode) === darkModeStableId
    )
    expect(joinerDarkMode).toBeDefined()
    if (joinerDarkMode === undefined) return
    expect(joinerDarkMode.name).toBe('Night')
    expect(joinerCollection.defaultModeId).toBe(joinerDarkMode.modeId)
  })

  test('live mode add duplicate and remove propagate variable mode values', () => {
    const hostStore = createTestStore()
    const collection = hostStore.graph.createCollection('Themes')
    const variable = hostStore.graph.createVariable('Gap', 'FLOAT', collection.id, 8)
    const { hostYdoc, hostSync, joinerStore, joinerYdoc } = syncHostToJoiner(hostStore)

    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)
    const darkModeId = hostStore.graph.generateNodeId()
    hostStore.graph.addMode(collection.id, darkModeId, 'Dark')
    encodeAndApply(hostYdoc, joinerYdoc)

    let joinerCollection = [...joinerStore.graph.variableCollections.values()][0]
    let joinerVariable = [...joinerStore.graph.variables.values()][0]
    const darkStableId = stableIdForMode(
      collection.modes.find((mode) => mode.modeId === darkModeId) ?? collection.modes[0]
    )
    const joinerDarkMode = joinerCollection.modes.find(
      (mode) => stableIdForMode(mode) === darkStableId
    )
    expect(joinerDarkMode).toBeDefined()
    if (joinerDarkMode === undefined) return
    expect(joinerVariable.valuesByMode[joinerDarkMode.modeId]).toBe(8)

    hostStore.graph.updateVariableValue(variable.id, darkModeId, 16)
    const copyModeId = hostStore.graph.generateNodeId()
    hostStore.graph.addMode(collection.id, copyModeId, 'Dark copy', darkModeId)
    encodeAndApply(hostYdoc, joinerYdoc)

    joinerCollection = [...joinerStore.graph.variableCollections.values()][0]
    joinerVariable = [...joinerStore.graph.variables.values()][0]
    const copyStableId = stableIdForMode(
      collection.modes.find((mode) => mode.modeId === copyModeId) ?? collection.modes[0]
    )
    const joinerCopyMode = joinerCollection.modes.find(
      (mode) => stableIdForMode(mode) === copyStableId
    )
    expect(joinerCopyMode).toBeDefined()
    if (joinerCopyMode === undefined) return
    expect(joinerVariable.valuesByMode[joinerCopyMode.modeId]).toBe(16)

    hostStore.graph.removeMode(collection.id, darkModeId)
    encodeAndApply(hostYdoc, joinerYdoc)
    unbind()

    joinerCollection = [...joinerStore.graph.variableCollections.values()][0]
    joinerVariable = [...joinerStore.graph.variables.values()][0]
    expect(joinerCollection.modes.some((mode) => stableIdForMode(mode) === darkStableId)).toBe(
      false
    )
    expect(Object.hasOwn(joinerVariable.valuesByMode, joinerDarkMode.modeId)).toBe(false)
    expect(joinerVariable.valuesByMode[joinerCopyMode.modeId]).toBe(16)
  })

  test('FigmaAPI variable value updates propagate through graph events', () => {
    const hostStore = createTestStore()
    const collection = hostStore.graph.createCollection('Themes')
    const variable = hostStore.graph.createVariable('Gap', 'FLOAT', collection.id, 8)
    const { hostYdoc, hostSync, joinerStore, joinerYdoc } = syncHostToJoiner(hostStore)

    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)
    const figma = new FigmaAPI(hostStore.graph)
    figma.setVariableValue(variable.id, collection.defaultModeId, 12)
    encodeAndApply(hostYdoc, joinerYdoc)
    unbind()

    const joinerCollection = [...joinerStore.graph.variableCollections.values()][0]
    const joinerVariable = [...joinerStore.graph.variables.values()][0]
    expect(joinerVariable.valuesByMode[joinerCollection.defaultModeId]).toBe(12)
  })

  test('out-of-order variable aliases resolve when the target variable arrives later', () => {
    const store = createTestStore()
    const ydoc = new Y.Doc()
    const sync = createTestYjsSync(store, ydoc)
    observeTargetDoc(store, ydoc, sync.applyYjsToGraph, sync.reconcileRoot)
    const collectionStableId = 'collection:alias-order'
    const modeStableId = 'mode:alias-order'
    const aliasStableId = 'variable:alias-before-target'
    const targetStableId = 'variable:target-after-alias'
    sync.ycollections.set(
      collectionStableId,
      createRemoteCollectionMap(collectionStableId, modeStableId, [aliasStableId, targetStableId])
    )
    sync.yvariables.set(
      aliasStableId,
      createRemoteVariableMap(
        aliasStableId,
        collectionStableId,
        { [modeStableId]: { aliasId: targetStableId } },
        'Alias'
      )
    )
    const state = store.graph.getSyncState()
    const aliasLocalId = state.variableToLocal.get(aliasStableId)
    const localModeId = state.modeToLocal.get(collectionStableId)?.get(modeStableId)
    expect(aliasLocalId).toBeDefined()
    expect(localModeId).toBeDefined()
    if (aliasLocalId === undefined || localModeId === undefined) return
    const aliasVariable = store.graph.variables.get(aliasLocalId)
    expect(aliasVariable?.valuesByMode[localModeId]).toEqual({ aliasId: targetStableId })
    expect(
      [...(state.pendingVariableAliases.get(targetStableId) ?? [])].some(
        (entry) => entry.variableStableId === aliasStableId && entry.modeStableId === modeStableId
      )
    ).toBe(true)

    sync.yvariables.set(
      targetStableId,
      createRemoteVariableMap(targetStableId, collectionStableId, { [modeStableId]: 42 }, 'Target')
    )

    const targetLocalId = state.variableToLocal.get(targetStableId)
    expect(targetLocalId).toBeDefined()
    expect(aliasVariable?.valuesByMode[localModeId]).toEqual({ aliasId: targetLocalId })
    expect(state.pendingVariableAliases.has(targetStableId)).toBe(false)
    expect(store.graph.resolveVariable(aliasLocalId, localModeId)).toBe(42)
    expect(state.pendingVariableCollections.has(collectionStableId)).toBe(false)
  })

  test('pending variable aliases clear when the source updates away from a missing target', () => {
    const store = createTestStore()
    const ydoc = new Y.Doc()
    const sync = createTestYjsSync(store, ydoc)
    observeTargetDoc(store, ydoc, sync.applyYjsToGraph, sync.reconcileRoot)
    const collectionStableId = 'collection:alias-source-update'
    const modeStableId = 'mode:alias-source-update'
    const aliasStableId = 'variable:alias-source-update'
    const targetStableId = 'variable:target-never-arrived'
    sync.ycollections.set(
      collectionStableId,
      createRemoteCollectionMap(collectionStableId, modeStableId, [aliasStableId])
    )
    sync.yvariables.set(
      aliasStableId,
      createRemoteVariableMap(
        aliasStableId,
        collectionStableId,
        { [modeStableId]: { aliasId: targetStableId } },
        'Alias'
      )
    )

    const state = store.graph.getSyncState()
    expect(state.pendingVariableAliases.has(targetStableId)).toBe(true)

    sync.yvariables.set(
      aliasStableId,
      createRemoteVariableMap(aliasStableId, collectionStableId, { [modeStableId]: 7 }, 'Alias')
    )

    const aliasLocalId = state.variableToLocal.get(aliasStableId)
    const localModeId = state.modeToLocal.get(collectionStableId)?.get(modeStableId)
    expect(aliasLocalId).toBeDefined()
    expect(localModeId).toBeDefined()
    if (aliasLocalId === undefined || localModeId === undefined) return
    expect(store.graph.variables.get(aliasLocalId)?.valuesByMode[localModeId]).toBe(7)
    expect(state.pendingVariableAliases.has(targetStableId)).toBe(false)
  })

  test('live collection deletion removes collection variables and sync mappings', () => {
    const hostStore = createTestStore()
    const collection = hostStore.graph.createCollection('Obsolete')
    const variable = hostStore.graph.createVariable('Token', 'FLOAT', collection.id, 8)
    const collectionStableId = stableIdForCollection(collection)
    const variableStableId = stableIdForVariable(variable)

    const hostYdoc = new Y.Doc()
    const hostSync = createTestYjsSync(hostStore, hostYdoc)
    makeHostRootState(hostStore)
    hostSync.syncAllNodesToYjs()

    const joinerStore = createTestStore()
    const joinerYdoc = new Y.Doc()
    const joinerSync = createTestYjsSync(joinerStore, joinerYdoc)
    observeTargetDoc(joinerStore, joinerYdoc, joinerSync.applyYjsToGraph, joinerSync.reconcileRoot)
    encodeAndApply(hostYdoc, joinerYdoc)
    const joinerCollectionId = [...joinerStore.graph.variableCollections.values()][0]?.id
    const joinerVariableId = [...joinerStore.graph.variables.values()][0]?.id
    expect(joinerCollectionId).toBeDefined()
    expect(joinerVariableId).toBeDefined()
    if (joinerCollectionId === undefined || joinerVariableId === undefined) return

    const unbind = bindHostGraphEvents(hostStore, hostYdoc, hostSync)
    hostStore.graph.removeCollection(collection.id)
    encodeAndApply(hostYdoc, joinerYdoc)
    unbind()

    const hostState = hostStore.graph.getSyncState()
    expect(hostState.localToCollection.has(collection.id)).toBe(false)
    expect(hostState.collectionToLocal.has(collectionStableId)).toBe(false)
    expect(hostState.localToVariable.has(variable.id)).toBe(false)
    expect(hostState.variableToLocal.has(variableStableId)).toBe(false)

    expect(joinerStore.graph.variableCollections.size).toBe(0)
    expect(joinerStore.graph.variables.size).toBe(0)
    const state = joinerStore.graph.getSyncState()
    expect(state.collectionToLocal.has(collectionStableId)).toBe(false)
    expect(state.localToCollection.has(joinerCollectionId)).toBe(false)
    expect(state.variableToLocal.has(variableStableId)).toBe(false)
    expect(state.localToVariable.has(joinerVariableId)).toBe(false)
    expect(state.modeToLocal.has(collectionStableId)).toBe(false)
    expect(state.pendingVariableCollections.has(collectionStableId)).toBe(false)
    expect(state.pendingVariableBindings.has(variableStableId)).toBe(false)
  })
})
