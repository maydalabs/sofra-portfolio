# Deployment

This is a procedure for an explicitly approved deployment, not a record of a
verified live service. Deploying makes the application reachable; it does not
make it launchable — see
"What deploying does not solve" at the end.

## Order of operations

Migrations must be applied **before** the code that depends on them serves
traffic. Deploy in this order, every time:

```bash
pnpm db:migrate:neon   # 1. apply pending migrations to the deployed database
git push origin main   # 2. deploy the code that expects them
curl https://YOUR-DOMAIN/api/health   # 3. confirm
```

The health check answers the question that matters after a deploy:

For the local host-revision implementation on November 4, 2026, the expected
migration state is (this is not a deployment receipt):

```json
{
  "status": "ok",
  "migrations": 23,
  "latestMigration": "0023_host_table_revision.sql"
}
```

The endpoint reports database connectivity and the last recorded migration; it
does not compare that state to the source tree or exercise application flows.
Compare the count and name to `db/migrations` at the deployed commit. A mismatch
needs investigation before serving code that depends on the missing migration.

Migrations are deliberately **not** part of the build. A Vercel preview build
runs on every branch, and a build-step migration would let any branch mutate the
production schema.

## Vercel environment variables

Set these in the Vercel project, for Production. You must enter them yourself —
they are secrets.

| Variable                                              | Value                     | Notes                                                                                                                                       |
| ----------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                        | Neon **pooled** string    | The one with `-pooler` in the host. Serverless functions exhaust direct connections quickly.                                                |
| `BETTER_AUTH_SECRET`                                  | `openssl rand -base64 32` | Signs session tokens. Changing it signs everyone out.                                                                                       |
| `NEXT_PUBLIC_APP_URL`                                 | `https://your-domain`     | Must be https.                                                                                                                              |
| `SOFRA_DEMO_MODE`, `SOFRA_ENABLE_MOCK_PAYMENTS`       | `false`                   | Production startup rejects either switch set to the literal `true`.                                                                         |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`                 | from Resend               | Both are required by production startup validation. Console delivery is a development fallback, not a working production sign-in mechanism. |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`                | optional                  | Monitoring is disabled cleanly without them.                                                                                                |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | optional                  | Analytics no-ops without them.                                                                                                              |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`                     | optional                  | Falls back to a neighbourhood label.                                                                                                        |

`DATABASE_URL_UNPOOLED` is **not** needed by the application. The migration
runner prefers it over `DATABASE_URL`. A filename such as `.env.neon` or
`.env.local` does not validate the target: verify both values privately before
running migrations. `--reset` drops the target's entire `public` schema and
has no local-only guard; never use it for a deployed or shared database.

Do not add iyzico keys just to make a staging build pass: they are not required
for startup. Both provider keys select the real adapter. Host payee onboarding,
the callback route, and end-to-end settlement still need implementation and
sandbox verification; the current booking action passes a null payee reference
and the iyzico payload builder refuses it before charging.

### `NEXT_PUBLIC_` values are inlined at build time

This trips people up. A `NEXT_PUBLIC_*` variable set only in the runtime
environment has no effect — its value is baked in when `next build` runs. Vercel
provides environment variables at build time, so setting them in the project
settings is sufficient; setting them anywhere later is not.

## Startup validation

The application refuses to boot if production is misconfigured:

```
Refusing to start: the production environment is incomplete.
  - BETTER_AUTH_SECRET: session tokens would not be signed with a stable key
```

This is intentional. A missing `DATABASE_URL` would otherwise make the site
serve fictional demo households as though they were real listings, which is
worse than an outage. See `src/server/config/environment.ts`.

## Before the first deploy

- [ ] **Resolve the historical credential-exposure note.** Earlier deployment
      notes recorded a database password in a chat. Verify that the affected
      credential was rotated; if unresolved, rotate it and update the authorized
      environments. This documentation review did not verify or perform rotation.
- [ ] **Review database recovery.** Verify the actual provider plan's retention
      and restore procedure; do not rely on an old free-plan retention estimate.
- [ ] **Configure and verify Resend.** Production requires both settings.
      Successful startup does not prove that the sender is verified or mail is
      delivered; test delivery separately with approval.
- [ ] Confirm `pnpm db:migrate:neon` reports `up to date`.
- [ ] Confirm the relevant commit's full CI gate, including database and browser
      suites. A local unit run or a green dependency-update job is not equivalent.

## Rolling back

Code rolls back through Vercel's deployment history. **Migrations do not.**
There are no down-migrations by design: a reversible migration that drops a
column still loses the data in it.

To recover from a bad migration, restore the database to a point in time in
Neon, then redeploy the matching commit. This is why history retention is worth
deciding on before launch, not after.

## What deploying does not solve

Build/deploy success is not proof that the marketplace works in production:

- **Content is an operational responsibility.** Migrations and the reference
  seed do not supply real approved households. Actual deployed content was not
  inspected in this review. Development fixtures are fictional and reject
  non-local hosts; real listings require onboarding and operator approval.
- **Payment adapter code is not a complete payment flow.** iyzico checkout,
  refund, and sub-merchant operations exist, with injected-response unit tests.
  Host onboarding, routed callbacks, and successful sandbox/production flows
  remain unverified or incomplete. Without a provider, bookings persist as
  `draft` / `not_started`; recording a refund or payout state does not prove an
  external transfer. Do not advertise live payments on that basis.
- **Product and operational gates remain.** Identity verification, shared-table
  minimum decisions, some settlement/reversal policies, and legal/food-safety
  decisions remain open. See `docs/OPEN_QUESTIONS.md`.

These are tracked in `docs/OPEN_QUESTIONS.md`. A deploy now is useful for
staging, demos, and validating the infrastructure — not for taking real
bookings.
