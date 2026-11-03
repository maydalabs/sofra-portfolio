import { getTranslations } from 'next-intl/server'

import {
  holdPayoutAction,
  liftPayoutHoldAction,
  releasePayoutAction,
} from '@/app/[locale]/admin/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PayoutStatus } from '@/server/database/database.types'

/**
 * Hold, lift, and release controls for one payout.
 *
 * A held payout offers only "lift the hold", because releasing straight
 * through a hold is how money leaves for a dinner that never happened. The
 * database refuses that release regardless (SF041); the control follows the
 * rule so the operator is never offered an action that cannot work.
 *
 * Release is still offered while an incident is open: the database refuses it
 * and the page reports why. Hiding that one would make the rule invisible, and
 * an operator who cannot see why money is stuck will go looking somewhere less
 * safe.
 */
export async function PayoutControls({
  locale,
  payoutId,
  status,
}: {
  locale: string
  payoutId: string
  status: PayoutStatus
}) {
  const t = await getTranslations('Admin')
  const holdReasonId = `hold-reason-${payoutId}`
  const liftReasonId = `lift-reason-${payoutId}`

  if (status === 'released') return null

  if (status === 'held') {
    return (
      <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
        <form action={liftPayoutHoldAction} className="flex items-end gap-2">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="payoutId" value={payoutId} />
          <div className="space-y-1">
            <Label htmlFor={liftReasonId} className="text-xs">
              {t('liftReason')}
            </Label>
            <Input
              id={liftReasonId}
              name="liftReason"
              placeholder={t('reasonPlaceholder')}
              required
            />
          </div>
          <Button type="submit" size="sm" variant="outline">
            {t('liftPayoutHold')}
          </Button>
        </form>
        <p className="text-muted-foreground max-w-xs text-xs">
          {t('payoutHeldExplanation')}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
      <form action={holdPayoutAction} className="flex items-end gap-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="payoutId" value={payoutId} />
        <div className="space-y-1">
          <Label htmlFor={holdReasonId} className="text-xs">
            {t('holdReason')}
          </Label>
          <Input
            id={holdReasonId}
            name="holdReason"
            placeholder={t('reasonPlaceholder')}
            required
          />
        </div>
        <Button type="submit" size="sm" variant="outline">
          {t('holdPayout')}
        </Button>
      </form>

      <form action={releasePayoutAction}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="payoutId" value={payoutId} />
        <Button type="submit" size="sm">
          {t('releasePayout')}
        </Button>
      </form>
    </div>
  )
}
