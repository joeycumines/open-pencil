import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { stableIdForVariable } from '@/app/collab/yjs-sync'

import {
  createTestStore,
  createTestYjsSync,
  encodeAndApply,
  makeHostRootState,
  observeTargetDoc
} from '#tests/engine/collab/helpers'

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

    // Joiner should now have the collection and variable
    expect(joinerStore.graph.variableCollections.size).toBe(1)
    expect(joinerStore.graph.variables.size).toBe(1)

    // The collection name should match
    const joinerCollections = [...joinerStore.graph.variableCollections.values()]
    expect(joinerCollections[0].name).toBe('Tokens')

    // The variable name and type should match
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
})
