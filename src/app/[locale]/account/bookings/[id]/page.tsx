import {
  Calendar,
  CheckCircle2,
  Circle,
  Clock3,
  MapPin,
  ReceiptText,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'

import { reviewBookingCancellationAction } from './actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getTravelerBookingJourney,
  type BookingJourneyStepState,
} from '@/features/bookings/traveler-journey'
import { formatTry } from '@/features/pricing/pricing'
import { Link } from '@/i18n/navigation'
import { formatTableDate } from '@/lib/date'
import {
  findBookingArrivalDetails,
  findTravelerBookingById,
} from '@/server/repositories/queries'

import { requireTravelerPageActor } from '../../authorize'

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<{ cancellation?: string; refund?: string }>
}) {
  const { locale, id } = await params
  const query = await searchParams
  // The refund figure rides in the redirect; a tampered value renders as zero
  // rather than crashing the page.
  const refundKurus =
    Number.isSafeInteger(Number(query.refund)) && Number(query.refund) >= 0
      ? Number(query.refund)
      : 0
  setRequestLocale(locale)
  const t = await getTranslations('Account')
  const travelerT = await getTranslations('TravelerBooking')
  const bookingT = await getTranslations('Booking')
  const journeyT = await getTranslations('BookingJourney')
  const actor = await requireTravelerPageActor(locale)
  const booking = await findTravelerBookingById(actor.id, id)
  if (!booking) notFound()
  // A cancelled booking leads nowhere, and telling someone their address
  // "appears from <date>" for a dinner they are not attending is worse than
  // saying nothing.
  const bookingIsLive = !['cancelled', 'refunded'].includes(booking.status)
  const arrival = bookingIsLive
    ? await findBookingArrivalDetails(actor.id, id)
    : null
  const journey = getTravelerBookingJourney({
    bookingStatus: booking.status,
    compatibilityStatus: booking.compatibilityStatus,
    paymentStatus: booking.paymentStatus,
  })
  const canReviewCancellation = [
    'draft',
    'awaiting_payment',
    'payment_authorized',
    'pending_minimum',
    'confirmed',
  ].includes(booking.status)

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_19rem]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle as="h2" className="text-3xl">
              {booking.menuTitle}
            </CardTitle>
            <Badge>{travelerT(`statuses.${booking.status}`)}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {booking.householdName}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {query.cancellation === 'reviewed' ? (
            <Alert role="status">
              <CheckCircle2 className="size-4" />
              <AlertTitle>{travelerT('cancellationReviewedTitle')}</AlertTitle>
              <AlertDescription>
                {travelerT('cancellationReviewedBody')}
              </AlertDescription>
            </Alert>
          ) : null}
          {query.cancellation === 'cancelled_full' ||
          query.cancellation === 'cancelled_half' ||
          query.cancellation === 'cancelled_unpaid' ? (
            <Alert role="status">
              <CheckCircle2 className="size-4" />
              <AlertTitle>
                {query.cancellation === 'cancelled_full'
                  ? travelerT('cancelledFullTitle')
                  : query.cancellation === 'cancelled_half'
                    ? travelerT('cancelledHalfTitle')
                    : travelerT('cancelledUnpaidTitle')}
              </AlertTitle>
              <AlertDescription>
                {query.cancellation === 'cancelled_unpaid'
                  ? travelerT('cancelledUnpaidBody')
                  : travelerT(
                      query.cancellation === 'cancelled_full'
                        ? 'cancelledFullBody'
                        : 'cancelledHalfBody',
                      {
                        amount: formatTry(
                          refundKurus,
                          locale === 'tr' ? 'tr-TR' : 'en-US',
                        ),
                      },
                    )}
              </AlertDescription>
            </Alert>
          ) : null}
          {query.cancellation === 'failed' ? (
            <Alert variant="destructive" role="alert">
              <TriangleAlert className="size-4" />
              <AlertTitle>{travelerT('cancellationFailedTitle')}</AlertTitle>
              <AlertDescription>
                {travelerT('cancellationFailedBody')}
              </AlertDescription>
            </Alert>
          ) : null}
          {query.cancellation === 'unavailable' ? (
            <Alert role="status">
              <TriangleAlert className="size-4" />
              <AlertTitle>
                {travelerT('cancellationUnavailableTitle')}
              </AlertTitle>
              <AlertDescription>
                {travelerT('cancellationUnavailableBody')}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 rounded-2xl border p-5 text-sm sm:grid-cols-2">
            <p className="flex gap-3">
              <Calendar className="text-primary size-4" />
              {formatTableDate(booking.startsAt, locale)}
            </p>
            <p className="flex gap-3">
              <MapPin className="text-primary size-4" />
              {booking.neighborhood}
              {arrival?.disclosed
                ? null
                : ` · ${travelerT('exactAddressWithheld')}`}
            </p>
            <p className="flex gap-3">
              <Users className="text-primary size-4" />
              {travelerT('party', { count: booking.partySize })} ·{' '}
              {bookingT(`partyTypes.${booking.partyType}`)}
            </p>
            <p className="flex gap-3">
              <ReceiptText className="text-primary size-4" />
              {formatTry(
                booking.guestTotalKurus,
                locale === 'tr' ? 'tr-TR' : 'en-US',
              )}{' '}
              {travelerT('total')}
            </p>
          </div>
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertTitle>
              {travelerT('compatibility')}:{' '}
              {travelerT(
                `compatibilityStatuses.${booking.compatibilityStatus}`,
              )}
            </AlertTitle>
            <AlertDescription>
              {travelerT('disclosureSeparated')}
            </AlertDescription>
          </Alert>
          <section aria-labelledby="booking-journey-title">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">{journeyT('eyebrow')}</p>
                <h2 id="booking-journey-title" className="mt-2 text-3xl">
                  {journeyT('title')}
                </h2>
              </div>
              <p className="text-muted-foreground hidden max-w-sm text-right text-xs leading-5 sm:block">
                {journeyT('intro')}
              </p>
            </div>
            <ol className="mt-5 grid gap-3">
              {journey.map((step) => (
                <li
                  key={step.id}
                  className="grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-2xl border p-4"
                >
                  <JourneyIcon state={step.state} />
                  <div>
                    <p className="font-medium">
                      {journeyT(`steps.${step.id}`)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs leading-5">
                      {journeyT(`messages.${step.message}`)}
                    </p>
                  </div>
                  <Badge
                    variant={
                      step.state === 'attention' ? 'destructive' : 'outline'
                    }
                  >
                    {journeyT(`states.${step.state}`)}
                  </Badge>
                </li>
              ))}
            </ol>
          </section>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <Link href={`/tables/${booking.tableSlug}`}>
                {travelerT('viewPublicTable')}
              </Link>
            </Button>
            {canReviewCancellation ? (
              <form action={reviewBookingCancellationAction}>
                <input type="hidden" name="bookingId" value={booking.id} />
                <input type="hidden" name="locale" value={locale} />
                <Button type="submit" variant="outline">
                  {t('cancel')}
                </Button>
              </form>
            ) : booking.status === 'completed' ? (
              <>
                <Button asChild>
                  <Link href={`/account/bookings/${booking.id}/review`}>
                    {t('review')}
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/account/bookings/${booking.id}/review`}>
                    {t('privateFeedback')}
                  </Link>
                </Button>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <div className="space-y-6">
        {arrival ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle as="h2" className="text-2xl">
                {travelerT('arrivalTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6">
              {arrival.disclosed ? (
                <>
                  <address className="text-base not-italic">
                    {arrival.addressLine1}
                    {arrival.addressLine2 ? (
                      <>
                        <br />
                        {arrival.addressLine2}
                      </>
                    ) : null}
                    <br />
                    {[arrival.district, arrival.city, arrival.postalCode]
                      .filter(Boolean)
                      .join(', ')}
                  </address>
                  {arrival.arrivalInstructions ? (
                    <p className="text-muted-foreground">
                      {arrival.arrivalInstructions}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    {travelerT('arrivalKeepPrivate')}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {travelerT('arrivalPending', {
                    when: formatTableDate(arrival.discloseFrom, locale),
                  })}
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle as="h2" className="text-2xl">
              {travelerT('privacyBoundary')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-3 text-sm leading-6">
            {arrival?.disclosed ? null : (
              <>
                <p>{travelerT('approximateVisible')}</p>
                <p>{travelerT('arrivalSeparate')}</p>
              </>
            )}
            <p>{travelerT('otherTravelersPrivate')}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function JourneyIcon({ state }: { state: BookingJourneyStepState }) {
  const Icon =
    state === 'complete'
      ? CheckCircle2
      : state === 'current'
        ? Clock3
        : state === 'attention'
          ? TriangleAlert
          : Circle
  return (
    <Icon
      aria-hidden="true"
      className={
        state === 'attention'
          ? 'text-destructive mt-0.5 size-4'
          : 'text-primary mt-0.5 size-4'
      }
    />
  )
}
