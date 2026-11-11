import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDatabase } from '@/server/database/client'
import type { HostedTableStatus } from '@/server/database/database.types'
import type { ReviseHostedTableDraftInput } from '../write-contracts'

import { PostgresReadGateway } from './gateway'
import { PostgresSofraHostWriteRepository } from './host-write-repository'
import { PostgresSofraOperatorWriteRepository } from './operator-write-repository'
import { PostgresSofraReadRepository } from './read-repository'

const database = getDatabase()
if (!database) throw new Error('DATABASE_URL is required for integration tests')
const sql = database

// This suite owns its household, certification and tables; it does not change
// the fictional host fixtures or another suite's lifecycle state.
const HOST = '93000000-0000-4000-8000-000000000001'
const OTHER_HOST = '93000000-0000-4000-8000-000000000002'
const HOUSEHOLD = '93000000-0000-4000-8000-000000000003'
const ADDRESS = '93000000-0000-4000-8000-000000000004'
const CERTIFICATION = '93000000-0000-4000-8000-000000000005'
const OPERATOR = '10000000-0000-4000-8000-000000000009'

const host = new PostgresSofraHostWriteRepository(sql, HOST)
const otherHost = new PostgresSofraHostWriteRepository(sql, OTHER_HOST)
const operator = new PostgresSofraOperatorWriteRepository(sql, OPERATOR)

const revision = {
  menuTitle: 'Mercimek and a household supper',
  menuDescription:
    'Lentil soup, roasted vegetables and rice, followed by fruit and Turkish tea.',
  atmosphere: 'A relaxed evening with tea and conversation.',
  expectedHouseholdParticipants:
    'Both verified adult hosts join dinner and stay for tea.',
  practicalInformation: 'Please leave outdoor shoes at the entrance.',
  accessibilityInformation: 'There are two steps at the entrance.',
} satisfies Omit<ReviseHostedTableDraftInput, 'tableId'>

const editableColumns = [
  'menu_title',
  'menu_description',
  'atmosphere',
  'expected_household_participants',
  'practical_information',
  'accessibility_information',
]

async function cleanup() {
  await sql`
    delete from public.audit_logs
    where actor_profile_id in (${HOST}::uuid, ${OTHER_HOST}::uuid)
      or entity_id in (
        select id from public.hosted_tables where household_id = ${HOUSEHOLD}::uuid
      )
  `
  await sql`delete from public.hosted_tables where household_id = ${HOUSEHOLD}::uuid`
  await sql`delete from public.host_certifications where household_id = ${HOUSEHOLD}::uuid`
  await sql`delete from public.household_private_addresses where household_id = ${HOUSEHOLD}::uuid`
  await sql`delete from public.households where id = ${HOUSEHOLD}::uuid`
  await sql`delete from public.profiles where id in (${HOST}::uuid, ${OTHER_HOST}::uuid)`
}

async function createDraft() {
  return host.createHostedTableDraft({
    menuTitle: 'Original household supper',
    menuDescription: 'The original complete household-selected dinner menu.',
    startsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    format: 'shared',
    proposedCapacity: 4,
    minimumGuestCount: 2,
    hostNetPayoutKurus: 120_000,
    atmosphere: 'The original atmosphere.',
    expectedHouseholdParticipants: 'Two adults participate in dinner.',
    practicalInformation: 'The original practical details.',
    accessibilityInformation: 'The original accessibility details.',
  })
}

async function tableSnapshot(tableId: string) {
  const [row] = await sql<{ value: Record<string, unknown> }[]>`
    select to_jsonb(t) as value from public.hosted_tables t
    where id = ${tableId}::uuid
  `
  return row.value
}

async function revisionAudits(tableId: string) {
  return sql`
    select actor_profile_id, reason, previous_state, new_state
    from public.audit_logs
    where entity_id = ${tableId}::uuid and action = 'hosted_table.draft_revised'
    order by occurred_at
  `
}

