import { getTranslations } from 'next-intl/server'

import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * What just happened, said out loud on the page the operator lands on.
 *
 * Every operator action used to redirect with its own query parameter, and
 * several of those parameters were read by nobody: `?triage=unavailable`
 * against a page looking for `triaged`, `?hold=unavailable` against one
 * looking for `held`. Without a database -- which is the default deployment --
 * an operator pressed Confirm, Hold, Release, Triage or Publish, the page
 * reloaded, and absolutely nothing appeared. One channel and one component
 * means a new action cannot quietly land in that hole.
 *
 * Anything not in the map renders the generic failure rather than nothing,
 * because a silent no-op is the failure this exists to end.
 */
const TONES = {
  booking_confirmed: 'status',
  booking_awaiting_compatibility: 'status',
  booking_awaiting_minimum: 'status',
  payout_held: 'status',
  payout_lifted: 'status',
  payout_released: 'status',
  incident_triaged: 'status',
  compatibility_decided: 'status',
  review_moderated: 'status',
  table_approved: 'status',
  table_changes_requested: 'status',
  table_published: 'status',
  dinner_cancelled: 'status',
  unavailable: 'alert',
} as const

export type OperatorNoticeKey = keyof typeof TONES

/** Error codes worth explaining specifically; the rest fall back to generic. */
const ERRORS = new Set([
  'open_incident_blocks_payout',
  'payout_held',
  'payout_not_held',
  'invalid_settlement_basis',
  'booking_not_confirmable',
  'booking_not_cancellable',
  'table_not_cancellable',
])

export async function OperatorNotice({
  notice,
  error,
}: {
  notice?: string
  error?: string
}) {
  const t = await getTranslations('Admin')

  if (error) {
    const key = ERRORS.has(error) ? `errors.${error}` : 'errors.generic'
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{t(key)}</AlertDescription>
      </Alert>
    )
  }

  if (!notice) return null

  const tone = TONES[notice as OperatorNoticeKey]
  if (!tone) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{t('errors.generic')}</AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert
      variant={tone === 'alert' ? 'destructive' : 'default'}
      role={tone === 'alert' ? 'alert' : 'status'}
    >
      <AlertDescription>{t(`notices.${notice}`)}</AlertDescription>
    </Alert>
  )
}
