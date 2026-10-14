import { Frame, Instance } from '@open-pencil/design-jsx'

import { variablesRow } from '../chrome'
import { layoutChapter, type Chapter, type ChapterContext } from './chapter'
import { CHAPTERS } from './names'
import type { Player } from './slots'

/** Modes: the same player twice, each frame reading the Theme collection in its own mode. */
export async function createModesChapter(
  context: ChapterContext,
  player: Player
): Promise<Chapter> {
  const { graph, theme } = context
  const stage = (name: string) =>
    Frame({
      name,
      flex: 'col',
      w: 'hug',
      h: 'hug',
      p: 40,
      rounded: 32,
      bg: theme.vars.raised,
      children: [Instance({ of: player.id })]
    })
  const chapter = await layoutChapter(context, {
    chapter: CHAPTERS.modes,
    heading: {
      title: 'It has modes.',
      subtitle:
        'Every color and radius in the player is a variable from one Theme collection. Each frame reads it in its own mode; nothing else differs. The rest of the tour follows the app’s theme the same way.'
    },
    subject: Frame({
      flex: 'row',
      w: 'hug',
      h: 'hug',
      gap: 40,
      children: [stage('Dark'), stage('Light')]
    }),
    tip: {
      step: 4,
      title: 'Switch the mode',
      body: 'With nothing selected, open the Theme collection from the panel’s Variables section and change a value in one mode: the player in that mode follows, the other stays.',
      where: variablesRow(theme, `${graph.variables.size} / ${graph.variableCollections.size}`)
    }
  })
  // Both stages pin their mode, so they show dark and light whichever theme the app is in.
  const [dark, light] = graph.getChildren(chapter.subject.id)
  graph.updateNode(dark.id, { variableModes: { [theme.collectionId]: theme.modeIds.dark } })
  graph.updateNode(light.id, { variableModes: { [theme.collectionId]: theme.modeIds.light } })
  return chapter
}
