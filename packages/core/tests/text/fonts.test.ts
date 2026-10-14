import { expect, test } from 'bun:test'

import { FontManager } from '@open-pencil/core/text'

/** A font manager that asks no web provider, so a family's faces come from its catalog. */
function offlineManager() {
  const manager = new FontManager()
  manager.setOnlineFontProviders({})
  return manager
}

test('a face lookup that outlives a new catalog does not overwrite what the catalog says', async () => {
  const manager = offlineManager()
  const before = manager.familyFaces('Oswald')
  manager.setHostFontCatalog([{ family: 'Oswald', styles: ['Regular', 'Bold'] }])
  expect(await before).toBeNull()
  expect(manager.loadedFamilyFaces('Oswald')).toBeUndefined()
  expect(await manager.familyFaces('Oswald')).toEqual([
    { weight: 400, italic: false },
    { weight: 700, italic: false }
  ])
})

test('a new catalog tells listeners to ask for their families again', () => {
  const manager = offlineManager()
  let resets = 0
  const stop = manager.onFamilyFacesReset(() => resets++)
  manager.setHostFontCatalog([{ family: 'Oswald', styles: ['Regular'] }])
  stop()
  manager.setHostFontCatalog([])
  expect(resets).toBe(1)
})
