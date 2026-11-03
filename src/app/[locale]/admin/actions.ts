'use server'

import { redirect } from 'next/navigation'

import { createAuditEntry } from '@/server/audit/audit'
import { getCurrentActor } from '@/server/auth/current-actor'
import {
  assertHasAnyRole,
  assertVerifiedEmail,
} from '@/server/authorization/roles'
import type { IncidentStatus } from '@/server/database/database.types'
import {
  getBookingNotificationContext,
  getCancelledTableRecipients,
  getProfileContacts,
  notify,
} from '@/server/notifications/dispatch'
import {
  OperatorWriteError,
  type SettlementBasis,
} from '@/server/repositories/write-contracts'
import {
  canPersistWrites,
  getSofraOperatorWriteRepository,
} from '@/server/repositories/write-factory'
import { approveHostedTable } from '@/server/services/hosted-tables'

async function requireOperator() {
  const actor = await getCurrentActor()
  if (!actor) throw new Error('Authentication required')
  assertHasAnyRole(actor, ['operator', 'administrator'])
  return actor
}

function localeOf(formData: FormData) {
  return formData.get('locale') === 'tr' ? 'tr' : 'en'
}

/** Turns a domain failure into a query flag the admin pages already render. */
/** The seat is only "confirmed" when the database says so. */
function confirmationNotice(status: string) {
  if (status === 'payment_authorized') return 'booking_awaiting_compatibility'
  if (status === 'pending_minimum') return 'booking_awaiting_minimum'
  return 'booking_confirmed'
}

function outcomeOf(error: unknown) {
  if (error instanceof OperatorWriteError) return error.code.toLowerCase()
  throw error
}

export async function approveTableAction(formData: FormData) {
  const actor = await requireOperator()
  assertVerifiedEmail(actor)
  const tableId = String(formData.get('tableId'))
  const locale = localeOf(formData)

  if (canPersistWrites()) {
    try {
      const writes = await getSofraOperatorWriteRepository(actor)
      await writes.reviewHostedTable({ tableId, decision: 'approve' })
    } catch (error) {
      redirect(`/${locale}/admin/tables/${tableId}?error=${outcomeOf(error)}`)
    }
    redirect(`/${locale}/admin/tables/${tableId}?notice=table_approved`)
  }

  const status = approveHostedTable({
    currentStatus: 'submitted',
    actorRoles: actor.roles,
  })
  console.info(
    '[Sofra demo audit]',
    createAuditEntry({
      actorId: actor.id,
      action: 'hosted_table.approved',
      entityType: 'hosted_table',
      entityId: tableId,
      reason: 'Development approval action',
      previousState: { status: 'submitted' },
      newState: { status },
    }),
  )
  redirect(`/${locale}/admin/tables/${tableId}?notice=table_approved`)
}

export async function requestTableChangesAction(formData: FormData) {
  const actor = await requireOperator()
  const tableId = String(formData.get('tableId'))
  const locale = localeOf(formData)
  const reason = String(
    formData.get('reason') ?? 'Clarify household participation',
  )

  if (canPersistWrites()) {
    try {
      const writes = await getSofraOperatorWriteRepository(actor)
      await writes.reviewHostedTable({
        tableId,
        decision: 'changes_requested',
        reason,
      })
    } catch (error) {
      redirect(`/${locale}/admin/tables/${tableId}?error=${outcomeOf(error)}`)
    }
    redirect(
      `/${locale}/admin/tables/${tableId}?notice=table_changes_requested`,
    )
  }

  console.info(
    '[Sofra demo audit]',
    createAuditEntry({
      actorId: actor.id,
      action: 'hosted_table.changes_requested',
      entityType: 'hosted_table',
      entityId: tableId,
      reason,
      previousState: { status: 'submitted' },
      newState: { status: 'changes_requested' },
    }),
  )
  redirect(`/${locale}/admin/tables/${tableId}?notice=table_changes_requested`)
}

/**
 * Publication is the act that makes a table bookable, kept separate from
 * approval so an operator can approve now and publish later.
 */
export async function publishTableAction(formData: FormData) {
  const actor = await requireOperator()
  assertVerifiedEmail(actor)
  const tableId = String(formData.get('tableId'))
  const locale = localeOf(formData)

  if (!canPersistWrites()) {
    redirect(`/${locale}/admin/tables/${tableId}?notice=unavailable`)
  }

  try {
    const writes = await getSofraOperatorWriteRepository(actor)
    await writes.publishHostedTable(tableId)
  } catch (error) {
    redirect(`/${locale}/admin/tables/${tableId}?error=${outcomeOf(error)}`)
  }
  redirect(`/${locale}/admin/tables/${tableId}?notice=table_published`)
}

