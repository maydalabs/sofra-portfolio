'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { isHostCertificationActive } from '@/features/hosts/certification'
import { createAuditEntry } from '@/server/audit/audit'
import { getCurrentActor } from '@/server/auth/current-actor'
import { isDemoMode } from '@/server/auth/demo-session'
import {
  assertHasAnyRole,
  assertVerifiedEmail,
} from '@/server/authorization/roles'
import { createHostedTableSchema } from '@/features/hosted-tables/schemas'
import type { CreateHostedTableResult } from '@/features/hosted-tables/create-result'
import {
  findHostCertification,
  findHostTableById,
} from '@/server/repositories/queries'
import {
  canPersistWrites,
  getSofraHostWriteRepository,
} from '@/server/repositories/write-factory'
import { HostWriteError } from '@/server/repositories/write-contracts'
import { submitHostedTable } from '@/server/services/hosted-tables'
import { getServerTimeMilliseconds } from '@/server/time/clock'

export async function submitHostedTableAction(formData: FormData) {
  const actor = await getCurrentActor()
  if (!actor) throw new Error('Authentication required')
  assertHasAnyRole(actor, ['certified_host'])
  const tableId = String(formData.get('tableId'))
  const locale = formData.get('locale') === 'tr' ? 'tr' : 'en'
  const [table, certification] = await Promise.all([
    findHostTableById(actor.id, tableId),
    findHostCertification(actor.id),
  ])
  if (!table) throw new Error('Hosted table not found')
  if (table.status !== 'draft' && table.status !== 'changes_requested') {
    throw new Error('Only an editable host-owned table may be submitted')
  }
  const certificationActive = isHostCertificationActive(
    certification,
    new Date(getServerTimeMilliseconds()),
  )
  const status = submitHostedTable({
    currentStatus: table.status,
    actorSuspended: certification?.status === 'suspended',
    certificationActive,
  })
  if (canPersistWrites()) {
    try {
      const writes = await getSofraHostWriteRepository(actor.id)
      await writes.submitHostedTable(table.id)
    } catch (error) {
      if (error instanceof HostWriteError) {
        redirect(`/${locale}/host/tables/${table.id}/edit?submission=failed`)
      }
      throw error
    }
    redirect(`/${locale}/host/tables/${table.id}/edit?submission=submitted`)
  }

  if (!isDemoMode()) {
    redirect(`/${locale}/host/tables/${table.id}/edit?submission=unavailable`)
  }
  const audit = createAuditEntry({
    actorId: actor.id,
    action: 'hosted_table.submission_reviewed',
    entityType: 'hosted_table',
    entityId: tableId,
    reason: 'Local host submission transition review',
    previousState: { status: table.status },
    newState: { status },
  })
  console.info('[Sofra demo audit]', audit)
  redirect(`/${locale}/host/tables/${table.id}/edit?submission=reviewed`)
}

const checkInOutcomeByCode = {
  DINNER_NOT_STARTED: 'not_started',
  ROSTER_MISMATCH: 'roster_changed',
  UNRESOLVED_BOOKINGS: 'unresolved',
  TABLE_NOT_EDITABLE: 'already_completed',
} as const

export async function completeDinnerAction(formData: FormData) {
  const actor = await getCurrentActor()
  if (!actor) throw new Error('Authentication required')
  assertHasAnyRole(actor, ['certified_host'])
  const tableId = String(formData.get('tableId'))
  const locale = formData.get('locale') === 'tr' ? 'tr' : 'en'
  const rosterPath = `/${locale}/host/tables/${tableId}/roster`

  // One radio group per booking: attendance-<bookingId> = attended | no_show.
  const attended: string[] = []
  const noShow: string[] = []
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('attendance-')) continue
    const bookingId = key.slice('attendance-'.length)
    if (value === 'attended') attended.push(bookingId)
    else if (value === 'no_show') noShow.push(bookingId)
  }

  if (!canPersistWrites()) {
    redirect(`${rosterPath}?checkin=unavailable`)
  }

  try {
    const writes = await getSofraHostWriteRepository(actor.id)
    await writes.completeDinner({
      tableId,
      attendedBookingIds: attended,
      noShowBookingIds: noShow,
    })
  } catch (error) {
    if (error instanceof HostWriteError) {
      const outcome =
        error.code in checkInOutcomeByCode
          ? checkInOutcomeByCode[
              error.code as keyof typeof checkInOutcomeByCode
            ]
          : 'failed'
      redirect(`${rosterPath}?checkin=${outcome}`)
    }
    throw error
  }
  redirect(`${rosterPath}?checkin=completed`)
}

/**
 * Statuses this action can produce, kept as a closed union so the form can
 * render each one rather than showing a generic failure.
 */
const createOutcomeByCode = {
  NO_CERTIFIED_HOUSEHOLD: 'not_certified',
  NO_ACTIVE_CERTIFICATION: 'not_certified',
  NO_VERIFIED_ADDRESS: 'address_unverified',
  NO_PRICING_POLICY: 'unavailable',
  CAPACITY_EXCEEDS_CERTIFICATION: 'capacity_exceeded',
  SCHEDULE_OUT_OF_WINDOW: 'schedule_rejected',
  ACTIVE_TABLE_LIMIT_REACHED: 'table_limit_reached',
} as const

/**
 * Creates a host's own table draft.
 *
 * The form validated these values in the browser and this validates them
 * again, because a client-side schema is a convenience and not a boundary.
 * The price the traveller will pay is never accepted from here: the host
 * names their net, and create_hosted_table_draft derives the guest price from
 * the pricing policy in SQL, so the two can never disagree.
 */
export async function createHostedTableAction(
  rawInput: unknown,
  locale = 'en',
): Promise<CreateHostedTableResult> {
  const actor = await getCurrentActor()
  if (!actor) throw new Error('Authentication required')
  assertVerifiedEmail(actor)
  assertHasAnyRole(actor, ['certified_host'])

  const parsed = createHostedTableSchema.safeParse(rawInput)
  if (!parsed.success) return { status: 'invalid_request' }

  if (!canPersistWrites()) return { status: 'unavailable' }

  let table
  try {
    const writes = await getSofraHostWriteRepository(actor.id)
    table = await writes.createHostedTableDraft({
      menuTitle: parsed.data.menuTitle,
      menuDescription: parsed.data.menuDescription,
      startsAt: new Date(parsed.data.startsAt).toISOString(),
      format: parsed.data.format,
      proposedCapacity: parsed.data.proposedCapacity,
      minimumGuestCount: parsed.data.minimumGuestCount,
      // The form collects whole lira, which is what a host thinks in; the
      // domain is integer kurus everywhere below this line.
      hostNetPayoutKurus: Math.round(parsed.data.hostNetPayoutTry * 100),
      atmosphere: parsed.data.atmosphere,
      expectedHouseholdParticipants: parsed.data.expectedHouseholdParticipants,
      practicalInformation: parsed.data.practicalInformation,
    })
  } catch (error) {
    if (error instanceof HostWriteError) {
      const outcome =
        error.code in createOutcomeByCode
          ? createOutcomeByCode[error.code as keyof typeof createOutcomeByCode]
          : 'unexpected_error'
      return { status: outcome }
    }
    throw error
  }

  // Outside the catch: redirect() signals by throwing, and swallowing it here
  // would turn a successful draft into an "unexpected error".
  revalidatePath(`/${locale}/host/tables`)
  redirect(`/${locale}/host/tables/${table.id}/edit?created=1`)
}
