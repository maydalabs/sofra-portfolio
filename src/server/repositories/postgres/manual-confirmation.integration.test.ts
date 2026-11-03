import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '@/server/database/client'

import { PostgresSofraHostWriteRepository } from './host-write-repository'
import { PostgresSofraOperatorWriteRepository } from './operator-write-repository'
import { PostgresSofraWriteRepository } from './write-repository'

/**
 * Confirming a booking without a card payment, and the chain it unblocks.
 *
 * Before this existed, 'confirmed' was written in exactly one place in the
 * schema -- record_payment_authorized -- so with no payment provider every
 * booking stayed 'draft', the host roster was empty, and no dinner could be
 * completed. These tests walk that whole chain to its end.
 */
const database = getDatabase()
if (!database) throw new Error('DATABASE_URL is required for integration tests')
const sql = database

const TRAVELLER = '10000000-0000-4000-8000-000000000008' // Demo Traveler
const OPERATOR = '10000000-0000-4000-8000-000000000009' // Demo Operator
const POLICY = { takeRateBasisPoints: 2500, capturedAt: '2026-08-26T00:00:00Z' }

async function createTable(minimum = 1) {
  const [row] = await sql<{ id: string; host_id: string }[]>`
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
      ${'manualtest-' + crypto.randomUUID()},
      h.id, h.owner_profile_id, a.id,
      '20000000-0000-4000-8000-000000000001',
      now() + interval '10 days', 'Kadıköy', 'shared', 'Test menu',
      'd', 'warm', 'Household', 'i', 'i',
      6, 6, 6, ${minimum},
      45000, 60000,
      now() + interval '8 days', now() + interval '9 days',
      'published', now()
    from public.households h
    join public.household_private_addresses a on a.household_id = h.id
    limit 1
    returning id, lead_verified_host_id as host_id
  `
  return { tableId: row.id, hostId: row.host_id }
}

const bookings = new PostgresSofraWriteRepository(sql, TRAVELLER)
const operator = new PostgresSofraOperatorWriteRepository(sql, OPERATOR)
const traveller = new PostgresSofraOperatorWriteRepository(sql, TRAVELLER)

function book(tableId: string, dietaryDisclosure: string | null = null) {
  return bookings.createBooking({
    tableId,
    partySize: 2,
    partyType: 'couple',
    primaryGuestName: 'Manual Test',
    dietaryDisclosure,
    policySnapshot: POLICY,
  })
}

