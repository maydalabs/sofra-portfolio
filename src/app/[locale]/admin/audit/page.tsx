import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RecordList } from '@/components/ui/record-list'
import { listOperatorAuditEvents } from '@/server/repositories/operator/queries'

import { requireOperatorPageActor } from '../authorize'

export default async function AuditLogPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  await requireOperatorPageActor(locale)
  const t = await getTranslations('Admin')
  const rows = await listOperatorAuditEvents()
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-3xl">
          {t('audit')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <RecordList
          caption={t('audit')}
          rows={rows}
          getKey={(row) => row.id}
          empty={t('auditEmpty')}
          columns={[
            {
              key: 'action',
              header: t('actionColumnLabel'),
              primary: true,
              cell: (row) => (
                <span className="font-mono text-xs break-all">
                  {row.action}
                </span>
              ),
            },
            {
              key: 'entity',
              header: t('entityColumn'),
              cell: (row) => (
                <span className="font-mono text-xs break-all">
                  {row.entityId}
                </span>
              ),
            },
            {
              key: 'actor',
              header: t('actorColumn'),
              cell: (row) => row.actorId ?? t('systemActor'),
            },
            {
              key: 'reason',
              header: t('reasonColumn'),
              wide: true,
              cell: (row) => row.reason ?? '—',
            },
          ]}
        />
      </CardContent>
    </Card>
  )
}
