import 'server-only'

import type { AppLocale } from '@/i18n/routing'
import { getDatabase } from '@/server/database/client'

import { getNotificationAdapter } from './notifications'
import { renderNotification, type NotificationEvent } from './events'

export interface NotificationContact {
  profileId: string
  displayName: string
  email: string
  locale: AppLocale
}

interface ContactRow {
  profile_id: string
  display_name: string
  email: string
  preferred_locale: string
}

interface BookingContactRow extends ContactRow {
  party?: string
  menu_title: string
  starts_at: string
  public_neighborhood: string
}

function toContact(row: ContactRow): NotificationContact {
  return {
    profileId: row.profile_id,
    displayName: row.display_name,
    email: row.email,
    locale: row.preferred_locale === 'tr' ? 'tr' : 'en',
  }
}

export interface BookingNotificationContext {
  traveller: NotificationContact | null
  host: NotificationContact | null
  dinner: { menuTitle: string; startsAt: string; neighborhood: string } | null
}

/** The traveller and host a booking concerns, plus the dinner's public face. */
export async function getBookingNotificationContext(
  bookingId: string,
): Promise<BookingNotificationContext> {
  const empty = { traveller: null, host: null, dinner: null }
  const sql = getDatabase()
  if (!sql) return empty

  const rows = await sql<BookingContactRow[]>`
    select * from public.get_booking_notification_contacts(${bookingId}::uuid)
  `
  const first = rows[0]
  if (!first) return empty

  return {
    traveller: rows.find((r) => r.party === 'traveller')
      ? toContact(rows.find((r) => r.party === 'traveller') as ContactRow)
      : null,
    host: rows.find((r) => r.party === 'host')
      ? toContact(rows.find((r) => r.party === 'host') as ContactRow)
      : null,
    dinner: {
      menuTitle: first.menu_title,
      startsAt: first.starts_at,
      neighborhood: first.public_neighborhood,
    },
  }
}

/** Name, address and language for a set of people, and nothing else. */
export async function getProfileContacts(
  profileIds: readonly string[],
): Promise<NotificationContact[]> {
  const sql = getDatabase()
  if (!sql || profileIds.length === 0) return []
  const rows = await sql<ContactRow[]>`
    select * from public.get_profile_contacts(
      ${sql.array([...profileIds])}::uuid[]
    )
  `
  return rows.map(toContact)
}

export interface CancelledTableRecipient {
  contact: NotificationContact
  dinner: { menuTitle: string; startsAt: string; neighborhood: string }
}

/** Everyone whose booking on this table is cancelled. */
export async function getCancelledTableRecipients(
  tableId: string,
): Promise<CancelledTableRecipient[]> {
  const sql = getDatabase()
  if (!sql) return []
  const rows = await sql<BookingContactRow[]>`
    select * from public.get_cancelled_table_traveller_contacts(
      ${tableId}::uuid
    )
  `
  return rows.map((row) => ({
    contact: toContact(row),
    dinner: {
      menuTitle: row.menu_title,
      startsAt: row.starts_at,
      neighborhood: row.public_neighborhood,
    },
  }))
}

/**
 * Sends one notification and never lets it break the thing that caused it.
 *
 * The write has already happened and been audited by the time we get here.
 * A refused mail server, an expired API key or a bounced address must not
 * turn a confirmed booking into an error page, so failures are logged and
 * swallowed. The tradeoff is deliberate: a silent send failure is recoverable
 * -- the state is still correct and visible in the app -- while a rolled-back
 * confirmation is not.
 */
export async function notify(
  recipient: NotificationContact | null,
  event: NotificationEvent,
): Promise<{ sent: boolean }> {
  if (!recipient) return { sent: false }
  try {
    const rendered = renderNotification(
      event,
      recipient.locale,
      recipient.displayName,
    )
    const adapter = await getNotificationAdapter()
    await adapter.send({
      to: recipient.email,
      subject: rendered.subject,
      text: rendered.text,
    })
    return { sent: true }
  } catch (error) {
    // The address itself is not logged: a bounced notification should not
    // put someone's email in the server log for whoever reads it later.
    console.error('[Sofra notification failed]', {
      kind: event.kind,
      profileId: recipient.profileId,
      reason: error instanceof Error ? error.message : String(error),
    })
    return { sent: false }
  }
}
