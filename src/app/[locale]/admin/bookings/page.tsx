import { getTranslations, setRequestLocale } from 'next-intl/server'

import {
  BookingConfirmationForm,
  canConfirmManually,
} from '@/components/admin/booking-confirmation-form'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OperatorNotice } from '@/components/admin/operator-notice'
import { RecordList } from '@/components/ui/record-list'
import { formatTry } from '@/features/pricing/pricing'
import { listOperatorBookings } from '@/server/repositories/operator/queries'

import { requireOperatorPageActor } from '../authorize'

export default async function AdminBookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ notice?: string; error?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  await requireOperatorPageActor(locale)
  const t = await getTranslations('Admin')
  const { notice, error } = await searchParams
  const bookings = await listOperatorBookings()
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-3xl">
          {t('bookings')}
        </CardTitle>
        <p className="text-muted-foreground text-sm">{t('bookingsIntro')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <OperatorNotice notice={notice} error={error} />
        <RecordList
          caption={t('bookings')}
          rows={bookings}
          getKey={(booking) => booking.id}
          empty={t('bookingsEmpty')}
          columns={[
            {
              key: 'table',
              header: t('tableColumn'),
              primary: true,
              cell: (booking) => booking.menuTitle,
            },
            {
              key: 'booking',
              header: t('bookingColumn'),
              cell: (booking) => (
                <span className="font-mono text-xs break-all">
                  {booking.id}
                </span>
              ),
            },
            {
              key: 'party',
              header: t('partyColumn'),
              cell: (booking) => booking.partySize,
            },
            {
              key: 'total',
              header: t('totalColumn'),
              cell: (booking) =>
                formatTry(
                  booking.guestTotalKurus,
                  locale === 'tr' ? 'tr-TR' : 'en-US',
                ),
            },
            {
              key: 'status',
              header: t('statusColumn'),
              cell: (booking) => (
                <Badge variant="outline">
                  {t(`bookingStatuses.${booking.status}`)}
                </Badge>
              ),
            },
            {
              key: 'payment',
              header: t('paymentColumn'),
              cell: (booking) => (
                <Badge
                  variant={
                    booking.paymentStatus === 'not_started'
                      ? 'secondary'
                      : 'outline'
                  }
                >
                  {t(`paymentStatuses.${booking.paymentStatus}`)}
                </Badge>
              ),
            },
            {
              key: 'action',
              header: t('actionColumn'),
              wide: true,
              visible: (booking) =>
                canConfirmManually(booking.status, booking.paymentStatus),
              cell: (booking) => (
                <BookingConfirmationForm
                  locale={locale}
                  bookingId={booking.id}
                  status={booking.status}
                  paymentStatus={booking.paymentStatus}
                />
              ),
            },
          ]}
        />
      </CardContent>
    </Card>
  )
}
