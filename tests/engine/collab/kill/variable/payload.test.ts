import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  applyYjsCollectionsToGraph,
  applyYjsVariablesToGraph,
  applyCollectionToGraph,
  applyVariableToGraph,
  syncCollectionToYjs,
  syncVariableToYjs
} from '@/app/collab/yjs-sync'

import {
  createRemoteCollectionMap,
  createRemoteVariableMap,
  createTestStore
} from '#tests/engine/collab/helpers'

describe('remote variable and collection payload validation', () => {
  test('malformed collection fields are sanitized before graph storage and outbound sync', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:malformed'
    const modeStableId = 'mode:remote'
    const maliciousName = new Y.Map<unknown>()
    const ycol = new Y.Map<unknown>()
    ycollections.set(collectionStableId, ycol)
    ycol.set('name', maliciousName)
    ycol.set('defaultModeId', modeStableId)
    ycol.set(
      'modes',
      JSON.stringify([
        {
          modeId: modeStableId,
          name: { bad: true },
          sourceId: { bad: true },
          sourceFormat: 'not-fig'
        }
      ])
    )
    ycol.set('variableIds', JSON.stringify(['variable:missing', 42]))
    ycol.set('sourceId', new Y.Map<unknown>())
    ycol.set('sourceFormat', 'not-fig')

    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const localCollectionId = state.collectionToLocal.get(collectionStableId)
    expect(localCollectionId).toBeDefined()
    if (localCollectionId === undefined) return
    const collection = graph.variableCollections.get(localCollectionId)
    expect(collection).toBeDefined()
    if (collection === undefined) return

    expect(collection.name).toBe('Collection')
    expect(collection.modes).toHaveLength(1)
    expect(collection.modes[0].name).toBe('Mode')
    expect(collection.modes[0].source?.id).toBe(modeStableId)
    expect(collection.modes[0].source?.format).toBeNull()
    expect(collection.source?.id).toBe(collectionStableId)
    expect(collection.source?.format).toBeNull()
    expect(collection.variableIds).toEqual([])
    expect(() => syncCollectionToYjs(graph, state, ycollections, collection)).not.toThrow()

    const resynced = ycollections.get(collectionStableId)
    expect(resynced?.get('name')).toBe('Collection')
    expect(resynced?.get('sourceId')).toBe(collectionStableId)
    expect(String(resynced?.get('modes'))).not.toContain('_map')
  })

  test('malformed variable fields are sanitized before graph storage and outbound sync', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:valid'
    const modeStableId = 'mode:valid'
    const ycol = createRemoteCollectionMap(collectionStableId, modeStableId)
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const variableStableId = 'variable:malformed'
    const yvar = new Y.Map<unknown>()
    yvariables.set(variableStableId, yvar)
    yvar.set('name', ['bad'])
    yvar.set('type', 'NOT_A_VARIABLE_TYPE')
    yvar.set('description', { bad: true })
    yvar.set('hiddenFromPublishing', 'yes')
    yvar.set('collectionId', collectionStableId)
    yvar.set('sourceId', new Y.Map<unknown>())
    yvar.set('sourceFormat', 'not-fig')
    yvar.set('key', new Y.Map<unknown>())
    yvar.set('version', ['bad'])
    yvar.set(
      'valuesByMode',
      JSON.stringify({
        [modeStableId]: { bogus: 'value' }
      })
    )

    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    const localVariableId = state.variableToLocal.get(variableStableId)
    expect(localVariableId).toBeDefined()
    if (localVariableId === undefined) return
    const variable = graph.variables.get(localVariableId)
    expect(variable).toBeDefined()
    if (variable === undefined) return

    expect(variable.name).toBe('Variable')
    expect(variable.type).toBe('COLOR')
    expect(variable.description).toBe('')
    expect(variable.hiddenFromPublishing).toBe(false)
    expect(variable.source?.id).toBe(variableStableId)
    expect(variable.source?.format).toBeNull()
    expect(variable.key).toBeUndefined()
    expect(variable.version).toBeUndefined()
    expect(variable.valuesByMode).toEqual({})
    expect(() => syncVariableToYjs(graph, state, yvariables, variable)).not.toThrow()

    const resynced = yvariables.get(variableStableId)
    expect(resynced?.get('name')).toBe('Variable')
    expect(resynced?.get('type')).toBe('COLOR')
    expect(resynced?.get('hiddenFromPublishing')).toBe(false)
    expect(resynced?.get('valuesByMode')).toBe('{}')
  })

  test('malformed existing variable valuesByMode updates do not erase valid values', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:existing-variable'
    const modeStableId = 'mode:existing-variable'
    const variableStableId = 'variable:existing-values'
    const ycol = createRemoteCollectionMap(collectionStableId, modeStableId, [variableStableId])
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const validColor = { r: 0.1, g: 0.2, b: 0.3, a: 1 }
    const yvar = createRemoteVariableMap(variableStableId, collectionStableId, {
      [modeStableId]: validColor
    })
    yvar.set('type', 'COLOR')
    yvariables.set(variableStableId, yvar)
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    const localVariableId = state.variableToLocal.get(variableStableId)
    expect(localVariableId).toBeDefined()
    if (localVariableId === undefined) return
    const variable = graph.variables.get(localVariableId)
    expect(variable).toBeDefined()
    if (variable === undefined) return
    const before = { ...variable.valuesByMode }

    let events: Y.YEvent<Y.Map<unknown>>[] = []
    yvariables.observeDeep((nextEvents) => {
      events = nextEvents
    })
    yvar.set('valuesByMode', JSON.stringify({ [modeStableId]: { r: 0.1, g: null, b: 0.3, a: 1 } }))
    applyYjsVariablesToGraph(graph, state, yvariables, events)

    expect(variable.valuesByMode).toEqual(before)
    expect(() => syncVariableToYjs(graph, state, yvariables, variable)).not.toThrow()
    expect(yvariables.get(variableStableId)?.get('valuesByMode')).toBe(
      JSON.stringify({ [modeStableId]: validColor })
    )
  })

  test('malformed existing collection modes updates do not collapse valid modes', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:existing-modes'
    const modeAStableId = 'mode:a'
    const modeBStableId = 'mode:b'
    const ycol = createRemoteCollectionMap(collectionStableId, modeAStableId)
    ycol.set(
      'modes',
      JSON.stringify([
        { modeId: modeAStableId, name: 'A', sourceId: modeAStableId, sourceFormat: null },
        { modeId: modeBStableId, name: 'B', sourceId: modeBStableId, sourceFormat: null }
      ])
    )
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const localCollectionId = state.collectionToLocal.get(collectionStableId)
    expect(localCollectionId).toBeDefined()
    if (localCollectionId === undefined) return
    const collection = graph.variableCollections.get(localCollectionId)
    expect(collection).toBeDefined()
    if (collection === undefined) return
    const modeNamesBefore = collection.modes.map((mode) => mode.name)

    let events: Y.YEvent<Y.Map<unknown>>[] = []
    ycollections.observeDeep((nextEvents) => {
      events = nextEvents
    })
    ycol.set('modes', 'not-json')
    applyYjsCollectionsToGraph(graph, state, ycollections, yvariables, events)

    expect(collection.modes.map((mode) => mode.name)).toEqual(modeNamesBefore)
    expect(collection.modes).toHaveLength(2)
    expect(() => syncCollectionToYjs(graph, state, ycollections, collection)).not.toThrow()
    const resyncedModes = String(ycollections.get(collectionStableId)?.get('modes'))
    expect(resyncedModes).toContain('"name":"A"')
    expect(resyncedModes).toContain('"name":"B"')
  })

  test('malformed existing scalar and mode subfield updates preserve valid state', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:existing-scalars'
    const modeAStableId = 'mode:scalar-a'
    const modeBStableId = 'mode:scalar-b'
    const variableStableId = 'variable:existing-scalars'
    const ycol = createRemoteCollectionMap(collectionStableId, modeAStableId, [variableStableId])
    ycol.set('name', 'Tokens')
    ycol.set(
      'modes',
      JSON.stringify([
        { modeId: modeAStableId, name: 'A', sourceId: modeAStableId, sourceFormat: null },
        { modeId: modeBStableId, name: 'B', sourceId: modeBStableId, sourceFormat: null }
      ])
    )
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const yvar = createRemoteVariableMap(
      variableStableId,
      collectionStableId,
      { [modeAStableId]: 8 },
      'Gap'
    )
    yvariables.set(variableStableId, yvar)
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    const collectionId = state.collectionToLocal.get(collectionStableId)
    const variableId = state.variableToLocal.get(variableStableId)
    expect(collectionId).toBeDefined()
    expect(variableId).toBeDefined()
    if (collectionId === undefined || variableId === undefined) return
    const collection = graph.variableCollections.get(collectionId)
    const variable = graph.variables.get(variableId)
    expect(collection).toBeDefined()
    expect(variable).toBeDefined()
    if (collection === undefined || variable === undefined) return

    let collectionEvents: Y.YEvent<Y.Map<unknown>>[] = []
    ycollections.observeDeep((nextEvents) => {
      collectionEvents = nextEvents
    })
    ycol.set('name', new Y.Map<unknown>())
    ycol.set(
      'modes',
      JSON.stringify([
        { modeId: modeAStableId, name: { bad: true }, sourceId: modeAStableId, sourceFormat: null },
        { modeId: modeBStableId, name: 'B', sourceId: modeBStableId, sourceFormat: null }
      ])
    )
    applyYjsCollectionsToGraph(graph, state, ycollections, yvariables, collectionEvents)

    expect(collection.name).toBe('Tokens')
    expect(collection.modes.map((mode) => mode.name)).toEqual(['A', 'B'])
    syncCollectionToYjs(graph, state, ycollections, collection)
    expect(ycollections.get(collectionStableId)?.get('name')).toBe('Tokens')
    const resyncedModes = String(ycollections.get(collectionStableId)?.get('modes'))
    expect(resyncedModes).toContain('"name":"A"')
    expect(resyncedModes).not.toContain('"name":"Mode"')

    let variableEvents: Y.YEvent<Y.Map<unknown>>[] = []
    yvariables.observeDeep((nextEvents) => {
      variableEvents = nextEvents
    })
    yvar.set('name', new Y.Map<unknown>())
    applyYjsVariablesToGraph(graph, state, yvariables, variableEvents)

    expect(variable.name).toBe('Gap')
    syncVariableToYjs(graph, state, yvariables, variable)
    expect(yvariables.get(variableStableId)?.get('name')).toBe('Gap')
  })

  test('malformed existing variable collectionId does not poison pending queues', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:existing-collection-id'
    const modeStableId = 'mode:existing-collection-id'
    const variableStableId = 'variable:existing-collection-id'
    const ycol = createRemoteCollectionMap(collectionStableId, modeStableId, [variableStableId])
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const yvar = createRemoteVariableMap(variableStableId, collectionStableId, {
      [modeStableId]: 4
    })
    yvariables.set(variableStableId, yvar)
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    const variableId = state.variableToLocal.get(variableStableId)
    expect(variableId).toBeDefined()
    if (variableId === undefined) return
    const variable = graph.variables.get(variableId)
    expect(variable).toBeDefined()
    if (variable === undefined) return
    const collectionIdBefore = variable.collectionId

    let events: Y.YEvent<Y.Map<unknown>>[] = []
    yvariables.observeDeep((nextEvents) => {
      events = nextEvents
    })
    yvar.set('collectionId', new Y.Map<unknown>())
    applyYjsVariablesToGraph(graph, state, yvariables, events)

    expect(variable.collectionId).toBe(collectionIdBefore)
    expect([...state.pendingVariableCollections.keys()]).not.toContain('')
    expect(state.pendingVariableCollections.size).toBe(0)

    yvar.set('collectionId', '')
    applyYjsVariablesToGraph(graph, state, yvariables, events)

    expect(variable.collectionId).toBe(collectionIdBefore)
    expect([...state.pendingVariableCollections.keys()]).not.toContain('')
    expect(state.pendingVariableCollections.size).toBe(0)
  })

  test('existing variable ignores cross-collection values instead of storing foreign mode ids', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionAStableId = 'collection:cross-a'
    const collectionBStableId = 'collection:cross-b'
    const modeAStableId = 'mode:cross-a'
    const modeBStableId = 'mode:cross-b'
    const variableStableId = 'variable:cross-collection'

    const ycolA = createRemoteCollectionMap(collectionAStableId, modeAStableId, [variableStableId])
    const ycolB = createRemoteCollectionMap(collectionBStableId, modeBStableId)
    ycollections.set(collectionAStableId, ycolA)
    ycollections.set(collectionBStableId, ycolB)
    applyCollectionToGraph(graph, state, yvariables, collectionAStableId, ycolA)
    applyCollectionToGraph(graph, state, yvariables, collectionBStableId, ycolB)
    const yvar = createRemoteVariableMap(variableStableId, collectionAStableId, {
      [modeAStableId]: 4
    })
    yvariables.set(variableStableId, yvar)
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    const variableId = state.variableToLocal.get(variableStableId)
    const collectionAId = state.collectionToLocal.get(collectionAStableId)
    const collectionBId = state.collectionToLocal.get(collectionBStableId)
    expect(variableId).toBeDefined()
    expect(collectionAId).toBeDefined()
    expect(collectionBId).toBeDefined()
    if (variableId === undefined || collectionAId === undefined || collectionBId === undefined)
      return
    const variable = graph.variables.get(variableId)
    const collectionB = graph.variableCollections.get(collectionBId)
    expect(variable).toBeDefined()
    expect(collectionB).toBeDefined()
    if (variable === undefined || collectionB === undefined) return
    const valuesBefore = { ...variable.valuesByMode }
    const foreignLocalModeId = collectionB.modes[0].modeId

    yvar.set('collectionId', collectionBStableId)
    yvar.set('valuesByMode', JSON.stringify({ [modeBStableId]: 99 }))
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    expect(variable.collectionId).toBe(collectionAId)
    expect(variable.valuesByMode).toEqual(valuesBefore)
    expect(variable.valuesByMode[foreignLocalModeId]).toBeUndefined()
    expect(state.pendingVariableCollections.size).toBe(0)
    syncVariableToYjs(graph, state, yvariables, variable)
    expect(yvariables.get(variableStableId)?.get('collectionId')).toBe(collectionAStableId)
    expect(yvariables.get(variableStableId)?.get('valuesByMode')).toBe(
      JSON.stringify({ [modeAStableId]: 4 })
    )
  })

  test('brand-new malformed collection fallback never emits empty mode stable ids', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:empty-default-fallback'
    const fallbackModeStableId = `${collectionStableId}:default-mode`
    const ycol = new Y.Map<unknown>()
    ycollections.set(collectionStableId, ycol)
    ycol.set('name', 'Remote Collection')
    ycol.set('defaultModeId', '')
    ycol.set('modes', 'not-json')
    ycol.set('variableIds', JSON.stringify([]))
    ycol.set('sourceId', '')
    ycol.set('sourceFormat', null)

    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const collectionId = state.collectionToLocal.get(collectionStableId)
    expect(collectionId).toBeDefined()
    if (collectionId === undefined) return
    const collection = graph.variableCollections.get(collectionId)
    expect(collection).toBeDefined()
    if (collection === undefined) return

    expect(collection.source?.id).toBe(collectionStableId)
    expect(collection.modes).toHaveLength(1)
    expect(collection.modes[0].source?.id).toBe(fallbackModeStableId)
    expect(state.modeToLocal.get(collectionStableId)?.has('')).toBe(false)

    syncCollectionToYjs(graph, state, ycollections, collection)

    const resynced = ycollections.get(collectionStableId)
    expect(resynced?.get('defaultModeId')).toBe(fallbackModeStableId)
    const serializedModes = String(resynced?.get('modes'))
    expect(serializedModes).toContain(`"modeId":"${fallbackModeStableId}"`)
    expect(serializedModes).not.toContain('"modeId":""')
    expect(serializedModes).not.toContain('"sourceId":""')
  })

  test('malformed existing defaultModeId cannot orphan default or active modes', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:existing-default-mode'
    const modeAStableId = 'mode:existing-default-a'
    const modeBStableId = 'mode:existing-default-b'
    const ycol = createRemoteCollectionMap(collectionStableId, modeAStableId)
    ycol.set(
      'modes',
      JSON.stringify([
        { modeId: modeAStableId, name: 'A', sourceId: modeAStableId, sourceFormat: null },
        { modeId: modeBStableId, name: 'B', sourceId: modeBStableId, sourceFormat: null }
      ])
    )
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const collectionId = state.collectionToLocal.get(collectionStableId)
    expect(collectionId).toBeDefined()
    if (collectionId === undefined) return
    const collection = graph.variableCollections.get(collectionId)
    expect(collection).toBeDefined()
    if (collection === undefined) return
    const defaultModeIdBefore = collection.defaultModeId
    const activeModeIdBefore = graph.activeMode.get(collection.id)
    const stableModeIdsBefore = collection.modes.map((mode) => mode.source?.id)

    let events: Y.YEvent<Y.Map<unknown>>[] = []
    ycollections.observeDeep((nextEvents) => {
      events = nextEvents
    })
    ycol.set('defaultModeId', '')
    ycol.set(
      'modes',
      JSON.stringify([
        { modeId: modeBStableId, name: 'B changed', sourceId: modeBStableId, sourceFormat: null }
      ])
    )
    applyYjsCollectionsToGraph(graph, state, ycollections, yvariables, events)

    expect(collection.defaultModeId).toBe(defaultModeIdBefore)
    expect(graph.activeMode.get(collection.id)).toBe(activeModeIdBefore)
    expect(collection.modes.map((mode) => mode.source?.id)).toEqual(stableModeIdsBefore)
    expect(collection.modes.some((mode) => mode.modeId === collection.defaultModeId)).toBe(true)
    const activeModeId = graph.activeMode.get(collection.id)
    expect(collection.modes.some((mode) => mode.modeId === activeModeId)).toBe(true)
  })

  test('duplicate remote mode stable ids are rejected before collection mutation', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:duplicate-modes'
    const modeAStableId = 'mode:duplicate-a'
    const modeBStableId = 'mode:duplicate-b'
    const ycol = createRemoteCollectionMap(collectionStableId, modeAStableId)
    ycol.set(
      'modes',
      JSON.stringify([
        { modeId: modeAStableId, name: 'A', sourceId: modeAStableId, sourceFormat: null },
        { modeId: modeBStableId, name: 'B', sourceId: modeBStableId, sourceFormat: null }
      ])
    )
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const collectionId = state.collectionToLocal.get(collectionStableId)
    expect(collectionId).toBeDefined()
    if (collectionId === undefined) return
    const collection = graph.variableCollections.get(collectionId)
    expect(collection).toBeDefined()
    if (collection === undefined) return
    const modeStableIdsBefore = collection.modes.map((mode) => mode.source?.id)
    const localModeIdsBefore = collection.modes.map((mode) => mode.modeId)

    let events: Y.YEvent<Y.Map<unknown>>[] = []
    ycollections.observeDeep((nextEvents) => {
      events = nextEvents
    })
    ycol.set(
      'modes',
      JSON.stringify([
        { modeId: modeBStableId, name: 'B', sourceId: modeBStableId, sourceFormat: null },
        { modeId: modeBStableId, name: 'B duplicate', sourceId: modeBStableId, sourceFormat: null }
      ])
    )
    applyYjsCollectionsToGraph(graph, state, ycollections, yvariables, events)

    expect(collection.modes.map((mode) => mode.source?.id)).toEqual(modeStableIdsBefore)
    expect(collection.modes.map((mode) => mode.modeId)).toEqual(localModeIdsBefore)
    expect(new Set(collection.modes.map((mode) => mode.modeId)).size).toBe(collection.modes.length)
    syncCollectionToYjs(graph, state, ycollections, collection)
    expect(ycollections.get(collectionStableId)?.get('modes')).toBe(
      JSON.stringify([
        { modeId: modeAStableId, name: 'A', sourceId: modeAStableId, sourceFormat: null },
        { modeId: modeBStableId, name: 'B', sourceId: modeBStableId, sourceFormat: null }
      ])
    )
  })

  test('duplicate remote variableIds are rejected before collection membership mutation', () => {
    const store = createTestStore()
    const graph = store.graph
    const state = graph.getSyncState()
    const ydoc = new Y.Doc()
    const yvariables = ydoc.getMap<Y.Map<unknown>>('variables')
    const ycollections = ydoc.getMap<Y.Map<unknown>>('collections')
    const collectionStableId = 'collection:duplicate-variable-ids'
    const modeStableId = 'mode:duplicate-variable-ids'
    const variableStableId = 'variable:duplicate-membership'
    const ycol = createRemoteCollectionMap(collectionStableId, modeStableId, [variableStableId])
    ycollections.set(collectionStableId, ycol)
    applyCollectionToGraph(graph, state, yvariables, collectionStableId, ycol)

    const yvar = createRemoteVariableMap(variableStableId, collectionStableId, {
      [modeStableId]: 12
    })
    yvariables.set(variableStableId, yvar)
    applyVariableToGraph(graph, state, yvariables, variableStableId, yvar)

    const collectionId = state.collectionToLocal.get(collectionStableId)
    const variableId = state.variableToLocal.get(variableStableId)
    expect(collectionId).toBeDefined()
    expect(variableId).toBeDefined()
    if (collectionId === undefined || variableId === undefined) return
    const collection = graph.variableCollections.get(collectionId)
    expect(collection).toBeDefined()
    if (collection === undefined) return
    expect(collection.variableIds).toEqual([variableId])

    let events: Y.YEvent<Y.Map<unknown>>[] = []
    ycollections.observeDeep((nextEvents) => {
      events = nextEvents
    })
    ycol.set('variableIds', JSON.stringify([variableStableId, variableStableId]))
    applyYjsCollectionsToGraph(graph, state, ycollections, yvariables, events)

    expect(collection.variableIds).toEqual([variableId])
    syncCollectionToYjs(graph, state, ycollections, collection)
    expect(ycollections.get(collectionStableId)?.get('variableIds')).toBe(
      JSON.stringify([variableStableId])
    )
  })
})
