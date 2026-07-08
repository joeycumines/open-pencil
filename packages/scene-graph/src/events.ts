import type { Emitter } from 'nanoevents'

import type { SceneGraphEventHandlers, SceneGraphEvents } from './types'

export function bindNodeEvents(
  emitter: Emitter<SceneGraphEvents>,
  handlers: SceneGraphEventHandlers
): () => void {
  const unbinds = [
    handlers.created ? emitter.on('node:created', handlers.created) : null,
    handlers.updated ? emitter.on('node:updated', handlers.updated) : null,
    handlers.previewUpdated ? emitter.on('node:previewUpdated', handlers.previewUpdated) : null,
    handlers.deleted ? emitter.on('node:deleted', handlers.deleted) : null,
    handlers.reparented ? emitter.on('node:reparented', handlers.reparented) : null,
    handlers.reordered ? emitter.on('node:reordered', handlers.reordered) : null,
    handlers.variableCreated ? emitter.on('variable:created', handlers.variableCreated) : null,
    handlers.variableUpdated ? emitter.on('variable:updated', handlers.variableUpdated) : null,
    handlers.variableDeleted ? emitter.on('variable:deleted', handlers.variableDeleted) : null,
    handlers.collectionCreated
      ? emitter.on('collection:created', handlers.collectionCreated)
      : null,
    handlers.collectionUpdated
      ? emitter.on('collection:updated', handlers.collectionUpdated)
      : null,
    handlers.collectionDeleted ? emitter.on('collection:deleted', handlers.collectionDeleted) : null
  ].filter((unbind): unbind is () => void => !!unbind)

  return () => {
    for (const unbind of unbinds) unbind()
  }
}
