# Security and privacy

This document describes the current source-level boundaries. It is not a security audit or verification of a deployed database, storage service, or payment provider.

## Identity and database access

Sofra uses PostgreSQL with Better Auth, not Supabase Auth or row-level security. The application connects through server-only database clients; browsers do not receive a database connection or direct database query API. The `public` SQL schema name does not mean its tables are exposed anonymously.

`src/server/auth/current-actor.ts` resolves a Better Auth session to a Sofra profile. Domain operations use that profile ID, not the authentication user ID. Roles come from `role_assignments`, excluding revoked assignments; client-editable account metadata does not grant operator or administrator access.

Authorization depends on server entry points resolving the actor, passing that actor into repositories, and checking roles and ownership. SQL functions additionally enforce their documented ownership, role, and lifecycle constraints. Functions that accept a profile ID trust the application to supply the authenticated actor: they are not a replacement for that boundary and must not be exposed directly to callers.

## Public-safe boundary

Anonymous page HTML, JSON, metadata, analytics, public map inputs, static client assets, and public listing projections must exclude exact addresses, precise coordinates, arrival instructions, identity documents, private assessment notes, dietary data, guest identities, reports, and internal risk information. Authorized private pages can disclose specific fields through the scoped paths below; those fields must not be reused in public output.

`public.published_hosted_tables` supplies the anonymous listing read model through the server repository. Its explicit column allowlist excludes household addresses and guest records. Application mappers and `src/features/hosted-tables/public-projection.ts` repeat the output allowlist so an extra database column does not automatically become public output. These projections are a data-minimization boundary, not database access control by themselves.

`get_booking_summaries(profile_id)` is the traveler booking-summary read model. The gateway supplies the server-resolved profile ID, and the SQL filters bookings by their primary traveler. It returns booking status, party context, public table information, compatibility status, payment status, and total price. Its output excludes address, arrival, guest-name, dietary-text, assessment, incident, and audit fields.

`get_host_roster(table_id, profile_id)` checks that the supplied actor owns the table’s household and returns only confirmed/completed booking identifiers, party size, booking status, and compatibility outcome. The repository also verifies table ownership and the returned table IDs. This roster does not expose the broader booking row, guest names, dietary text, payment detail, or traveler-selection attributes.

Booking preparation separates the server-only intent from the traveler-facing review. Guest names and dietary disclosures are persisted through the booking write path when durable writes are available; they are no longer only future persistence work. The review allowlist carries party size, total price, compatibility status, and pre-payment booking status, without echoing those private form fields.

Post-dinner submissions use separate durable writes for moderation-pending public reviews, private constructive feedback, and confidential safety reports. Their text is stored in the appropriate table, not merely held in a transient intent. Safe review results and redirect URLs exclude that text. The demo audit uses the reduced review result; the safety review result contains incident and required payout state, without severity or report text.

## Private disclosure and purpose-specific reads

- Household addresses and precise coordinates are separate from the public listing. A host can read their own household address through an ownership-scoped query.
- `get_booking_arrival_details(profile_id, booking_id)` returns only the traveler's own booking. Address and arrival fields are populated only for a confirmed/completed booking once its disclosure window opens; before that they remain null and the result reports the opening time. No coordinates, verification notes, or other guests are returned. The current 48-hour default is configurable policy, not a settled launch decision; see `docs/OPEN_QUESTIONS.md` and migration `0019_arrival_disclosure.sql`.
- Operators receive dietary disclosure text in the dedicated compatibility-review queue and confidential report text in the incident contract. These fields must not spread into unrelated booking, table, payout, or public projections.
- Notification queries return the relevant recipients' names, email addresses, language, and limited public dinner context. These contact queries are server-only delivery inputs, not public profile endpoints. They exclude exact household addresses, dietary disclosures, and assessment notes.
- Public reviews, private feedback, and safety reports use separate storage and rendering contracts. Object storage is still unchosen and unused; identity-document upload or storage protection is not an implemented capability to claim.

## Operator actions and durable writes

The operator read factory resolves the actor and requires an operator or administrator role before constructing its database gateway. Every operator repository read method checks the role again. Operator writes check the role in the factory and in the SQL functions they call. Mutations use domain-specific write contracts, database constraints/transactions, and audit records rather than allowing presentation components to change lifecycle fields directly.

The database connection can read more than any individual user may see. There is no per-user RLS safety net: a new query or route must preserve role checks, actor scoping, and field allowlists. Tests of existing paths do not automatically cover new ones.

## Development and production boundaries

- Demo personas require `SOFRA_DEMO_MODE=true` and a non-production environment. They are walkthrough identities, not authentication. Durable write factories refuse demo mode.
- Anonymous discovery can fall back to fictional listings without a database. Authenticated access outside demo mode fails without `DATABASE_URL`; production startup validation rejects the missing database rather than permitting that fallback as a live marketplace.
- Production validation also requires stable auth and notification configuration and an HTTPS application URL. It rejects demo personas and mock payments. A successful build alone does not establish that a deployment has these settings or that live payments work.
- Better Auth uses emailed links, database-backed rate limiting, and secure cookies in production. Password login is disabled. The two database clients configure TLS for non-local connections; deployed connection and certificate behavior still require environment verification.
- The Content Security Policy restricts framing, forms, connection destinations, and other resource types, but currently permits inline scripts. It is defense in depth, not proof that injection or data exfiltration is impossible.

## Secrets and telemetry

`NEXT_PUBLIC_` values are public build inputs: the application URL, map/analytics identifiers, and optional browser monitoring identifier must contain no secret. Database URLs, `BETTER_AUTH_SECRET`, Resend keys, payment credentials, and privileged monitoring tokens remain server-only and out of Git. `.env.example` is a template, not a place to store credentials.

Typed analytics events contain identifiers and limited product state, not dietary text, address data, guest names, or incident content. The monitoring adapter forwards errors and supplied context to Sentry when configured; it does not itself provide a general redaction layer. Callers must therefore keep raw requests, disclosures, auth values, and other private content out of errors and telemetry context. The development notification adapter logs recipient and subject metadata, so local logs also need to remain private.

## Evidence and limits

Useful checks live in public-projection tests, repository/factory tests, and PostgreSQL integration tests for ownership, arrival disclosure, notification contacts, booking writes, and post-dinner workflows. `db/migrations` is the schema source of truth. These tests describe and exercise application boundaries; they do not establish an independent security audit, live access-control correctness, legal compliance, or launch readiness.