export async function decideHostApplicationAction(formData: FormData) {
  const actor = await requireOperator()
  assertVerifiedEmail(actor)
  const applicationId = String(formData.get('applicationId'))
  const locale = localeOf(formData)
  const rawDecision = String(formData.get('decision'))
  const decision =
    rawDecision === 'approve' ||
    rawDecision === 'changes_requested' ||
    rawDecision === 'decline'
      ? rawDecision
      : null
  if (!decision) throw new Error('Unknown decision')

  const rawCapacity = formData.get('certifiedCapacity')
  const certifiedCapacity = rawCapacity ? Number(rawCapacity) : null
  const reason = formData.get('reason') ? String(formData.get('reason')) : null

  if (!canPersistWrites()) {
    redirect(
      `/${locale}/admin/host-applications/${applicationId}?notice=unavailable`,
    )
  }

  try {
    const writes = await getSofraOperatorWriteRepository(actor)
    const application = await writes.decideHostApplication({
      applicationId,
      decision,
      reason,
      certifiedCapacity,
    })
    // A decision the applicant cannot see is a decision they never got. The
    // reason text is deliberately not included: it is written for operations,
    // and the portal is where it belongs.
    const [applicant] = await getProfileContacts([
      application.applicantProfileId,
    ])
    await notify(applicant ?? null, {
      kind: 'host_application_decided',
      decision,
    })
  } catch (error) {
    redirect(
      `/${locale}/admin/host-applications/${applicationId}?error=${outcomeOf(error)}`,
    )
  }
  redirect(
    `/${locale}/admin/host-applications/${applicationId}?decision=${decision}`,
  )
}

export async function triageIncidentAction(formData: FormData) {
  const actor = await requireOperator()
  assertVerifiedEmail(actor)
  const incidentId = String(formData.get('incidentId'))
  const locale = localeOf(formData)
  const status = String(formData.get('status')) as IncidentStatus
  const reason = formData.get('reason') ? String(formData.get('reason')) : null

  if (!canPersistWrites()) {
    redirect(`/${locale}/admin/incidents?notice=unavailable`)
  }

  try {
    const writes = await getSofraOperatorWriteRepository(actor)
    await writes.triageIncident(incidentId, status, reason)
  } catch (error) {
    redirect(`/${locale}/admin/incidents?error=${outcomeOf(error)}`)
  }
  redirect(`/${locale}/admin/incidents?notice=incident_triaged`)
}

export async function holdPayoutAction(formData: FormData) {
  const actor = await requireOperator()
  assertVerifiedEmail(actor)
  const payoutId = String(formData.get('payoutId'))
  const locale = localeOf(formData)
  const holdReason = String(formData.get('holdReason') ?? 'Operations review')

  if (!canPersistWrites()) {
    redirect(`/${locale}/admin/payouts?notice=unavailable`)
  }

  try {
    const writes = await getSofraOperatorWriteRepository(actor)
    await writes.holdPayout(payoutId, holdReason)
  } catch (error) {
    redirect(`/${locale}/admin/payouts?error=${outcomeOf(error)}`)
  }
  redirect(`/${locale}/admin/payouts?notice=payout_held`)
}

export async function confirmBookingManuallyAction(formData: FormData) {
  const actor = await requireOperator()
  assertVerifiedEmail(actor)
  const bookingId = String(formData.get('bookingId'))
  const locale = localeOf(formData)
  const rawBasis = String(formData.get('settlementBasis') ?? 'none')
  const settlementBasis: SettlementBasis =
    rawBasis === 'off_platform' ? 'off_platform' : 'none'
  const reference = formData.get('reference')
    ? String(formData.get('reference'))
    : null
  const reason = formData.get('reason') ? String(formData.get('reason')) : null

  if (!canPersistWrites()) {
    redirect(`/${locale}/admin/bookings?notice=unavailable`)
  }

  let confirmedStatus = 'confirmed'
  try {
    const writes = await getSofraOperatorWriteRepository(actor)
    const booking = await writes.confirmBookingManually({
      bookingId,
      settlementBasis,
      reference,
      reason,
    })
    // The seat is only really on when the status says so. Reporting
    // "confirmed" for a booking parked on a dietary review or an unmet
    // minimum would be false in two of the three outcomes -- and the host
    // roster, which shows confirmed bookings only, would not show it.
    confirmedStatus = booking.status
    if (booking.status === 'confirmed') {
      const context = await getBookingNotificationContext(bookingId)
      if (context.dinner) {
        await notify(context.traveller, {
          kind: 'booking_confirmed_traveller',
          dinner: context.dinner,
        })
        await notify(context.host, {
          kind: 'booking_confirmed_host',
          dinner: context.dinner,
          partySize: booking.partySize,
        })
      }
    }
  } catch (error) {
    redirect(`/${locale}/admin/bookings?error=${outcomeOf(error)}`)
  }
  redirect(
    `/${locale}/admin/bookings?notice=${confirmationNotice(confirmedStatus)}`,
  )
}

export async function liftPayoutHoldAction(formData: FormData) {
  const actor = await requireOperator()
  assertVerifiedEmail(actor)
  const payoutId = String(formData.get('payoutId'))
  const locale = localeOf(formData)
  const reason = String(formData.get('liftReason') ?? 'Hold reviewed')

  if (!canPersistWrites()) {
    redirect(`/${locale}/admin/payouts?notice=unavailable`)
  }

  try {
    const writes = await getSofraOperatorWriteRepository(actor)
    await writes.liftPayoutHold(payoutId, reason)
  } catch (error) {
    redirect(`/${locale}/admin/payouts?error=${outcomeOf(error)}`)
  }
  redirect(`/${locale}/admin/payouts?notice=payout_lifted`)
}

