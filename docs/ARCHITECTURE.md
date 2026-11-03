# Architecture

## Shape

Sofra is a modular monolith: one Next.js App Router application and one PostgreSQL database. Route groups organize public, account, host, partner, and admin surfaces. Product logic lives in typed domain modules and server services rather than page components.

```text
Browser
  → Next.js Server Components / Server Actions
    → authorization + domain services + audit
      → repository boundary
        → PostgreSQL (Neon deployed / local container) + Better Auth
```

Anonymous discovery reads the `published_hosted_tables` database view when a database is configured and otherwise falls back to fictional in-repository fixtures. Demo mode separately enables local persona walkthroughs for protected workspaces. Demo mutation paths validate and preview input without persisting it; durable repository factories refuse demo-mode writes.

With demo mode off, a configured database and an authenticated actor, booking creation/cancellation, host onboarding, operator decisions, post-dinner submissions, and payment-ledger recording have PostgreSQL write repositories and transactional SQL functions. Persisting a payment or payout record is distinct from moving money through an external provider.

Traveler booking preparation runs through the server-only booking service. It validates the booking cutoff, configurable shared-party limit, seat availability, additional-guest count, compatibility requirement, and integer total before reaching the payment adapter. The service keeps private guest names and dietary text in the server intent while exposing a separate allowlisted pre-payment review.

Post-dinner input uses three distinct server-only intents: moderation-pending public review, operations-only constructive feedback, and restricted safety incident. Each exposes a separate safe result projection. Feedback and incident text are stored in their restricted records on the durable path, rather than echoed in public results, audit payloads, or analytics events. An open safety incident holds the linked payout; a local demo review does not claim that an incident or payout change was persisted.

## Layers

- `src/app`: routing, metadata, localized layouts, and page composition.
- `src/components`: shared visual building blocks and shadcn-owned components.
- `src/features`: domain types, policies, schemas, projections, demo repositories, and feature components.
- `src/server`: authentication, authorization, database clients, service boundaries, adapters, and audit.
- `src/server/repositories`: actor-bound read contracts, explicit row mappers, and demo/PostgreSQL implementations. Page components depend on these contracts rather than database clients.
- `db/migrations`: normalized schema, views, and functions. Authorization is enforced in the server layer, not by row-level security.
- `db/seed.sql`: reference data. `db/fixtures.sql`: fictional development data, local targets only.

## Interface resilience

The localized shell provides a main-content skip target and a content-level language boundary for assistive technology. Protected portal navigation derives a single current route, exposes it with `aria-current`, and remains horizontally scrollable on narrow screens. Shared empty states use semantic heading levels and route-specific next actions; loading and error boundaries announce their status without exposing technical details. Because App Router layouts and pages may render in parallel, each traveler, host, partner, and operator surface repeats its shared server authorization gate at the page boundary before protected content or repository access.

## External adapters

- Database: a shared server-only `postgres.js` client for domain data. Better Auth uses a separate `pg` pool against the same `DATABASE_URL`. Neither is a browser database client.
- Maps: approximate-neighborhood model; exact address is not accepted by the public adapter.
- Notifications: Resend when configured, console adapter in development.
- Analytics: typed PostHog events when configured, otherwise no-op; sensitive fields are unrepresentable in the event contract.
- Monitoring: Sentry when configured, otherwise disabled.
- Payments: provider-neutral server-only interface, guarded mock for local/test, and an iyzico adapter whose external integration remains incomplete (see below).

## Authentication and authorization

Better Auth authenticates through emailed sign-in links. `getCurrentActor()` resolves the session user to a domain profile and its non-revoked `role_assignments`; request input does not choose the actor or an administrative role.

Authorization is enforced by server gates, actor-scoped repositories, and ownership/role checks in relevant SQL functions. This is not the former Supabase model: there is no `auth.uid()` identity, browser-facing database API, service-role key, or row-level-security boundary. SQL functions receive profile IDs from the authenticated server path. The database connection is privileged application infrastructure and must remain server-only.

Cross-user operator reads use a separate `SofraOperatorReadRepository`. Its factory requires `operator` or `administrator` before constructing the repository; its methods repeat the role check. Operator write factories likewise check the actor, and their SQL functions repeat operator checks. These operations use the same domain database connection, not a separate service-role connection.

## Repository selection

- Anonymous listing reads use `published_hosted_tables` when a database is configured. Without a database, the fictional public projection remains available for development; production startup validation rejects a missing database URL.
- Traveler-owned booking summaries call `get_booking_summaries(profile_id)` with the actor held by the gateway. The SQL function filters bookings by that profile and returns an explicit summary shape.
- Host table reads first resolve households owned by the authenticated actor, then read tables from those household IDs. The repository maps an allowlist that excludes address IDs, exact addresses, precise coordinates, arrival instructions, and guest-selection data. This scoping is explicit SQL and server code, not RLS.
- Host certification reads select only status, validity, and certified capacity for actor-owned households. The create-table interface derives its capacity from that record instead of a UI default.
- Serving-host rosters call `get_host_roster(table_id, profile_id)`. The repository checks table ownership before querying, and the function checks household ownership again. The result includes confirmed/completed booking identifiers, party size, lifecycle status, and compatibility outcome rather than the wider private booking row.
- Partner referral summaries call `get_partner_referral_summary(profile_id)`. The factory requires `partner_user`; the SQL function checks that role and scopes rows through the profile’s partner-organization membership. Its allowlisted result includes organization identity, referral code and landing time, booking stage and party size, plus public table context, excluding traveler identity, referral metadata, exact location, dietary data, money, commissions, and settlement information.
- Private addresses have separate authenticated paths: a host can read their own household address; a traveler calls `get_booking_arrival_details(profile_id, booking_id)`. That function gates address disclosure by booking ownership, confirmed/completed status, and the configured disclosure window; before disclosure it can return the opening time without the address. Neither path extends the public listing projection.
- Operator queues use fictional protected records in local demo mode. Outside demo mode they fail closed unless an authorized operator is present and a database is configured. Operator records are separate from public, traveler, and host contracts so confidential incident and audit fields cannot drift into those projections.
- Protected production reads never fall back to a demo actor. Missing authentication or database configuration fails closed.

## Payment integration boundary

`getPaymentProvider()` selects iyzico when both credentials are configured, defaulting to its sandbox URL. Otherwise it selects the opt-in mock outside production, or returns no provider. Production configuration rejects mock payments and demo personas.

The iyzico adapter implements checkout, status retrieval, webhook signature verification, refunds, host payee registration, payout approval/revocation, and host-share updates. Those methods and their isolated tests are not an end-to-end payment integration: the client explicitly requires sandbox confirmation of its endpoint assumptions before production traffic.

The current booking action passes no host payee reference, which the iyzico payload builder rejects before a charge is made. The action leaves that booking reserved and payment pending. Host payee onboarding, a routed callback/webhook settlement path, and the remaining provider-operation wiring are not completed. The mock is the wired synchronous settlement path, and ledger records explicitly mark its results as simulated. An operator's local payout or refund state change must not be described as proof that an external transfer occurred.

## Verification scope

Unit tests exercise domain rules, mappings, adapters, and authorization with controlled inputs. Database integration tests run the SQL/repository paths against local PostgreSQL and fictional fixtures. Browser suites separately cover demo personas, durable sign-in/write journeys, and responsive layouts. See the commands in the README and `.github/workflows/quality.yml`; a test's presence does not mean it has run successfully on the current checkout.

The architecture and tests do not establish live provider readiness, production database permissions, legal launch clearance, or an independent security audit. Unresolved product and operational gates remain in `docs/OPEN_QUESTIONS.md`.
