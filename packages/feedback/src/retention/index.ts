import { createFeedbackDatabase } from '#feedback/db'
import type { FeedbackBindings } from '#feedback/env'
import { deleteUnconfirmedSignups } from '#feedback/waitlist/signup'

/** The daily cron: drops what the privacy page says we do not keep. Ping counts hold no personal data and stay. */
export async function runRetention(env: FeedbackBindings, now: Date): Promise<void> {
  await deleteUnconfirmedSignups(createFeedbackDatabase(env.DB), now)
}
