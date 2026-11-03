import { defineConfig, devices } from '@playwright/test'

const e2ePort = Number(process.env.SOFRA_E2E_PORT ?? '3107')
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`

/**
 * Two suites, two runs, one config.
 *
 * `pnpm test:e2e` runs the persona walkthrough with demo mode on, where
 * writes are refused on purpose. `pnpm test:e2e:durable` runs the real
 * product: demo mode off, a person who actually signs in, rows that actually
 * land in the database.
 *
 * They cannot share a server -- next dev refuses to run twice from one
 * directory, and the two need opposite settings -- so they are separate
 * commands. Both are shipped, so both are tested; the durable half existing
 * at all is what would have caught a create form that saved nothing.
 */
const demoMode = process.env.SOFRA_DEMO_MODE ?? 'true'
const durable = demoMode === 'false'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: e2eBaseUrl,
    trace: 'on-first-retry',
  },
  projects: durable
    ? [
        {
          name: 'durable',
          testMatch: /durable-.*\.spec\.ts/,
          use: { ...devices['Desktop Chrome'] },
        },
      ]
    : [
        {
          name: 'chromium',
          testIgnore: /durable-.*\.spec\.ts/,
          use: { ...devices['Desktop Chrome'] },
        },
      ],
  webServer: {
    command: `pnpm dev --hostname 127.0.0.1 --port ${e2ePort}`,
    url: `${e2eBaseUrl}/en`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { SOFRA_DEMO_MODE: demoMode, NEXT_PUBLIC_APP_URL: e2eBaseUrl },
  },
})
