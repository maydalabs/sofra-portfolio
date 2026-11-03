import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '@/server/database/client'

import { PostgresSofraOperatorWriteRepository } from './operator-write-repository'
import { PostgresSofraWriteRepository } from './write-repository'

/**
 * The read models the notification layer is allowed to use. These decide who
 * gets written to, so the assertions are mostly about what they refuse to
 * return.
 */
const database = getDatabase()
if (!database) throw new Error('DATABASE_URL is required for integration tests')
const sql = database

const TRAVELLER = '10000000-0000-4000-8000-000000000008'
const OPERATOR = '10000000-0000-4000-8000-000000000009'
const POLICY = { takeRateBasisPoints: 2500, capturedAt: '2026-08-26T00:00:00Z' }

const bookings = new PostgresSofraWriteRepository(sql, TRAVELLER)
const operator = new PostgresSofraOperatorWriteRepository(sql, OPERATOR)

async function createTable() {
  const [row] = await sql<{ id: string; owner: string }[]>`
    insert into public.hosted_tables (
      slug, household_id, lead_verified_host_id, private_address_id,
      pricing_policy_id, starts_at, public_neighborhood, format, menu_title,
      menu_description, atmosphere, expected_household_participants,
      practical_information, accessibility_information, proposed_capacity,
      certified_capacity, available_seats, minimum_guest_count,
      host_net_payout_kurus, guest_price_kurus, booking_cutoff_at,
      roster_lock_at, status, published_at
    )
    select
      ${'notifytest-' + crypto.randomUUID()},
      h.id, h.owner_profile_id, a.id,
      '20000000-0000-4000-8000-000000000001',
      now() + interval '10 days', 'Kuzguncuk', 'shared', 'Hamsili pilav',
      'd', 'warm', 'Household', 'i', 'i',
      6, 6, 6, 1,
      45000, 60000,
      now() + interval '8 days', now() + interval '9 days',
      'published', now()
    from public.households h
    join public.household_private_addresses a on a.household_id = h.id
    limit 1
    returning id, (select owner_profile_id from public.households where id = household_id) as owner
  `
  return row
}

function book(tableId: string) {
  return bookings.createBooking({
    tableId,
    partySize: 2,
    partyType: 'couple',
    primaryGuestName: 'Notify Test',
    policySnapshot: POLICY,
  })
}

async function cleanup() {
  const scoped = sql`
    select b.id from public.bookings b
    join public.hosted_tables t on t.id = b.hosted_table_id
    where t.slug like 'notifytest-%'`
  await sql`delete from public.audit_logs where entity_id in (${scoped})`
  await sql`delete from public.payment_records where booking_id in (${scoped})`
  await sql`
    delete from public.bookings where hosted_table_id in (
      select id from public.hosted_tables where slug like 'notifytest-%')`
  await sql`
    delete from public.payout_records where hosted_table_id in (
      select id from public.hosted_tables where slug like 'notifytest-%')`
  await sql`delete from public.hosted_tables where slug like 'notifytest-%'`
}

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('notification contact read models', () => {
  it('returns the traveller and the host, each labelled, with their language', async () => {
    const table = await createTable()
    const booking = await book(table.id)

    const rows = await sql<
      {
        party: string
        profile_id: string
        email: string
        preferred_locale: string
        menu_title: string
      }[]
    >`
      select * from public.get_booking_notification_contacts(${booking.id}::uuid)
    `
    expect(rows).toHaveLength(2)
    const traveller = rows.find((r) => r.party === 'traveller')
    const host = rows.find((r) => r.party === 'host')
    expect(traveller?.profile_id).toBe(TRAVELLER)
    expect(host?.profile_id).toBe(table.owner)
    for (const row of rows) {
      expect(row.email).toContain('@')
      expect(['en', 'tr']).toContain(row.preferred_locale)
      expect(row.menu_title).toBe('Hamsili pilav')
    }
  })

  it('carries the dinner s public face and nothing private', async () => {
    const booking = await book((await createTable()).id)
    const [row] = await sql<Record<string, unknown>[]>`
      select * from public.get_booking_notification_contacts(${booking.id}::uuid)
    `
    const fields = Object.keys(row)
    for (const forbidden of [
      'address_line_1',
      'arrival_instructions',
      'precise_latitude',
      'precise_longitude',
      'guest_total_kurus',
      'host_net_payout_kurus',
      'explanation',
    ]) {
      expect(fields).not.toContain(forbidden)
    }
    // The neighbourhood is the same thing the public listing already shows.
    expect(row.public_neighborhood).toBe('Kuzguncuk')
  })

  it('returns nothing for a booking that does not exist', async () => {
    const rows = await sql`
      select * from public.get_booking_notification_contacts(
        ${crypto.randomUUID()}::uuid
      )
    `
    expect(rows).toHaveLength(0)
  })

  it('reaches every traveller on a cancelled dinner, and only cancelled ones', async () => {
    const table = await createTable()
    const booking = await book(table.id)
    await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'none',
    })

    // Nothing is cancelled yet, so there is nobody to write to.
    expect(
      await sql`
        select * from public.get_cancelled_table_traveller_contacts(
          ${table.id}::uuid
        )`,
    ).toHaveLength(0)

    await operator.cancelPublishedTable(table.id, 'Host emergency')

    const recipients = await sql<{ profile_id: string; email: string }[]>`
      select * from public.get_cancelled_table_traveller_contacts(
        ${table.id}::uuid
      )
    `
    expect(recipients).toHaveLength(1)
    expect(recipients[0].profile_id).toBe(TRAVELLER)
    expect(recipients[0].email).toContain('@')
  })

  it('gives back only name, address and language for a set of people', async () => {
    const [row] = await sql<Record<string, unknown>[]>`
      select * from public.get_profile_contacts(array[${TRAVELLER}::uuid])
    `
    expect(Object.keys(row).sort()).toEqual([
      'display_name',
      'email',
      'preferred_locale',
      'profile_id',
    ])
  })
})
