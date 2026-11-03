import { getTranslations } from 'next-intl/server'

import { confirmBookingManuallyAction } from '@/app/[locale]/admin/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type {
  BookingStatus,
  PaymentStatus,
} from '@/server/database/database.types'

/**
 * Confirms a seat that no card payment will confirm.
 *
 * The settlement basis is a separate, recorded fact from the confirmation
 * itself, because they are separate facts: an operator can attest that a seat
 * is real without asserting that Sofra holds anyone's money. 'none' is the
 * default for exactly that reason -- claiming money was collected when it was
 * not would put a refund obligation on the platform that nothing funds.
 */
/**
 * Whether this seat is one an operator can still confirm by hand. Exported
 * because the list that hosts this form needs the same answer to decide
 * whether to render a row for it at all, and asking it twice in two places is
 * how the two drift apart.
 */
export function canConfirmManually(
  status: BookingStatus,
  paymentStatus: PaymentStatus,
) {
  return (
    (status === 'draft' || status === 'awaiting_payment') &&
    (paymentStatus === 'not_started' || paymentStatus === 'failed')
  )
}

export async function BookingConfirmationForm({
  locale,
  bookingId,
  status,
  paymentStatus,
}: {
  locale: string
  bookingId: string
  status: BookingStatus
  paymentStatus: PaymentStatus
}) {
  const t = await getTranslations('Admin')

  if (!canConfirmManually(status, paymentStatus)) return null

  const basisId = `settlement-${bookingId}`
  const referenceId = `reference-${bookingId}`

  return (
    <form
      action={confirmBookingManuallyAction}
      className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="bookingId" value={bookingId} />
      <div className="space-y-1">
        <Label htmlFor={basisId} className="text-xs">
          {t('settlementBasis')}
        </Label>
        <NativeSelect id={basisId} name="settlementBasis" defaultValue="none">
          <option value="none">{t('settlementNone')}</option>
          <option value="off_platform">{t('settlementOffPlatform')}</option>
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor={referenceId} className="text-xs">
          {t('settlementReference')}
        </Label>
        <Input
          id={referenceId}
          name="reference"
          placeholder={t('settlementReferencePlaceholder')}
        />
      </div>
      <Button type="submit" size="sm">
        {t('confirmBooking')}
      </Button>
    </form>
  )
}
