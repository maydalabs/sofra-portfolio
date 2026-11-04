import { expect, test } from '@playwright/test'
import postgres from 'postgres'

import en from '../messages/en.json'
import tr from '../messages/tr.json'

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
      and value::jsonb->>'type' = 'magic-link'
      and identifier like 'magic-link:%'
    order by "createdAt" desc limit 1
  `
  expect(verification, `no magic link was issued for ${email}`).toBeTruthy()
  // Better Auth namespaces stored verification identifiers; the emailed token
  // excludes that prefix. Never interpret another verification type as a link.
  expect(verification.identifier).toMatch(/^magic-link:.+$/)
  const token = verification.identifier.slice('magic-link:'.length)
  await page.goto(
    `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=/en/account`,
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

test('a certified host creates, revises and resubmits a durable table', async ({
  page,
}) => {
  test.setTimeout(90_000)
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
    { id: string; host_net_payout_kurus: number; guest_price_kurus: number }[]
  >`
    select id, host_net_payout_kurus, guest_price_kurus
    from public.hosted_tables where menu_title = ${title}
  `
  // The host names their net in lira; the guest price is derived in SQL from
  // the pricing policy, never accepted from the browser.
  expect(row.host_net_payout_kurus).toBe(120_000)
  expect(row.guest_price_kurus).toBeGreaterThan(row.host_net_payout_kurus)

  const readTable = async () => {
    const [state] = await sql<
      {
        status: string
        menu_title: string
        menu_description: string
        unchanged: Record<string, unknown>
      }[]
    >`
      select status, menu_title, menu_description,
        jsonb_build_object(
          'slug', slug, 'format', format,
          'starts_at', starts_at, 'booking_cutoff_at', booking_cutoff_at,
          'roster_lock_at', roster_lock_at,
          'proposed_capacity', proposed_capacity,
          'certified_capacity', certified_capacity,
          'available_seats', available_seats,
          'minimum_guest_count', minimum_guest_count,
          'host_net_payout_kurus', host_net_payout_kurus,
          'guest_price_kurus', guest_price_kurus
        ) as unchanged
      from public.hosted_tables where id = ${row.id}::uuid
    `
    return state
  }
  const original = await readTable()
  const privateReviewNote =
    'E2E private operator review note: never show to hosts'

  // Exercise both editable states and languages through the real save action.
  for (const scenario of [
    {
      locale: 'en',
      copy: en,
      status: 'draft',
      title: `${title} revised`,
      menu: 'Lentil soup, seasonal vegetables, pilaf, fruit and Turkish tea.',
    },
    {
      locale: 'tr',
      copy: tr,
      status: 'changes_requested',
      title: `${title} yeniden`,
      menu: 'Mercimek çorbası, zeytinyağlı sebzeler, pilav, meyve ve demli çay.',
    },
  ]) {
    if (scenario.status === 'changes_requested') {
      // Operator review is setup; the host must perform the revision in the UI.
      await sql`
        select public.review_hosted_table(
          '10000000-0000-4000-8000-000000000009'::uuid,
          ${row.id}::uuid, 'changes_requested', ${privateReviewNote}
        )
      `
    }
    const before = await readTable()
    const copy = scenario.copy.ReviseTable
    await page.goto(`/${scenario.locale}/host/tables/${row.id}/edit`)
    const titleInput = page.getByLabel(copy.fields.menuTitle, { exact: true })
    const menuInput = page.getByLabel(copy.fields.menuDescription, {
      exact: true,
    })
    await expect(titleInput).toHaveValue(before.menu_title)
    await expect(menuInput).toHaveValue(before.menu_description)
    expect(await page.content()).not.toContain(privateReviewNote)

    await titleInput.fill(scenario.title)
    await menuInput.fill(scenario.menu)
    const submit = page.getByRole('button', {
      name: scenario.copy.HostPortal.submit,
      exact: true,
    })
    await expect(submit).toBeDisabled()
    await page.getByRole('button', { name: copy.save, exact: true }).click()
    await expect(
      page.getByText(copy.outcomes.saved, { exact: true }),
    ).toBeVisible()
    await expect.poll(readTable).toEqual({
      status: scenario.status,
      menu_title: scenario.title,
      menu_description: scenario.menu,
      unchanged: original.unchanged,
    })

    await page.reload()
    await expect(titleInput).toHaveValue(scenario.title)
    await expect(menuInput).toHaveValue(scenario.menu)
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page).toHaveURL(/submission=submitted/)
    await expect(titleInput).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: copy.save, exact: true }),
    ).toHaveCount(0)
    await expect.poll(async () => (await readTable()).status).toBe('submitted')
    expect(await page.content()).not.toContain(privateReviewNote)
  }
})
