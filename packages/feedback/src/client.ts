import { hc, type ClientRequestOptions } from 'hono/client'

import type { FeedbackAPI } from './app'
import { FEEDBACK_ORIGIN } from './contract'

/** A typed client for the feedback service, checked against its routes at compile time. */
export function createFeedbackClient(
  options: { fetch?: ClientRequestOptions['fetch']; origin?: string } = {}
) {
  return hc<FeedbackAPI>(options.origin ?? FEEDBACK_ORIGIN, { fetch: options.fetch })
}

export type FeedbackClient = ReturnType<typeof createFeedbackClient>
