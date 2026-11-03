import { expect, test } from '@playwright/test'
import postgres from 'postgres'

/**
 * The real product, in a browser: a person who actually signs in, against a
 * real database, with demo mode off.
 *
 * Everything else in this directory runs the persona walkthrough, where
 * writes are deliberately refused. That is why a create form which validated
 * its input and saved nothing could sit in the repository for weeks with a
 * green suite: the integration tests call repositories directly, and no
 * browser test ever went through the durable path. This one does.
 */
const sql = postgres(
  process.env.DATABASE_URL ??
    'postgres://sofra:sofra_local_dev@127.0.0.1:54329/sofra',
  { max: 1 },
)

test.afterAll(async () => {
  await sql`delete from public.hosted_tables where menu_title like 'E2E durable%'`
  await sql.end()
})

/**
 * Signs in the way a person does: request a link, then follow it. The token
 * is read from the database because the development notification adapter
 * deliberately does not log the URL.
 */
async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/en/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: /sign-in link/i }).click()
  await expect(
    page.getByRole('heading', { name: /check your email/i }),
  ).toBeVisible()

  const [verification] = await sql<{ identifier: string }[]>`
    select identifier from public.verification
    where value::jsonb->>'email' = ${email}
    order by "createdAt" desc limit 1
  `
  expect(verification, `no magic link was issued for ${email}`).toBeTruthy()
  await page.goto(
    `/api/auth/magic-link/verify?token=${verification.identifier}&callbackURL=/en/account`,
  )
  await page.waitForURL(/\/en\/(account|host|admin)/)
}

test('demo mode is genuinely off on the durable server', async ({ page }) => {
  await page.goto('/en/account')
  // Without a session there is no demo persona to fall back on.
  await expect(page).toHaveURL(/\/en\/sign-in/)
})

test('a person can sign in with a magic link and reach their account', async ({
  page,
}) => {
  await signIn(page, 'demo08@sofra.invalid')
  await expect(page.getByText('demo08@sofra.invalid')).toBeVisible()
})

test('a certified host creates a table that is really written', async ({
  page,
}) => {
  // demo03 is certified and under the active-table limit.
  await signIn(page, 'demo03@sofra.invalid')
  await page.goto('/en/host/tables/new')

  const title = `E2E durable ${Date.now()}`
  const startsAt = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16)

  await page.getByLabel('Menu title').fill(title)
  await page.getByLabel('Date and start time').fill(startsAt)
  await page.getByLabel('Proposed traveler capacity').fill('4')
  await page.getByLabel('Minimum guest count').fill('2')
  await page.getByLabel('Desired net payout per traveler (TRY)').fill('1200')
  await page
    .getByLabel('Complete household-selected menu')
    .fill('Zeytinyağlı enginar, fırında levrek, mevsim salatası ve demli çay.')
  await page
    .getByLabel('Atmosphere')
    .fill('Sakin, sohbete açık bir akşam; balkonda çay ile biter.')
  await page
    .getByLabel('Expected household participants')
    .fill('Figen ve kızı sofraya katılır ve akşam boyunca masada kalır.')
  await page
    .getByLabel('Practical home information')
    .fill('İkinci kat, asansör yok. Ev kedisi var. Sigara içilmez.')

  await page.getByRole('button', { name: /draft/i }).click()

  // The proof is the row, not the screen: this form used to show a success
  // string having written nothing at all.
  await expect
    .poll(
      async () => {
        const rows = await sql<{ status: string }[]>`
          select status from public.hosted_tables where menu_title = ${title}
        `
        return rows[0]?.status ?? null
      },
      { timeout: 15_000, message: 'no hosted_tables row was created' },
    )
    .toBe('draft')

  const [row] = await sql<
    { host_net_payout_kurus: number; guest_price_kurus: number }[]
  >`
    select host_net_payout_kurus, guest_price_kurus
    from public.hosted_tables where menu_title = ${title}
  `
  // The host names their net in lira; the guest price is derived in SQL from
  // the pricing policy, never accepted from the browser.
  expect(row.host_net_payout_kurus).toBe(120_000)
  expect(row.guest_price_kurus).toBeGreaterThan(row.host_net_payout_kurus)
})
