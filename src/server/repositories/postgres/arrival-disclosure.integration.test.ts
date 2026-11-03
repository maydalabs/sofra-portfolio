import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '@/server/database/client'

import { PostgresSofraOperatorWriteRepository } from './operator-write-repository'
import { PostgresSofraWriteRepository } from './write-repository'

/**
 * Telling a confirmed traveller where their dinner is -- and telling nobody
 * else, and not a moment early. The address is the most sensitive field in
 * the schema, so these tests assert the negative cases first.
 */
const database = getDatabase()
if (!database) throw new Error('DATABASE_URL is required for integration tests')
const sql = database

const TRAVELLER = '10000000-0000-4000-8000-000000000008' // Demo Traveler
const OPERATOR = '10000000-0000-4000-8000-000000000009' // Demo Operator
const POLICY = { takeRateBasisPoints: 2500, capturedAt: '2026-08-26T00:00:00Z' }

const bookings = new PostgresSofraWriteRepository(sql, TRAVELLER)
const operator = new PostgresSofraOperatorWriteRepository(sql, OPERATOR)

/**
 * Always created far enough out that create_booking accepts a seat -- the
 * cutoff is 36h before the dinner. Tests move the dinner closer afterwards
 * with moveDinnerTo(), which is what opens the disclosure window.
 */
async function createTable() {
  const [row] = await sql<{ id: string }[]>`
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
      ${'arrivaltest-' + crypto.randomUUID()},
      h.id, h.owner_profile_id, a.id,
      '20000000-0000-4000-8000-000000000001',
      now() + interval '10 days',
      'Kadıköy', 'shared', 'Test menu',
      'd', 'warm', 'Household', 'i', 'i',
      6, 6, 6, 1,
      45000, 60000,
      now() + interval '8 days',
      now() + interval '9 days',
      'published', now()
    from public.households h
    join public.household_private_addresses a on a.household_id = h.id
    limit 1
    returning id
  `
  return row.id
}

/**
 * Moves the dinner itself, leaving the already-made booking intact. The
 * cutoff and roster lock move with it: the schema requires
 * cutoff < roster_lock < starts_at.
 */
async function moveDinnerTo(tableId: string, hoursAway: number) {
  await sql`
    update public.hosted_tables
    set starts_at = now() + make_interval(hours => ${hoursAway}),
        booking_cutoff_at = now() + make_interval(hours => ${hoursAway - 36}),
        roster_lock_at = now() + make_interval(hours => ${hoursAway - 24})
    where id = ${tableId}::uuid
  `
}

function details(profileId: string, bookingId: string) {
  return sql<
    {
      disclosed: boolean
      disclose_from: string
      address_line_1: string | null
      arrival_instructions: string | null
      district: string | null
    }[]
  >`
    select * from public.get_booking_arrival_details(
      ${profileId}::uuid, ${bookingId}::uuid
    )
  `
}

async function book(tableId: string) {
  return bookings.createBooking({
    tableId,
    partySize: 1,
    partyType: 'solo',
    primaryGuestName: 'Arrival Test',
    policySnapshot: POLICY,
  })
}

async function cleanup() {
  const scoped = sql`
    select b.id from public.bookings b
    join public.hosted_tables t on t.id = b.hosted_table_id
    where t.slug like 'arrivaltest-%'
  `
  await sql`delete from public.audit_logs where entity_id in (${scoped})`
  await sql`delete from public.payment_records where booking_id in (${scoped})`
  await sql`
    delete from public.bookings where hosted_table_id in (
      select id from public.hosted_tables where slug like 'arrivaltest-%'
    )`
  await sql`delete from public.hosted_tables where slug like 'arrivaltest-%'`
}

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('arrival disclosure', () => {
  it('withholds the address from an unconfirmed booking inside the window', async () => {
    const tableId = await createTable()
    const booking = await book(tableId)
    await moveDinnerTo(tableId, 4)
    const [row] = await details(TRAVELLER, booking.id)

    // Close enough in time, but the seat is still a draft.
    expect(row.disclosed).toBe(false)
    expect(row.address_line_1).toBeNull()
    expect(row.arrival_instructions).toBeNull()
    expect(row.district).toBeNull()
    // It still says when to come back, which is the whole point.
    expect(row.disclose_from).toBeTruthy()
  })

  it('withholds the address from a confirmed booking before the window opens', async () => {
    const tableId = await createTable()
    const booking = await book(tableId)
    await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'none',
    })
    const [row] = await details(TRAVELLER, booking.id)
    expect(row.disclosed).toBe(false)
    expect(row.address_line_1).toBeNull()
    expect(row.arrival_instructions).toBeNull()
  })

  it('discloses to the confirmed traveller once the window opens', async () => {
    const tableId = await createTable()
    const booking = await book(tableId)
    await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'none',
    })
    await moveDinnerTo(tableId, 4)
    const [row] = await details(TRAVELLER, booking.id)
    expect(row.disclosed).toBe(true)
    expect(row.address_line_1).toBeTruthy()
    expect(row.district).toBeTruthy()
  })

  it('returns nothing at all to somebody else', async () => {
    const tableId = await createTable()
    const booking = await book(tableId)
    await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'none',
    })
    await moveDinnerTo(tableId, 4)
    // Not "disclosed: false" -- no row, so another traveller cannot even
    // learn that this booking exists.
    expect(await details(OPERATOR, booking.id)).toHaveLength(0)
  })

  it('never returns coordinates or household verification notes', async () => {
    const tableId = await createTable()
    const booking = await book(tableId)
    await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'none',
    })
    await moveDinnerTo(tableId, 4)
    const [row] = await details(TRAVELLER, booking.id)
    const fields = Object.keys(row)
    for (const forbidden of [
      'precise_latitude',
      'precise_longitude',
      'verification_notes',
      'verified_by',
      'household_id',
    ]) {
      expect(fields).not.toContain(forbidden)
    }
  })

  it('follows the configured window rather than a hard-coded one', async () => {
    const tableId = await createTable()
    const booking = await book(tableId)
    await moveDinnerTo(tableId, 24 * 5)
    await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'none',
    })
    expect((await details(TRAVELLER, booking.id))[0].disclosed).toBe(false)

    // Widen the policy window past the dinner's distance and it opens.
    await sql`
      update public.pricing_policies
      set arrival_disclosure_hours_before = 240
      where id = '20000000-0000-4000-8000-000000000001'::uuid
    `
    try {
      expect((await details(TRAVELLER, booking.id))[0].disclosed).toBe(true)
    } finally {
      await sql`
        update public.pricing_policies
        set arrival_disclosure_hours_before = 48
        where id = '20000000-0000-4000-8000-000000000001'::uuid
      `
    }
  })
})
