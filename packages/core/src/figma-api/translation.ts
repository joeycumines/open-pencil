export function composeTranslation(
  previous: ReadonlyMap<string, string>,
  incoming?: ReadonlyMap<string, string>
): Map<string, string> {
  if (!incoming || incoming.size === 0) return new Map()

  const composed = new Map<string, string>()
  for (const [originalId, currentId] of previous) {
    if (!incoming.has(currentId)) continue
    const nextId = incoming.get(currentId)
    if (nextId !== undefined) composed.set(originalId, nextId)
  }
  return composed
}

function invalidRuntimeId(id: string, generation: number): string {
  return `\u0000removed:${generation}:${id}`
}

const INVALID_UNMAPPED_RUNTIME_ID = '\u0000removed:*'

function collectReusedTargets(incoming: ReadonlyMap<string, string>): Set<string> {
  const reused = new Set<string>()
  for (const targetId of incoming.values()) {
    if (!incoming.has(targetId)) reused.add(targetId)
  }
  return reused
}

function composeInvalidRuntimeIds(
  previous: ReadonlySet<string> | undefined,
  reusedTargets: ReadonlySet<string>,
  brokenOriginalIds: ReadonlySet<string>,
  invalidateUnmapped: boolean
): Set<string> {
  const next = new Set(previous)
  if (invalidateUnmapped) next.add(INVALID_UNMAPPED_RUNTIME_ID)
  for (const id of reusedTargets) next.add(id)
  for (const id of brokenOriginalIds) next.add(id)
  return next
}

function collectBrokenOriginalIds(
  previous: ReadonlyMap<string, string>,
  incoming: ReadonlyMap<string, string>
): Set<string> {
  const broken = new Set<string>()
  for (const [originalId, currentId] of previous) {
    if (!incoming.has(currentId)) broken.add(originalId)
  }
  return broken
}

export interface RuntimeTranslationsByGeneration {
  translations: Map<number, Map<string, string>>
  invalidRuntimeIds: Map<number, Set<string>>
}

export function composeTranslationsByGeneration(
  previousByGeneration: ReadonlyMap<number, Map<string, string>>,
  previousInvalidByGeneration: ReadonlyMap<number, Set<string>>,
  currentGeneration: number,
  incoming?: Map<string, string>
): RuntimeTranslationsByGeneration {
  if (!incoming || incoming.size === 0) {
    const translations = new Map<number, Map<string, string>>()
    const invalidRuntimeIds = new Map<number, Set<string>>()
    const generations = new Set([
      ...previousByGeneration.keys(),
      ...previousInvalidByGeneration.keys()
    ])
    for (const generation of generations) {
      translations.set(generation, new Map())
      const invalidIds = previousInvalidByGeneration.get(generation)
      invalidRuntimeIds.set(
        generation,
        composeInvalidRuntimeIds(
          invalidIds,
          new Set(),
          new Set(previousByGeneration.get(generation)?.keys()),
          false
        )
      )
    }
    translations.set(currentGeneration, new Map())
    invalidRuntimeIds.set(
      currentGeneration,
      composeInvalidRuntimeIds(undefined, new Set(), new Set(), true)
    )
    return {
      translations,
      invalidRuntimeIds
    }
  }

  const reusedTargets = collectReusedTargets(incoming)
  const translations = new Map<number, Map<string, string>>()
  const invalidRuntimeIds = new Map<number, Set<string>>()
  for (const [generation, previous] of previousByGeneration) {
    translations.set(generation, composeTranslation(previous, incoming))
    invalidRuntimeIds.set(
      generation,
      composeInvalidRuntimeIds(
        previousInvalidByGeneration.get(generation),
        reusedTargets,
        collectBrokenOriginalIds(previous, incoming),
        false
      )
    )
  }
  translations.set(currentGeneration, new Map(incoming))
  invalidRuntimeIds.set(
    currentGeneration,
    composeInvalidRuntimeIds(undefined, reusedTargets, new Set(), true)
  )
  return { translations, invalidRuntimeIds }
}

export function translateRuntimeIdForGeneration(
  id: string,
  generation: number,
  translationsByGeneration: ReadonlyMap<number, ReadonlyMap<string, string>>,
  invalidRuntimeIdsByGeneration: ReadonlyMap<number, ReadonlySet<string>>
): string {
  const translation = translationsByGeneration.get(generation)
  const translatedId = translation?.get(id)
  if (translatedId !== undefined) return translatedId
  const invalidIds = invalidRuntimeIdsByGeneration.get(generation)
  if (invalidIds?.has(id) || invalidIds?.has(INVALID_UNMAPPED_RUNTIME_ID)) {
    return invalidRuntimeId(id, generation)
  }
  return id
}

export function translateRuntimeIdFromAnyGeneration(
  id: string,
  translationsByGeneration: ReadonlyMap<number, ReadonlyMap<string, string>>,
  invalidRuntimeIdsByGeneration: ReadonlyMap<number, ReadonlySet<string>>
): string {
  const newestGeneration = [...translationsByGeneration.keys()].sort((a, b) => b - a)
  for (const knownGeneration of newestGeneration) {
    const translation = translationsByGeneration.get(knownGeneration)
    const translatedId = translation?.get(id)
    if (translatedId !== undefined) return translatedId
  }
  for (const knownGeneration of newestGeneration) {
    if (invalidRuntimeIdsByGeneration.get(knownGeneration)?.has(id)) {
      return invalidRuntimeId(id, knownGeneration)
    }
  }
  for (const knownGeneration of newestGeneration) {
    if (invalidRuntimeIdsByGeneration.get(knownGeneration)?.has(INVALID_UNMAPPED_RUNTIME_ID)) {
      return invalidRuntimeId(id, knownGeneration)
    }
  }
  return id
}
