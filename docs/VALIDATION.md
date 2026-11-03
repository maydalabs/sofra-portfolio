# Local validation — November 3, 2026

This record covers the implementation included in the prepared portfolio source
snapshot. Checks ran locally against the development checkout before export;
the release manifest verifies the copied files. It does not describe a hosted
service or assert that a future CI run has passed.

## Latest results

| Check                          | Result                                      | Most recent scope                                                       |
| ------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------- |
| Formatting, ESLint, TypeScript | Passed                                      | Portfolio documentation and local database-tool review                  |
| Unit/component suite           | 38 files, 128 tests passed                  | Portfolio documentation and local database-tool review                  |
| Fixture-target tests           | 6 tests passed                              | Exact loopback URL validation, parser ambiguity, and error redaction    |
| Migration and fixture setup    | 22 migrations and 9 fictional tables loaded | Fresh disposable PostgreSQL 18 instance after the fixture-target change |
| Production build               | Passed                                      | See the configuration limits below                                      |
| Demo browser suite             | 28 tests passed in Chromium                 | After the social-image replacement                                      |
| PostgreSQL integration suite   | 11 files, 123 tests passed                  | Before the social-image and comment updates                             |
| Durable browser suite          | 3 tests passed in Chromium                  | Before the social-image and comment updates                             |
| Responsive browser suite       | 161 tests passed in Chromium                | Before the social-image and comment updates                             |
| Social-image reproduction      | Byte-for-byte match                         | Generator compared with the included PNG                                |

Node.js 22.20.0 was used for the current checks, matching the major version in
CI. Initial lint/type checks also passed on Node.js 25.2.1. No dependency
versions changed during this review.

The six Node.js fixture-target tests are part of `pnpm test` alongside Vitest.
They check valid local targets, misleading host prefixes, multiple hosts and
userinfo, query/fragment overrides, malformed inputs, and errors that do not
reveal supplied credentials. They make no database or network requests.

## Browser evidence

The demo suite exercises public browsing, role walkthroughs, unavailable-payment
behavior, privacy boundaries, keyboard access, and English/Turkish pages.
Its latest run also verifies that the original brand PNG is served at 1200 × 630,
both retired photo paths return 404, and localized metadata describes the new
artwork. Individual table details continue to advertise no social image.

The durable suite runs with demo mode disabled. It checks unauthenticated
redirects, real local magic-link authentication, and host draft creation with a
SQL assertion of the saved row and integer pricing. It reads the test link from
the disposable database; no email is sent.

Responsive coverage checks 26 English routes at six widths from 320 to 1440
pixels, plus five Turkish routes at 375 pixels. Protected routes select the
required persona, and destination-path assertions reject unexpected redirects.
These checks measure horizontal overflow; they are not a complete visual or
accessibility audit.

The earlier complete browser run passed 191 tests. The later demo suite added
one image regression check and passed all 28 tests. Durable and responsive
suites were not repeated for the asset/comment changes. The final README and
local database-tool review did not change application UI or routes, so it did
not trigger another browser run.

## Test isolation

Database setup and integration checks used disposable PostgreSQL 18 containers
bound to loopback, with fictional fixtures and both database URLs explicitly
set. Existing development and deployed databases were not reset. Temporary
containers and browser-test servers were stopped after use.

The browser runs used isolated Chromium and the repository's `next dev` server
configuration. An initial demo run with blank database URLs passed its
assertions but logged refused connections from the auth layer. It was repeated
against a disposable database without those errors; that repeat is the cited
28-test result. Demo mode does not remove every auth-layer database dependency.

Builds used explicit test-only settings to override `.env.local`, with payment,
mail, monitoring, Maps, and analytics credentials blank, demo/mock switches
false, and telemetry disabled. Production compilation succeeded, but starting
a production server requires complete runtime configuration, including email
delivery. No live charge, refund, payout, or email was performed.

HTML reports were retained privately as ignored local artifacts and are not
included in this source snapshot. The screenshots in `docs/screens/` are earlier
fictional-data walkthroughs, not captures from these test runs.

## Remaining verification limits

- The generated-database-types drift step in CI was not rerun. TypeScript and
  integration tests passed against the included types.
- Browser evidence covers Chromium and `next dev`, not other browser engines or
  a running production build.
- Provider tests use controlled responses. They do not establish iyzico sandbox
  acceptance, live charges/refunds, onboarding, callbacks, or settlement.
- Hosted database permissions, mail delivery, production operation, legal launch
  readiness, and an independent security audit remain outside these results.