async function cleanup() {
  const scoped = sql`
    select b.id from public.bookings b
    join public.hosted_tables t on t.id = b.hosted_table_id
    where t.slug like 'manualtest-%'
  `
  await sql`delete from public.audit_logs where entity_id in (${scoped})`
  await sql`
    delete from public.audit_logs where entity_id in (
      select id from public.hosted_tables where slug like 'manualtest-%'
    )`
  await sql`delete from public.booking_check_ins where booking_id in (${scoped})`
  await sql`delete from public.public_experience_reviews where booking_id in (${scoped})`
  await sql`delete from public.refunds where booking_id in (${scoped})`
  await sql`delete from public.payment_records where booking_id in (${scoped})`
  await sql`
    delete from public.payout_records where hosted_table_id in (
      select id from public.hosted_tables where slug like 'manualtest-%'
    )`
  await sql`
    delete from public.bookings where hosted_table_id in (
      select id from public.hosted_tables where slug like 'manualtest-%'
    )`
  await sql`delete from public.hosted_tables where slug like 'manualtest-%'`
}

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('confirming a booking without a card payment', () => {
  it('confirms on a no-money basis and leaves nothing refundable', async () => {
    const { tableId } = await createTable()
    const booking = await book(tableId)
    expect(booking.status).toBe('draft')

    const confirmed = await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'none',
      reason: 'Pilot dinner, no charge',
    })

    expect(confirmed.status).toBe('confirmed')
    // Sofra collected nothing, so there is nothing to give back.
    expect(confirmed.paymentStatus).toBe('not_started')

    const records = await sql`
      select 1 from public.payment_records where booking_id = ${booking.id}::uuid
    `
    expect(records).toHaveLength(0)

    const cancelled = await bookings.cancelBooking(booking.id, 'changed mind')
    expect(cancelled.refundDueKurus).toBe(0)

    const [audit] = await sql<
      {
        new_state: {
          settlement_basis: string
          money_collected_by_sofra: boolean
        }
      }[]
    >`
      select new_state from public.audit_logs
      where action = 'booking.confirmed_manually'
        and entity_id = ${booking.id}::uuid
    `
    expect(audit.new_state.settlement_basis).toBe('none')
    expect(audit.new_state.money_collected_by_sofra).toBe(false)
  })

  it('records money received off-platform through the ledger, refundable as usual', async () => {
    const { tableId } = await createTable()
    const booking = await book(tableId)

    const confirmed = await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'off_platform',
      reference: 'EFT-2026-0917',
      reason: 'Bank transfer received',
    })
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.paymentStatus).toBe('authorized')

    const [record] = await sql<
      {
        provider_code: string
        provider_reference: string
        amount_kurus: number
      }[]
    >`
      select provider_code, provider_reference, amount_kurus
      from public.payment_records where booking_id = ${booking.id}::uuid
    `
    expect(record.provider_code).toBe('manual')
    expect(record.provider_reference).toBe('EFT-2026-0917')
    // The amount is the one the database computed, never one an operator typed.
    expect(record.amount_kurus).toBe(booking.guestTotalKurus)

    // Because it went through the ledger, the refund policy applies normally.
    const cancelled = await bookings.cancelBooking(booking.id, 'changed mind')
    expect(cancelled.refundDueKurus).toBe(booking.guestTotalKurus)
  })

  it('honours the same status rule as a card payment', async () => {
    // Below the minimum: parked, not confirmed.
    const belowMinimum = await createTable(4)
    const parked = await operator.confirmBookingManually({
      bookingId: (await book(belowMinimum.tableId)).id,
      settlementBasis: 'none',
    })
    expect(parked.status).toBe('pending_minimum')

    // A pending dietary assessment must be decided by a human first.
    const withDisclosure = await createTable()
    const pending = await operator.confirmBookingManually({
      bookingId: (await book(withDisclosure.tableId, 'severe nut allergy')).id,
      settlementBasis: 'none',
    })
    expect(pending.status).toBe('payment_authorized')
  })

  it('is operator-only, validated, and refuses a booking that already moved', async () => {
    const { tableId } = await createTable()
    const booking = await book(tableId)

    await expect(
      traveller.confirmBookingManually({
        bookingId: booking.id,
        settlementBasis: 'none',
      }),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })

    await expect(
      operator.confirmBookingManually({
        bookingId: booking.id,
        settlementBasis: 'off_platform',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SETTLEMENT_BASIS' })

    await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'none',
    })
    await expect(
      operator.confirmBookingManually({
        bookingId: booking.id,
        settlementBasis: 'none',
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_CONFIRMABLE' })
  })

  it('accepting a dietary disclosure actually unblocks the dinner', async () => {
    // This is the trap: create_booking parks a disclosure at 'pending',
    // settled_booking_status maps that to 'payment_authorized', and
    // complete_dinner refuses (SF040) while any booking sits there. Accepting
    // used to write compatibility_status and nothing else, so one guest with
    // an allergy froze the whole table permanently.
    const { tableId, hostId } = await createTable()
    const booking = await book(tableId, 'severe nut allergy')
    const confirmed = await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'none',
    })
    expect(confirmed.status).toBe('payment_authorized')

    const decided = await operator.decideDietaryCompatibility(
      booking.id,
      'accepted',
      'The existing menu contains no nuts',
    )
    expect(decided.compatibilityStatus).toBe('accepted')

    const [row] = await sql<{ status: string }[]>`
      select status from public.bookings where id = ${booking.id}::uuid
    `
    expect(row.status).toBe('confirmed')

    // And the dinner can now actually be completed.
    await sql`
      update public.hosted_tables
      set starts_at = now() - interval '3 hours',
          booking_cutoff_at = now() - interval '2 days',
          roster_lock_at = now() - interval '1 day'
      where id = ${tableId}::uuid
    `
    const host = new PostgresSofraHostWriteRepository(sql, hostId)
    const completion = await host.completeDinner({
      tableId,
      attendedBookingIds: [booking.id],
      noShowBookingIds: [],
    })
    expect(completion.attendedCount).toBe(1)
  })

  it('gives an operator a way out of a declined disclosure', async () => {
    const { tableId, hostId } = await createTable()
    const declined = await book(tableId, 'severe shellfish allergy')
    const joining = await book(tableId)
    await operator.confirmBookingManually({
      bookingId: declined.id,
      settlementBasis: 'none',
    })
    await operator.confirmBookingManually({
      bookingId: joining.id,
      settlementBasis: 'none',
    })
    await operator.decideDietaryCompatibility(
      declined.id,
      'declined',
      'The household cannot serve this safely',
    )

    // Declining is the right answer sometimes, but only the traveller could
    // cancel their own seat, so the dinner stayed frozen for everyone.
    const cancelled = await operator.cancelBookingByPlatform(
      declined.id,
      'Dietary compatibility declined',
    )
    expect(cancelled.status).toBe('cancelled')
    // Nothing was collected on this seat, so nothing is owed back.
    expect(cancelled.refundDueKurus).toBe(0)

    const [audit] = await sql<{ new_state: { was_paid: boolean } }[]>`
      select new_state from public.audit_logs
      where action = 'booking.cancelled_by_platform'
        and entity_id = ${declined.id}::uuid
    `
    expect(audit.new_state.was_paid).toBe(false)

    // The rest of the table is unblocked.
    await sql`
      update public.hosted_tables
      set starts_at = now() - interval '3 hours',
          booking_cutoff_at = now() - interval '2 days',
          roster_lock_at = now() - interval '1 day'
      where id = ${tableId}::uuid
    `
    const host = new PostgresSofraHostWriteRepository(sql, hostId)
    const completion = await host.completeDinner({
      tableId,
      attendedBookingIds: [joining.id],
      noShowBookingIds: [],
    })
    expect(completion.attendedCount).toBe(1)
  })

  it('refuses a platform cancellation without a reason, and on a finished booking', async () => {
    const { tableId } = await createTable()
    const booking = await book(tableId)
    await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'none',
    })

    await expect(
      operator.cancelBookingByPlatform(booking.id, '   '),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })

    await operator.cancelBookingByPlatform(booking.id, 'Compatibility declined')
    await expect(
      operator.cancelBookingByPlatform(booking.id, 'Again'),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_CANCELLABLE' })
  })

  it('opens the whole chain a draft booking used to block', async () => {
    const { tableId, hostId } = await createTable()
    const booking = await book(tableId)
    const host = new PostgresSofraHostWriteRepository(sql, hostId)

    // Before confirmation the host cannot see the guest at all.
    const emptyRoster = await sql`
      select * from public.get_host_roster(${tableId}::uuid, ${hostId}::uuid)
    `
    expect(emptyRoster).toHaveLength(0)

    await operator.confirmBookingManually({
      bookingId: booking.id,
      settlementBasis: 'none',
      reason: 'Pilot',
    })

    const roster = await sql`
      select * from public.get_host_roster(${tableId}::uuid, ${hostId}::uuid)
    `
    expect(roster).toHaveLength(1)

    await sql`
      update public.hosted_tables
      set starts_at = now() - interval '3 hours',
          booking_cutoff_at = now() - interval '2 days',
          roster_lock_at = now() - interval '1 day'
      where id = ${tableId}::uuid
    `

    const completion = await host.completeDinner({
      tableId,
      attendedBookingIds: [booking.id],
      noShowBookingIds: [],
    })
    expect(completion.attendedCount).toBe(1)
    expect(completion.payoutId).toBeTruthy()

    // And the post-dinner channels, which all require 'completed', are open.
    const [row] = await sql<{ status: string }[]>`
      select status from public.bookings where id = ${booking.id}::uuid
    `
    expect(row.status).toBe('completed')
  })
})
