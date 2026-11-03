import { expect, test, type Page } from '@playwright/test'

/**
 * Nothing may scroll sideways, at any width we claim to support.
 *
 * A previous pass fixed mobile overflow by hand at one width and confirmed it
 * by eye. That holds until the next component lands. This measures instead:
 * every route, every breakpoint, both languages, asserting the document is
 * never wider than its viewport -- and naming the widest element when it is,
 * so a failure says what to fix rather than only that something broke.
 */
const WIDTHS = [
  { name: 'small phone', width: 320, height: 720 },
  { name: 'phone', width: 375, height: 812 },
  { name: 'large phone', width: 414, height: 896 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
]

/**
 * Each route with the persona that can actually SEE it.
 *
 * Getting this wrong is not a small mistake: without the right persona every
 * portal route renders the "needs a different account role" card instead of
 * its own content, and a sweep that measures the refusal page reports a clean
 * bill of health for pages it never looked at.
 */
type Persona = 'traveler' | 'host' | 'operator' | 'partner'

const ROUTES: { path: string; persona: Persona }[] = [
  { path: '/en', persona: 'traveler' },
  { path: '/en/tables', persona: 'traveler' },
  { path: '/en/how-it-works', persona: 'traveler' },
  { path: '/en/host', persona: 'traveler' },
  { path: '/en/host/apply', persona: 'traveler' },
  { path: '/en/sign-in', persona: 'traveler' },
  { path: '/en/account', persona: 'traveler' },
  { path: '/en/account/bookings', persona: 'traveler' },
  { path: '/en/account/dietary', persona: 'traveler' },
  { path: '/en/account/profile', persona: 'traveler' },
  { path: '/en/host/dashboard', persona: 'host' },
  { path: '/en/host/tables', persona: 'host' },
  { path: '/en/host/tables/new', persona: 'host' },
  { path: '/en/host/household', persona: 'host' },
  { path: '/en/host/address', persona: 'host' },
  { path: '/en/admin', persona: 'operator' },
  { path: '/en/admin/bookings', persona: 'operator' },
  { path: '/en/admin/host-applications', persona: 'operator' },
  { path: '/en/admin/tables', persona: 'operator' },
  { path: '/en/admin/payouts', persona: 'operator' },
  { path: '/en/admin/incidents', persona: 'operator' },
  { path: '/en/admin/compatibility', persona: 'operator' },
  { path: '/en/admin/reviews', persona: 'operator' },
  { path: '/en/admin/audit', persona: 'operator' },
  { path: '/en/admin/pricing', persona: 'operator' },
  { path: '/en/partner', persona: 'partner' },
]

async function actAs(page: Page, persona: Persona) {
  await page.context().addCookies([
    {
      name: 'sofra_demo_persona',
      value: persona,
      url: 'http://127.0.0.1:3107',
    },
  ])
}

/**
 * A portal page that fell back to the role-refusal card was never measured.
 * Failing loudly here is the point: a silent fallback is how a sweep reports
 * success for pages it did not see.
 */
async function assertNotRefused(page: Page, route: string) {
  // Check the destination as well as the English refusal heading: localized
  // redirects must not let a narrow access-denied page pass as the real UI.
  expect(
    new URL(page.url()).pathname,
    `${route} redirected, so its responsive layout was not measured`,
  ).toBe(route)
  const refused = await page
    .getByRole('heading', { name: /different account role/i })
    .count()
  expect(
    refused,
    `${route} rendered the role-refusal card, so nothing on it was measured`,
  ).toBe(0)
}

/**
 * Returns the overflow, and the element responsible for it. Reporting only a
 * number turns every failure into a manual hunt.
 */
async function measureOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const overflow = doc.scrollWidth - doc.clientWidth
    if (overflow <= 0) return { overflow: 0, culprit: null as string | null }

    let worst: { selector: string; right: number } | null = null
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.right <= doc.clientWidth + 1) continue
      if (!worst || rect.right > worst.right) {
        const cls =
          typeof el.className === 'string' && el.className
            ? `.${el.className.trim().split(/\s+/).slice(0, 4).join('.')}`
            : ''
        worst = {
          selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`,
          right: Math.round(rect.right),
        }
      }
    }
    return {
      overflow,
      culprit: worst ? `${worst.selector} (extends to ${worst.right}px)` : null,
    }
  })
}

for (const size of WIDTHS) {
  test.describe(`${size.name} (${size.width}px)`, () => {
    for (const { path: route, persona } of ROUTES) {
      test(`${route} does not scroll sideways`, async ({ page }) => {
        await actAs(page, persona)
        await page.setViewportSize({ width: size.width, height: size.height })
        await page.goto(route, { waitUntil: 'networkidle' })
        await assertNotRefused(page, route)
        const { overflow, culprit } = await measureOverflow(page)
        expect(
          overflow,
          `${route} overflows by ${overflow}px at ${size.width}px. Widest element: ${culprit ?? 'unknown'}`,
        ).toBeLessThanOrEqual(0)
      })
    }
  })
}

test.describe('Turkish, which runs 15-30% longer than English', () => {
  const routes: { path: string; persona: Persona }[] = [
    { path: '/tr', persona: 'traveler' },
    { path: '/tr/tables', persona: 'traveler' },
    { path: '/tr/admin/bookings', persona: 'operator' },
    { path: '/tr/admin/payouts', persona: 'operator' },
    { path: '/tr/host/tables/new', persona: 'host' },
  ]

  for (const { path: route, persona } of routes) {
    test(`${route} does not scroll sideways at 375px`, async ({ page }) => {
      await actAs(page, persona)
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(route, { waitUntil: 'networkidle' })
      await assertNotRefused(page, route)
      const { overflow, culprit } = await measureOverflow(page)
      expect(
        overflow,
        `${route} overflows by ${overflow}px. Widest element: ${culprit ?? 'unknown'}`,
      ).toBeLessThanOrEqual(0)
    })
  }
})
