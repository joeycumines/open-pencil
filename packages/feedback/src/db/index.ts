import type { D1Database } from '@cloudflare/workers-types/index'
import { CamelCasePlugin, Kysely } from 'kysely'
import { D1Dialect } from 'kysely-d1'

import type { FeedbackDatabase } from './schema'

export type { FeedbackDatabase } from './schema'

export function createFeedbackDatabase(database: D1Database): Kysely<FeedbackDatabase> {
  return new Kysely<FeedbackDatabase>({
    dialect: new D1Dialect({ database }),
    plugins: [new CamelCasePlugin()]
  })
}
