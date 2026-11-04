'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useLocale, useTranslations } from 'next-intl'
import { useMemo, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import type { ReviseHostedTableResult } from './revise-result'
import {
  createReviseHostedTableValidationSchema,
  type ReviseHostedTableInput,
} from './schemas'

const textFields = [
  { name: 'menuTitle', maximum: 100, rows: 1 },
  { name: 'menuDescription', maximum: 1_200, rows: 5 },
  { name: 'atmosphere', maximum: 240, rows: 3 },
  { name: 'expectedHouseholdParticipants', maximum: 240, rows: 3 },
  { name: 'practicalInformation', maximum: 500, rows: 3 },
  { name: 'accessibilityInformation', maximum: 500, rows: 3 },
] as const

export function ReviseTableForm({
  tableId,
  initialValues,
  action,
  submitAction,
}: {
  tableId: string
  initialValues: ReviseHostedTableInput
  /** Omitted in the walkthrough: validation is a preview, never a save. */
  action?: (input: unknown, locale?: string) => Promise<ReviseHostedTableResult>
  submitAction: (formData: FormData) => Promise<void>
}) {
  const t = useTranslations('ReviseTable')
  const hostT = useTranslations('HostPortal')
  const locale = useLocale()
  const [result, setResult] = useState<
    ReviseHostedTableResult['status'] | 'reviewed' | null
  >(null)
  const [pending, startTransition] = useTransition()
  const schema = useMemo(
    () =>
      createReviseHostedTableValidationSchema({
        menuTitleMin: t('validation.menuTitleMin'),
        menuTitleMax: t('validation.menuTitleMax'),
        menuDescriptionMin: t('validation.menuDescriptionMin'),
        menuDescriptionMax: t('validation.menuDescriptionMax'),
        atmosphereMin: t('validation.atmosphereMin'),
        atmosphereMax: t('validation.atmosphereMax'),
        participantsMin: t('validation.participantsMin'),
        participantsMax: t('validation.participantsMax'),
        practicalMin: t('validation.practicalMin'),
        practicalMax: t('validation.practicalMax'),
        accessibilityMax: t('validation.accessibilityMax'),
      }),
    [t],
  )
  const form = useForm<ReviseHostedTableInput>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  })
  const { isDirty, errors, isSubmitting } = form.formState
  const unavailable =
    result === 'not_editable' ||
    result === 'not_found' ||
    result === 'not_certified'
  const busy = pending || isSubmitting
  const canSubmit = !isDirty && !busy && !unavailable
  const save = form.handleSubmit((values) => {
    setResult(null)
    if (!action) {
      setResult('reviewed')
      return
    }
    startTransition(async () => {
      try {
        const outcome = await action(values, locale)
        if (outcome.status === 'saved') {
          // Only a successful durable write establishes a new saved baseline.
          // Errors and demo validation retain the entered, unsaved values.
          form.reset(values)
        }
        setResult(outcome.status)
      } catch {
        setResult('unexpected_error')
      }
    })
  })

  return (
    <section aria-labelledby="revise-table-title" className="space-y-5">
      <div>
        <h2 id="revise-table-title" className="text-2xl">
          {t('title')}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">{t('intro')}</p>
      </div>
      {!action ? (
        <Alert>
          <AlertDescription>{t('demoNote')}</AlertDescription>
        </Alert>
      ) : null}
      <form
        aria-label={t('formLabel')}
        aria-busy={busy}
        noValidate
        onSubmit={save}
        onChange={() => {
          if (result === 'saved' || result === 'reviewed') setResult(null)
        }}
        className="space-y-5"
      >
        <fieldset
          disabled={busy || unavailable}
          className="grid gap-5 sm:grid-cols-2"
        >
          {textFields.map(({ name, maximum, rows }) => {
            const id = `revise-${name}`
            const errorId = `${id}-error`
            const error = errors[name]?.message
            const attributes = {
              id,
              maxLength: maximum,
              'aria-invalid': error ? (true as const) : undefined,
              'aria-describedby': error ? errorId : undefined,
              ...form.register(name),
            }
            return (
              <div
                key={name}
                className={
                  name === 'menuDescription'
                    ? 'space-y-2 sm:col-span-2'
                    : 'space-y-2'
                }
              >
                <Label htmlFor={id}>{t(`fields.${name}`)}</Label>
                {rows === 1 ? (
                  <Input {...attributes} />
                ) : (
                  <Textarea {...attributes} rows={rows} />
                )}
                {error ? (
                  <p
                    id={errorId}
                    role="alert"
                    className="text-destructive text-sm"
                  >
                    {error}
                  </p>
                ) : null}
              </div>
            )
          })}
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!isDirty || busy || unavailable}>
            {busy ? t('pending') : action ? t('save') : t('review')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!isDirty || busy || unavailable}
            onClick={() => {
              form.reset()
              setResult(null)
            }}
          >
            {t('discard')}
          </Button>
        </div>
        {result ? (
          <Alert
            role={
              result === 'saved' || result === 'reviewed' ? 'status' : 'alert'
            }
            variant={
              result === 'saved' || result === 'reviewed'
                ? 'default'
                : 'destructive'
            }
          >
            <AlertDescription>{t(`outcomes.${result}`)}</AlertDescription>
          </Alert>
        ) : null}
      </form>
      <form
        action={(formData) => {
          if (!canSubmit) return
          startTransition(async () => {
            await submitAction(formData)
          })
        }}
        onSubmit={(event) => {
          if (!canSubmit) event.preventDefault()
        }}
        className="space-y-3 border-t pt-5"
      >
        <input type="hidden" name="tableId" value={tableId} />
        <input type="hidden" name="locale" value={locale} />
        {isDirty ? (
          <p
            id="unsaved-revision-note"
            role="status"
            className="text-muted-foreground text-sm"
          >
            {t('unsaved')}
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={!canSubmit}
          aria-describedby={isDirty ? 'unsaved-revision-note' : undefined}
        >
          {hostT('submit')}
        </Button>
      </form>
    </section>
  )
}