beforeEach(async () => {
  await cleanup()
  await sql`
    insert into public.profiles (id, display_name)
    values (${HOST}::uuid, 'Revision host'), (${OTHER_HOST}::uuid, 'Other host')
  `
  await sql`
    insert into public.households (
      id, owner_profile_id, public_name, public_story, household_structure, status
    ) values (
      ${HOUSEHOLD}::uuid, ${HOST}::uuid, 'Revision household', 'A household story',
      'Two adults', 'certified'
    )
  `
  await sql`
    insert into public.household_private_addresses (
      id, household_id, address_line_1, district, city
    ) values (
      ${ADDRESS}::uuid, ${HOUSEHOLD}::uuid, 'PRIVATE TEST ADDRESS', 'Kadıköy', 'İstanbul'
    )
  `
  await sql`
    insert into public.host_certifications (
      id, household_id, lead_host_profile_id, status, certified_traveler_capacity,
      valid_from, valid_until
    ) values (
      ${CERTIFICATION}::uuid, ${HOUSEHOLD}::uuid, ${HOST}::uuid, 'active', 6,
      now() - interval '1 day', now() + interval '1 year'
    )
  `
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('reviseHostedTableDraft', () => {
  it('reads a fresh draft through revision and resubmission without coordinates or private details', async () => {
    const table = await createDraft()
    const reads = new PostgresSofraReadRepository(
      new PostgresReadGateway(sql, HOST),
      HOST,
    )
    const publicReads = new PostgresSofraReadRepository(
      new PostgresReadGateway(sql),
    )

    const expectReload = async (
      status: HostedTableStatus,
      content: Partial<typeof revision>,
    ) => {
      // Each read crosses the real gateway and mapper again, like reloading
      // the editor after a durable write rather than trusting its response.
      const reloaded = await reads.findHostTableById(table.id)
      expect(reloaded).toMatchObject({
        id: table.id,
        status,
        publicCoordinate: null,
        ...content,
      })
      for (const field of [
        'privateAddressId',
        'exactAddress',
        'preciseCoordinate',
        'arrivalInstructions',
        'private_address_id',
      ]) {
        expect(reloaded).not.toHaveProperty(field)
      }
      const serialized = JSON.stringify(reloaded)
      expect(serialized).not.toContain(ADDRESS)
      expect(serialized).not.toContain('PRIVATE TEST ADDRESS')
      expect(serialized).not.toContain('PRIVATE OPERATOR REVIEW NOTE')
      expect(
        await publicReads.findPublicTableBySlug(table.slug),
      ).toBeUndefined()
      expect(await tableSnapshot(table.id)).toMatchObject({
        public_approximate_latitude: null,
        public_approximate_longitude: null,
      })
    }

    await expectReload('draft', {
      menuTitle: 'Original household supper',
      menuDescription: 'The original complete household-selected dinner menu.',
    })

    await host.reviseHostedTableDraft({ tableId: table.id, ...revision })
    await expectReload('draft', revision)
    await host.submitHostedTable(table.id)
    await expectReload('submitted', revision)

    await operator.reviewHostedTable({
      tableId: table.id,
      decision: 'changes_requested',
      reason: 'PRIVATE OPERATOR REVIEW NOTE',
    })
    await expectReload('changes_requested', revision)

    const requestedRevision = {
      ...revision,
      menuTitle: 'Revised mercimek and a household supper',
      accessibilityInformation: '',
    }
    await host.reviseHostedTableDraft({
      tableId: table.id,
      ...requestedRevision,
    })
    await expectReload('changes_requested', requestedRevision)
    await host.submitHostedTable(table.id)
    await expectReload('submitted', requestedRevision)
  })

  it('saves trimmed draft text, preserves every other field, and audits no content', async () => {
    const table = await createDraft()
    const before = await tableSnapshot(table.id)
    const padded = Object.fromEntries(
      Object.entries(revision).map(([key, value]) => [
        key,
        ` \t\n\u00a0\ufeff${value}\u3000\r\n `,
      ]),
    ) as typeof revision

    const result = await host.reviseHostedTableDraft({
      tableId: table.id,
      ...padded,
    })
    const after = await tableSnapshot(table.id)

    expect(result).toEqual(table)
    expect(after).toMatchObject({
      menu_title: revision.menuTitle,
      menu_description: revision.menuDescription,
      atmosphere: revision.atmosphere,
      expected_household_participants: revision.expectedHouseholdParticipants,
      practical_information: revision.practicalInformation,
      accessibility_information: revision.accessibilityInformation,
    })
    const unchanged = (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([key]) => ![...editableColumns, 'updated_at'].includes(key),
        ),
      )
    expect(unchanged(after)).toEqual(unchanged(before))

    expect(await revisionAudits(table.id)).toEqual([
      {
        actor_profile_id: HOST,
        reason: null,
        previous_state: { status: 'draft' },
        new_state: { status: 'draft', changed_fields: editableColumns },
      },
    ])
  })

  it('saves requested changes without discarding the review note, then resubmits', async () => {
    const table = await createDraft()
    await host.submitHostedTable(table.id)
    await operator.reviewHostedTable({
      tableId: table.id,
      decision: 'changes_requested',
      reason: 'PRIVATE OPERATOR REVIEW NOTE',
    })
    const [reviewBefore] = await sql`
      select * from public.audit_logs
      where entity_id = ${table.id}::uuid and action = 'hosted_table.changes_requested'
    `

    const result = await host.reviseHostedTableDraft({
      tableId: table.id,
      ...revision,
    })
    expect(result.status).toBe('changes_requested')
    expect((await tableSnapshot(table.id)).menu_title).toBe(revision.menuTitle)
    expect((await revisionAudits(table.id))[0].new_state.status).toBe(
      'changes_requested',
    )
    const [reviewAfter] = await sql`
      select * from public.audit_logs where id = ${reviewBefore.id}::uuid
    `
    expect(reviewAfter).toEqual(reviewBefore)

    expect((await host.submitHostedTable(table.id)).status).toBe('submitted')
    expect((await tableSnapshot(table.id)).menu_title).toBe(revision.menuTitle)
  })

  it('allows empty accessibility text and records only the fields actually changed', async () => {
    const table = await createDraft()
    await host.reviseHostedTableDraft({ tableId: table.id, ...revision })
    await host.reviseHostedTableDraft({
      tableId: table.id,
      ...revision,
      accessibilityInformation: ' \t\n ',
    })
    const audits = await revisionAudits(table.id)
    expect((await tableSnapshot(table.id)).accessibility_information).toBe('')
    expect(audits[1].new_state.changed_fields).toEqual([
      'accessibility_information',
    ])
  })

  it('does not reveal or change another host’s table', async () => {
    const table = await createDraft()
    const before = await tableSnapshot(table.id)
    await expect(
      otherHost.reviseHostedTableDraft({ tableId: table.id, ...revision }),
    ).rejects.toMatchObject({ code: 'TABLE_NOT_FOUND' })
    expect(await tableSnapshot(table.id)).toEqual(before)
    expect(await revisionAudits(table.id)).toHaveLength(0)
  })

  it.each([
    'submitted',
    'approved',
    'published',
    'minimum_reached',
    'confirmed',
    'roster_locked',
    'completed',
    'cancelled',
    'archived',
  ] satisfies HostedTableStatus[])(
    'refuses revisions while %s',
    async (status) => {
      const table = await createDraft()
      await sql`
      update public.hosted_tables set status = ${status}::public.hosted_table_status
      where id = ${table.id}::uuid
    `
      const before = await tableSnapshot(table.id)
      await expect(
        host.reviseHostedTableDraft({ tableId: table.id, ...revision }),
      ).rejects.toMatchObject({ code: 'TABLE_NOT_EDITABLE' })
      expect(await tableSnapshot(table.id)).toEqual(before)
      expect(await revisionAudits(table.id)).toHaveLength(0)
    },
  )

  it('refuses a suspended household even if its certification remains active', async () => {
    const table = await createDraft()
    await sql`update public.households set status = 'suspended' where id = ${HOUSEHOLD}::uuid`
    await expect(
      host.reviseHostedTableDraft({ tableId: table.id, ...revision }),
    ).rejects.toMatchObject({ code: 'NO_CERTIFIED_HOUSEHOLD' })
    expect(await revisionAudits(table.id)).toHaveLength(0)
  })

  it.each(['pending', 'suspended', 'expired', 'revoked'])(
    'refuses a %s certification',
    async (status) => {
      const table = await createDraft()
      await sql`
        update public.host_certifications set status = ${status}::public.certification_status
        where id = ${CERTIFICATION}::uuid
      `
      await expect(
        host.reviseHostedTableDraft({ tableId: table.id, ...revision }),
      ).rejects.toMatchObject({ code: 'NO_ACTIVE_CERTIFICATION' })
      expect(await revisionAudits(table.id)).toHaveLength(0)
    },
  )

  it('refuses expired and not-yet-valid certification windows', async () => {
    const table = await createDraft()
    await sql`
      update public.host_certifications set valid_until = now() - interval '1 second'
      where id = ${CERTIFICATION}::uuid
    `
    await expect(
      host.reviseHostedTableDraft({ tableId: table.id, ...revision }),
    ).rejects.toMatchObject({ code: 'NO_ACTIVE_CERTIFICATION' })
    await sql`
      update public.host_certifications
      set valid_from = now() + interval '1 day', valid_until = now() + interval '1 year'
      where id = ${CERTIFICATION}::uuid
    `
    await expect(
      host.reviseHostedTableDraft({ tableId: table.id, ...revision }),
    ).rejects.toMatchObject({ code: 'NO_ACTIVE_CERTIFICATION' })
    expect(await revisionAudits(table.id)).toHaveLength(0)
  })

  it('rejects blank, short, null and overlong content without writing or auditing it', async () => {
    const table = await createDraft()
    const before = await tableSnapshot(table.id)
    const bounds = {
      menuTitle: [5, 100],
      menuDescription: [30, 1200],
      atmosphere: [10, 240],
      expectedHouseholdParticipants: [10, 240],
      practicalInformation: [10, 500],
      accessibilityInformation: [0, 500],
    } as const

    for (const [field, [minimum, maximum]] of Object.entries(bounds)) {
      const invalidValues = [null, 'a'.repeat(maximum + 1)]
      if (minimum > 0) {
        invalidValues.push(' \t\n\u00a0\ufeff ', 'a'.repeat(minimum - 1))
      }
      for (const value of invalidValues) {
        // Deliberately bypass the action's Zod validation: SQL is the final
        // boundary even when the TypeScript input contract is circumvented.
        await expect(
          host.reviseHostedTableDraft({
            tableId: table.id,
            ...revision,
            [field]: value,
          } as ReviseHostedTableDraftInput),
        ).rejects.toMatchObject({ code: 'TABLE_CONTENT_INVALID' })
      }
    }
    // A supplementary character occupies two JavaScript UTF-16 code units.
    await expect(
      host.reviseHostedTableDraft({
        tableId: table.id,
        ...revision,
        menuTitle: '🍲'.repeat(51),
      }),
    ).rejects.toMatchObject({ code: 'TABLE_CONTENT_INVALID' })
    expect(await tableSnapshot(table.id)).toEqual(before)
    expect(await revisionAudits(table.id)).toHaveLength(0)
  })

  it('accepts the exact lower and upper text bounds', async () => {
    const table = await createDraft()
    await host.reviseHostedTableDraft({
      tableId: table.id,
      menuTitle: 'a'.repeat(5),
      menuDescription: 'a'.repeat(30),
      atmosphere: 'a'.repeat(10),
      expectedHouseholdParticipants: 'a'.repeat(10),
      practicalInformation: 'a'.repeat(10),
      accessibilityInformation: '',
    })
    await host.reviseHostedTableDraft({
      tableId: table.id,
      menuTitle: '🍲'.repeat(50),
      menuDescription: 'a'.repeat(1200),
      atmosphere: 'a'.repeat(240),
      expectedHouseholdParticipants: 'a'.repeat(240),
      practicalInformation: 'a'.repeat(500),
      accessibilityInformation: 'a'.repeat(500),
    })
    expect((await tableSnapshot(table.id)).menu_title).toBe('🍲'.repeat(50))
  })

  it('rechecks editability after waiting for a concurrent submission', async () => {
    const table = await createDraft()
    const before = await tableSnapshot(table.id)
    let revisionResult: Promise<unknown> | undefined

    await sql.begin(async (transaction) => {
      await transaction`
        select * from public.submit_hosted_table(${HOST}::uuid, ${table.id}::uuid)
      `
      const [{ pid }] = await transaction<{ pid: number }[]>`
        select pg_backend_pid() as pid
      `
      // Attach a rejection handler immediately; this operation must wait for
      // the submitting transaction and then observe its committed status.
      revisionResult = host
        .reviseHostedTableDraft({ tableId: table.id, ...revision })
        .then(
          () => ({ unexpectedSuccess: true }),
          (error: unknown) => error,
        )
      await vi.waitFor(async () => {
        const [{ waiting }] = await sql<{ waiting: boolean }[]>`
          select exists (
            select 1 from pg_stat_activity
            where ${pid}::integer = any(pg_blocking_pids(pid))
          ) as waiting
        `
        expect(waiting).toBe(true)
      })
    })

    expect(await revisionResult).toMatchObject({ code: 'TABLE_NOT_EDITABLE' })
    const after = await tableSnapshot(table.id)
    expect(after.status).toBe('submitted')
    expect(after.menu_title).toBe(before.menu_title)
    expect(await revisionAudits(table.id)).toHaveLength(0)
  })
})
