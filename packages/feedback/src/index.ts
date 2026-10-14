import { createFeedbackApp } from './app'
import type { FeedbackBindings } from './env'
import { runRetention } from './retention'

const app = createFeedbackApp()

export default {
  // `satisfies` keeps the declared bindings in step with `wrangler types`' generated `Env`.
  fetch: (request, env, ctx) => app.fetch(request, env satisfies FeedbackBindings, ctx),
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runRetention(env, new Date()))
  }
} satisfies ExportedHandler<Env>
