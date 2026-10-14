# @open-pencil/feedback

The Cloudflare Worker behind `feedback.openpencil.dev`. It is operated by the OpenPencil team for official builds and is not meant to be self-hosted; forks and self-built apps never call it.

| Route | What it does | What it keeps |
| --- | --- | --- |
| `POST /ping` | The daily anonymous ping. | One counter per day and build (version, OS, architecture, desktop or web, browser family). Nothing per install, no addresses. |
| `POST /ingest` | Opt-in usage stats, forwarded to PostHog EU. Refuses any event or property not in `src/contract`. | Nothing. PostHog gets no client address, person profile, or GeoIP. |
| `POST /waitlist` | OpenPencil Cloud waitlist sign-ups from the website and the web app's Settings, checked by Turnstile and confirmed by email. | The address and optional note; unconfirmed sign-ups are removed after seven days. |

`@open-pencil/feedback/contract` holds the request schemas and the event list, and `@open-pencil/feedback/client` is a client typed by the Worker's routes (`hc<FeedbackAPI>`). The app sends through that client and the privacy page renders its tables from the contract, so the documented, sent, and accepted data cannot drift apart.

## Development

```sh
cp packages/feedback/.dev.vars.example packages/feedback/.dev.vars
bun --filter @open-pencil/feedback dev       # wrangler dev with a local D1
bun run test:feedback                        # typecheck and tests against a local D1
bun --filter @open-pencil/feedback types     # after changing wrangler.jsonc
```

Apply migrations to the local database with `bunx wrangler d1 migrations apply feedback --local` from this folder.

## Production setup

Done once on the Cloudflare account; `.github/workflows/feedback.yml` deploys every change to `master` afterwards.

1. `bunx wrangler d1 create feedback --jurisdiction eu` and put the database ID in `wrangler.jsonc` (done for the production database).
2. Onboard `openpencil.dev` to Email Service so `hello@openpencil.dev` can send. Sending to addresses outside the account needs the Workers Paid plan; send one confirmation to an outside address before announcing the waitlist.
3. Create a Turnstile widget for `openpencil.dev` and `app.openpencil.dev`, the hostnames in `TURNSTILE_HOSTNAMES` (its public site key is `TURNSTILE_SITE_KEY` in the contract; the form gives it the `waitlist` action), then `bunx wrangler secret put TURNSTILE_SECRET`.
4. Create a PostHog EU project with "Discard client IP data" on and data retention at 12 months, as the privacy page promises, then `bunx wrangler secret put POSTHOG_KEY` with its project key.