export async function releasePayoutAction(formData: FormData) {
  const actor = await requireOperator()
  assertVerifiedEmail(actor)
  const payoutId = String(formData.get('payoutId'))
  const locale = localeOf(formData)
  const reason = formData.get('reason') ? String(formData.get('reason')) : null

  if (!canPersistWrites()) {
    redirect(`/${locale}/admin/payouts?notice=unavailable`)
  }

  try {
    const writes = await getSofraOperatorWriteRepository(actor)
    await writes.releasePayout(payoutId, reason)
  } catch (error) {
    redirect(`/${locale}/admin/payouts?error=${outcomeOf(error)}`)
  }
  redirect(`/${locale}/admin/payouts?notice=payout_released`)
}

export async function decideCompatibilityAction(formData: FormData) {
  const actor = await requireOperator()
  assertVerifiedEmail(actor)
  const bookingId = String(formData.get('bookingId'))
  const locale = localeOf(formData)
  const rawDecision = String(formData.get('decision'))
  const decision =
    rawDecision === 'accepted' || rawDecision === 'declined'
      ? rawDecision
      : null
  if (!decision) throw new Error('Unknown compatibility decision')
  const privateReason = formData.get('privateReason')
    ? String(formData.get('privateReason'))
    : null

  if (!canPersistWrites()) {
    redirect(`/${locale}/admin/compatibility?notice=unavailable`)
  }

  try {
    const writes = await getSofraOperatorWriteRepository(actor)
    const decided = await writes.decideDietaryCompatibility(
      bookingId,
      decision,
      privateReason,
    )
    // Accepting now advances the booking (migration 0022), so this is a
    // confirmation like any other and must not happen silently. Declining is
    // deliberately not announced here: the traveller learns it with the
    // cancellation that follows, which carries what actually happens to them.
    if (decision === 'accepted' && decided.status === 'confirmed') {
      const context = await getBookingNotificationContext(bookingId)
      if (context.dinner) {
        await notify(context.traveller, {
          kind: 'booking_confirmed_traveller',
          dinner: context.dinner,
        })
        await notify(context.host, {
          kind: 'booking_confirmed_host',
          dinner: context.dinner,
          partySize: decided.partySize,
        })
      }
    }
  } catch (error) {
    redirect(`/${locale}/admin/compatibility?error=${outcomeOf(error)}`)
  }
  redirect(`/${locale}/admin/compatibility?notice=compatibility_decided`)
}

export async function moderateReviewAction(formData: FormData) {
  const actor = await requireOperator()
  assertVerifiedEmail(actor)
  const reviewId = String(formData.get('reviewId'))
  const locale = localeOf(formData)
  const rawDecision = String(formData.get('decision'))
  const decision =
    rawDecision === 'publish' || rawDecision === 'reject' ? rawDecision : null
  if (!decision) throw new Error('Unknown moderation decision')
  const reason = formData.get('reason') ? String(formData.get('reason')) : null

  if (!canPersistWrites()) {
    redirect(`/${locale}/admin/reviews?notice=unavailable`)
  }

  try {
    const writes = await getSofraOperatorWriteRepository(actor)
    await writes.moderatePublicReview(reviewId, decision, reason)
  } catch (error) {
    redirect(`/${locale}/admin/reviews?error=${outcomeOf(error)}`)
  }
  redirect(`/${locale}/admin/reviews?notice=review_moderated`)
}

/**
 * Platform cancellation of a scheduled dinner. Every open booking is refunded
 * 100% -- the decided rule -- and the outcome figures ride back in the redirect
 * so the operator sees exactly what their action did.
 */
export async function cancelPublishedTableAction(formData: FormData) {
  const actor = await requireOperator()
  assertVerifiedEmail(actor)
  const tableId = String(formData.get('tableId'))
  const locale = localeOf(formData)
  const reason = String(formData.get('reason') ?? '').trim()

  if (!canPersistWrites()) {
    redirect(`/${locale}/admin/tables/${tableId}?notice=unavailable`)
  }

  let outcome
  try {
    const writes = await getSofraOperatorWriteRepository(actor)
    outcome = await writes.cancelPublishedTable(tableId, reason)
    // The one thing this product must never leave someone to discover on
    // their own. Sent one at a time so a single bad address cannot stop the
    // rest of the table from being told.
    for (const recipient of await getCancelledTableRecipients(tableId)) {
      await notify(recipient.contact, {
        kind: 'dinner_cancelled_traveller',
        dinner: recipient.dinner,
      })
    }
  } catch (error) {
    redirect(`/${locale}/admin/tables/${tableId}?error=${outcomeOf(error)}`)
  }
  redirect(
    `/${locale}/admin/tables/${tableId}?notice=dinner_cancelled&bookings=${outcome.bookingsCancelled}&refund=${outcome.refundDueTotalKurus}&payoutsHeld=${outcome.payoutsHeld}`,
  )
}
