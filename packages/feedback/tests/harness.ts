import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createFeedbackApp } from '#feedback/app'
import { testClient } from 'hono/testing'
import { getPlatformProxy } from 'wrangler'

const PACKAGE_ROOT = join(import.meta.dir, '..')

export interface FetchCall {
  url: string
  init: RequestInit | undefined
}

/** A rate limiter that allows requests until `exhausted` is set. */
export function testLimiter(): RateLimit & { exhausted: boolean } {
  return {
    exhausted: false,
    async limit() {
      return { success: !this.exhausted }
    }
  }
}

async function applyMigrations(db: D1Database): Promise<void> {
  const directory = join(PACKAGE_ROOT, 'migrations')
  for (const file of (await readdir(directory)).toSorted()) {
    const sql = (await readFile(join(directory, file), 'utf8'))
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
    const statements = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0)
    await db.batch(statements.map((statement) => db.prepare(statement)))
  }
}

/**
 * The service against a local D1 from Miniflare, migrated from `migrations/`, with outside
 * calls, email, rate limits, and the clock replaced so each test can steer and inspect them.
 */
export async function createTestService() {
  const proxy = await getPlatformProxy<Env>({
    configPath: join(PACKAGE_ROOT, 'wrangler.jsonc'),
    persist: false
  })
  await applyMigrations(proxy.env.DB)

  const fetchCalls: FetchCall[] = []
  const responses = new Map<string, () => Response>()
  const sentEmails: EmailMessageBuilder[] = []
  let now = new Date('2026-10-12T09:00:00.000Z')
  const limiters = { ping: testLimiter(), ingest: testLimiter(), waitlist: testLimiter() }

  const env: Env = {
    ...proxy.env,
    POSTHOG_HOST: 'https://eu.i.posthog.com',
    POSTHOG_KEY: 'phc_test',
    TURNSTILE_SECRET: 'turnstile-secret',
    TURNSTILE_HOSTNAMES: 'openpencil.dev,app.openpencil.dev',
    EMAIL_FROM: 'hello@openpencil.dev',
    PING_LIMITER: limiters.ping,
    INGEST_LIMITER: limiters.ingest,
    WAITLIST_LIMITER: limiters.waitlist,
    EMAIL: {
      async send(message: EmailMessageBuilder | EmailMessage) {
        if (!('subject' in message)) throw new Error('Tests send composed emails only')
        sentEmails.push(message)
        return { messageId: `message-${sentEmails.length}` }
      }
    }
  }

  const app = createFeedbackApp({
    async fetch(input, init) {
      const url = input instanceof Request ? input.url : String(input)
      fetchCalls.push({ url, init })
      const respond = [...responses].find(([prefix]) => url.startsWith(prefix))?.[1]
      return respond ? respond() : new Response(null, { status: 200 })
    },
    now: () => now
  })

  const request = (path: string, init?: RequestInit) =>
    app.request(`https://feedback.openpencil.dev${path}`, init, env)

  return {
    /** A client typed by the service's routes, as the app's is, sending into the app under test. */
    client: testClient(app, env),
    env,
    limiters,
    db: proxy.env.DB,
    fetchCalls,
    sentEmails,
    /** Answers outside requests whose URL starts with `prefix`. */
    respond(prefix: string, response: () => Response) {
      responses.set(prefix, response)
    },
    setNow(date: Date) {
      now = date
    },
    request,
    /** Posts any body, including ones the typed client would not let through. */
    postJSON(path: string, body: unknown, headers: Record<string, string> = {}) {
      return request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body)
      })
    },
    dispose: () => proxy.dispose()
  }
}

export type TestService = Awaited<ReturnType<typeof createTestService>>
