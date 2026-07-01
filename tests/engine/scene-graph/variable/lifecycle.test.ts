import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

describe('scene graph variable lifecycle events', () => {
  test('emits variable and collection lifecycle updates for graph APIs', () => {
    const graph = new SceneGraph()
    const events: string[] = []

    const unbind = graph.onNodeEvents({
      variableCreated: (variable) => events.push(`variable:created:${variable.name}`),
      variableUpdated: (variable) => events.push(`variable:updated:${variable.name}`),
      variableDeleted: (id) => events.push(`variable:deleted:${id}`),
      collectionCreated: (collection) => events.push(`collection:created:${collection.name}`),
      collectionUpdated: (collection) => events.push(`collection:updated:${collection.name}`),
      collectionDeleted: (id) => events.push(`collection:deleted:${id}`)
    })

    const collection = graph.createCollection('Tokens')
    const variable = graph.createVariable('Spacing', 'FLOAT', collection.id, 8)
    const secondModeId = graph.generateNodeId()

    graph.renameVariable(variable.id, 'Gap')
    graph.updateVariableValue(variable.id, collection.defaultModeId, 12)
    graph.renameCollection(collection.id, 'Design tokens')
    graph.addMode(collection.id, secondModeId, 'Compact')
    graph.renameMode(collection.id, secondModeId, 'Dense')
    graph.setDefaultMode(collection.id, secondModeId)
    graph.removeMode(collection.id, collection.modes[0]?.modeId ?? '')
    graph.removeVariable(variable.id)
    graph.removeCollection(collection.id)
    unbind()

    expect(events).toContain('collection:created:Tokens')
    expect(events).toContain('variable:created:Spacing')
    expect(events).toContain('variable:updated:Gap')
    expect(events).toContain('collection:updated:Design tokens')
    expect(events.filter((event) => event === 'collection:updated:Design tokens').length).toBe(5)
    expect(
      events.filter((event) => event === 'variable:updated:Gap').length
    ).toBeGreaterThanOrEqual(3)
    expect(events).toContain(`variable:deleted:${variable.id}`)
    expect(events).toContain(`collection:deleted:${collection.id}`)
  })
})
