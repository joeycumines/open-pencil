import type { Ping } from '#feedback/contract'
import type { FeedbackDatabase } from '#feedback/db'
import type { Kysely } from 'kysely'

/** Adds one to today's count for the ping's build and answer; no row ever describes a single install. */
export async function recordPing(
  db: Kysely<FeedbackDatabase>,
  ping: Ping,
  now: Date
): Promise<void> {
  await db
    .insertInto('usagePings')
    .values({ ...ping, day: now.toISOString().slice(0, 10), count: 1 })
    .onConflict((conflict) =>
      conflict
        .columns(['day', 'version', 'platform', 'arch', 'app', 'browser', 'usageStats'])
        .doUpdateSet((eb) => ({ count: eb('usagePings.count', '+', 1) }))
    )
    .execute()
}
