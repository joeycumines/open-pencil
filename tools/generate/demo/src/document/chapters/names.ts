/**
 * The tour's chapters in reading order: the number and name its section shows, and the name of
 * its subject, the layer the chapter is about. Hosts that show one chapter, such as the docs
 * landing, find it by these names; `tests/build.test.ts` holds the document to them.
 */
export const CHAPTERS = {
  hello: { index: 1, name: 'Hello', subject: 'Hero' },
  slots: { index: 2, name: 'Slots', subject: 'Players' },
  controls: { index: 3, name: 'Controls', subject: 'Controls' },
  modes: { index: 4, name: 'Modes', subject: 'Modes' },
  shaders: { index: 5, name: 'Shaders', subject: 'Shaders' },
  code: { index: 6, name: 'Code', subject: 'Player' },
  lint: { index: 7, name: 'Lint', subject: 'Sign-in' },
  yours: { index: 8, name: 'Yours', subject: 'Ways' }
} as const satisfies Record<string, TourChapter>

export interface TourChapter {
  index: number
  name: string
  subject: string
}

export type ChapterKey = keyof typeof CHAPTERS

/** The chapter's section name, as the layer list shows it. */
export function sectionName({ index, name }: TourChapter): string {
  return `${index} · ${name}`
}
