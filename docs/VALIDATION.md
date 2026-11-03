# Local validation — November 4, 2026

This record covers the dependency security update to the prepared portfolio
source. Checks ran locally in a disposable copy with explicit test settings;
they do not describe a hosted service or assert that a future CI run has passed.
The November 3 validation preceded these dependency changes; the results below
supersede its verification scope.

## Latest results

| Check                          | Result                                      | Scope                                                         |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------- |
| Frozen lockfile installation   | Passed                                      | pnpm 11.28.10 on Node.js 22.23.4                              |
| Formatting, ESLint, TypeScript | Passed                                      | Updated dependencies and test helper                          |
| Unit/component suite           | 38 files, 128 tests passed                  | Dependency update                                             |
| Fixture-target tests           | 6 tests passed                              | Part of `pnpm test`                                           |
| Migration and fixture setup    | 22 migrations and 9 fictional tables loaded | Fresh disposable PostgreSQL 18 instance                       |
| Generated database types       | Matched the included file                   | Regenerated 30 relations, 11 enums, and 39 functions          |
| PostgreSQL integration suite   | 11 files, 123 tests passed                  | Dependency update                                             |
| Production build               | Passed                                      | Next.js 16.4.5; runtime limits below                          |
| Demo browser suite             | 28 tests passed in Chromium                 | Dependency update                                             |
| Durable browser suite          | 3 tests passed in Chromium                  | Real local magic-link authentication and a saved host draft   |
| Responsive browser suite       | 161 tests passed in Chromium                | Dependency update                                             |
| Social-image reproduction      | Byte-for-byte match                         | Updated Next.js renderer compared with the included PNG       |
| Production dependency gate     | Passed                                      | `pnpm audit --prod --audit-level=high`; lower findings remain |

The fixture-target tests check valid local targets, misleading host prefixes,
multiple hosts and userinfo, query/fragment overrides, malformed inputs, and
errors that do not reveal supplied credentials. They make no database or
network requests.

## Dependency scope and remaining advisories

Next.js and its ESLint configuration now match at 16.4.5. The update also uses
React/React DOM 19.2.9, Better Auth and its matched adapters 1.7.16, Sentry
10.78.0, Zod 4.6.7, shadcn 4.23.0, and Vitest 4.1.12 with Vite 8.3.5. The
lockfile includes sharp 0.35.5 and source-map-js 1.2.2.

Four version-scoped overrides select patched nanoid 3.3.20, fast-uri 3.1.9,
brace-expansion 5.0.12, and source-map-js 1.2.2 within their existing parents'
declared ranges. The native-build allowlist is unchanged. pnpm recorded exact
release-age exceptions for the explicitly selected Next.js and Better Auth
releases and their matching packages; these are not wildcard exceptions.

The initial full audit reported 6 critical, 36 high, 58 moderate, and 15 low
advisories. After the update, both the full audit and production audit report
**0 critical, 0 high, 2 moderate, and 1 low**. Unfiltered audit commands still
exit nonzero because the following findings remain:

| Package                  | Severity | Remaining dependency paths                           | Reason retained                                                                 |
| ------------------------ | -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| deepmerge 4.3.1          | Low      | shadcn and its registry tooling                      | No patched release is published for GHSA-gcqx-w48m-w2h4.                        |
| minimatch 10.2.6 / 3.1.5 | Moderate | Sentry bundling, shadcn/ts-morph, and ESLint tooling | GHSA-g3hv-75wg-m249 requires 11.0.1 or later, outside the parent ranges.        |
| glob 13.0.6              | Moderate | Sentry bundling                                      | GHSA-3g3m-2fjr-6pw4 requires 14.0.2 or later, outside the parent's major range. |

The production audit includes tooling beneath packages in `dependencies`; that
classification alone does not establish a request-reachable exploit. No
incompatible major override or advisory suppression was added. CI now runs the
same production high-severity gate after its frozen install. These are package
advisory results, not a complete application security assessment.

## Browser evidence

The demo suite exercises public browsing, role walkthroughs, unavailable-payment
behavior, privacy boundaries, keyboard access, and English/Turkish pages. It
also verifies that the original brand PNG is served at 1200 × 630, both retired
photo paths return 404, and localized metadata describes the artwork.
Individual table details continue to advertise no social image.

The durable suite runs with demo mode disabled. It checks unauthenticated
redirects, real local magic-link authentication, and host draft creation with a
SQL assertion of the saved row and integer pricing. It reads the test link from
the disposable database; no email is sent.

Better Auth now namespaces stored magic-link identifiers. The old test helper
passed that database identifier as the URL token and failed its sign-in check.
The helper now selects only magic-link records, asserts the exact identifier
prefix, and extracts the token before URL encoding it. All three durable tests
then passed. Application authentication behavior was not changed.

Responsive coverage checks 26 English routes at six widths from 320 to 1440
pixels, plus five Turkish routes at 375 pixels. Protected routes select the
required persona, and destination-path assertions reject unexpected redirects.
These checks measure horizontal overflow; they are not a complete visual or
accessibility audit. Demo and responsive suites ran separately so the responsive
checks were not counted twice.

## Test isolation

Database setup, generated-type verification, integration tests, and browser
checks used a disposable PostgreSQL 18 container bound to a randomly assigned
loopback port. Both database URLs explicitly targeted that container and only
fictional fixtures were loaded. Existing development and deployed databases
were not reset. The temporary container and browser-test servers were stopped
after use.

Final installation, formatting, ESLint, TypeScript, unit/component tests,
fixture-target tests, integration tests, production build, and social-image verification
used Node.js 22.23.4 and pnpm 11.28.10. The existing jsdom 30.0.1 dependency
requires Node.js 22.22.2 or newer in the 22.x line; `package.json` and the README
now state that minimum. Initial checks also passed on 22.20.0, but the checks
above were repeated on the supported runtime. The three durable browser checks
were also repeated on 22.23.4. Demo and responsive browser journeys and initial
database setup used 22.20.0; those browser suites do not use jsdom.

All checks used a sanitized environment. No existing environment file was
copied or loaded. Payment, mail, monitoring, Maps, and analytics credentials
were absent; telemetry was disabled. Production
compilation used demo/mock switches set to false. A production server still
requires complete runtime configuration, including email delivery and an HTTPS
application URL. No live charge, refund, payout, or email was performed.

Browser checks used isolated Chromium and the repository's `next dev` server
configuration. Logs and HTML reports were retained only as temporary private
validation artifacts, outside the source changes. The screenshots in
`docs/screens/` are earlier fictional-data walkthroughs, not captures from these
runs.

## Remaining verification limits

- Browser evidence covers Chromium and `next dev`, not other browser engines or
  a running production build.
- Provider tests use controlled responses. They do not establish iyzico sandbox
  acceptance, live charges/refunds, onboarding, callbacks, or settlement.
- Hosted database permissions, mail delivery, production operation, legal launch
  readiness, and an independent security audit remain outside these results.
- The three lower-severity dependency advisories above remain open and require
  upstream-compatible fixes or a separately reviewed tooling upgrade.
