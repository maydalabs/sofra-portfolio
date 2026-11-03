import { NextIntlClientProvider } from 'next-intl'
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from 'next-intl/server'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isHostCertificationActive } from '@/features/hosts/certification'
import { CreateTableForm } from '@/features/hosted-tables/create-table-form'
import { developmentPolicy } from '@/features/policy/config'
import { findHostCertification } from '@/server/repositories/queries'
import {
  getMaximumLocalDateTime,
  getMinimumLocalDateTime,
  getServerTimeMilliseconds,
} from '@/server/time/clock'

import { canPersistWrites } from '@/server/repositories/write-factory'

import { requireHostPageActor } from '../../authorize'
import { createHostedTableAction } from '../actions'

export default async function NewHostedTablePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const [t, messages] = await Promise.all([
    getTranslations('HostPortal'),
    getMessages(),
  ])
  const actor = await requireHostPageActor(locale)
  const certification = await findHostCertification(actor.id)
  const certificationIsActive = isHostCertificationActive(
    certification,
    new Date(getServerTimeMilliseconds()),
  )
  const minimumStartsAt = getMinimumLocalDateTime(
    developmentPolicy.minimumLeadDays,
  )
  const maximumStartsAt = getMaximumLocalDateTime(
    developmentPolicy.maximumPublishingHorizonDays,
  )
  const durableWrites = canPersistWrites()
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-3xl">
          {t('newTable')}
        </CardTitle>
        <p className="text-muted-foreground text-sm">{t('newTableIntro')}</p>
      </CardHeader>
      <CardContent>
        {certification && certificationIsActive ? (
          <NextIntlClientProvider
            messages={{ CreateTable: messages.CreateTable }}
          >
            <CreateTableForm
              certifiedCapacity={certification.certifiedTravelerCapacity}
              minimumStartsAt={minimumStartsAt}
              maximumStartsAt={maximumStartsAt}
              action={durableWrites ? createHostedTableAction : undefined}
            />
          </NextIntlClientProvider>
        ) : (
          <Alert>
            <AlertTitle>{t('certificationUnavailableTitle')}</AlertTitle>
            <AlertDescription>
              {t('certificationUnavailableBody')}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
