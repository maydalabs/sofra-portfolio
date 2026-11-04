import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

import englishMessages from '../../../messages/en.json'
import turkishMessages from '../../../messages/tr.json'
import type { ReviseHostedTableResult } from './revise-result'
import { ReviseTableForm } from './revise-table-form'

afterEach(cleanup)

const tableId = '50000000-0000-4000-8000-000000000001'
const initialValues = {
  menuTitle: 'Sunday dinner',
  menuDescription:
    'A complete household-selected dinner menu with tea to finish.',
  atmosphere: 'Warm and conversational',
  expectedHouseholdParticipants: 'Ayşe and Levent join dinner and tea',
  practicalInformation: 'One flight of stairs at the entrance',
  accessibilityInformation: 'No lift in the building',
}

function renderForm({
  locale = 'en',
  action,
  submitAction = vi.fn(async () => {}),
}: {
  locale?: 'en' | 'tr'
  action?: (input: unknown, locale?: string) => Promise<ReviseHostedTableResult>
  submitAction?: (formData: FormData) => Promise<void>
} = {}) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'tr' ? turkishMessages : englishMessages}
    >
      <ReviseTableForm
        tableId={tableId}
        initialValues={initialValues}
        action={action}
        submitAction={submitAction}
      />
    </NextIntlClientProvider>,
  )
  return { user: userEvent.setup(), submitAction }
}

describe('host table revision', () => {
  it('prefills experience text and saves before allowing submission', async () => {
    const action = vi
      .fn<
        (input: unknown, locale?: string) => Promise<ReviseHostedTableResult>
      >()
      .mockResolvedValue({ status: 'saved' })
    const submitAction = vi
      .fn<(formData: FormData) => Promise<void>>()
      .mockResolvedValue()
    const { user } = renderForm({ action, submitAction })
    const title = screen.getByLabelText('Menu title')
    const save = screen.getByRole('button', { name: 'Save changes' })
    const submit = screen.getByRole('button', {
      name: 'Submit for Sofra approval',
    })

    expect(title).toHaveValue(initialValues.menuTitle)
    expect(
      screen.getByLabelText('Accessibility information (optional)'),
    ).toHaveValue(initialValues.accessibilityInformation)
    expect(
      screen.queryByLabelText('Desired net payout per traveler (TRY)'),
    ).not.toBeInTheDocument()
    expect(save).toBeDisabled()
    expect(submit).toBeEnabled()
    await user.clear(title)
    await user.type(title, '  Revised Sunday dinner  ')
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(submitAction).not.toHaveBeenCalled()

    await user.click(save)
    expect(
      await screen.findByText(englishMessages.ReviseTable.outcomes.saved),
    ).toBeInTheDocument()
    expect(action).toHaveBeenCalledWith(
      { ...initialValues, menuTitle: 'Revised Sunday dinner' },
      'en',
    )
    expect(title).toHaveValue('Revised Sunday dinner')
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(submitAction).toHaveBeenCalledOnce())
    expect(submitAction.mock.calls[0][0].get('tableId')).toBe(tableId)
    expect(submitAction.mock.calls[0][0].get('locale')).toBe('en')
  })

  it('blocks concurrent saves and submission until the write finishes', async () => {
    let resolveSave: (result: ReviseHostedTableResult) => void = () => {}
    const action = vi.fn(
      () =>
        new Promise<ReviseHostedTableResult>((resolve) => {
          resolveSave = resolve
        }),
    )
    const { user } = renderForm({ action })
    await user.type(screen.getByLabelText('Menu title'), ' revised')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(
      await screen.findByRole('button', { name: 'Please wait…' }),
    ).toBeDisabled()
    expect(screen.getByLabelText('Menu title')).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Submit for Sofra approval' }),
    ).toBeDisabled()
    expect(action).toHaveBeenCalledOnce()
    await act(async () => resolveSave({ status: 'saved' }))
    expect(
      screen.getByRole('button', { name: 'Submit for Sofra approval' }),
    ).toBeEnabled()
  })

  it('retains edits after a failed save and lets the host retry', async () => {
    const action = vi
      .fn<
        (input: unknown, locale?: string) => Promise<ReviseHostedTableResult>
      >()
      .mockRejectedValueOnce(new Error('Private database error'))
      .mockResolvedValueOnce({ status: 'saved' })
    const { user } = renderForm({ action })
    await user.type(screen.getByLabelText('Menu title'), ' revised')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(
      await screen.findByText(
        englishMessages.ReviseTable.outcomes.unexpected_error,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Private database error')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Menu title')).toHaveValue(
      'Sunday dinner revised',
    )
    expect(
      screen.getByRole('button', { name: 'Submit for Sofra approval' }),
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(
      await screen.findByText(englishMessages.ReviseTable.outcomes.saved),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Submit for Sofra approval' }),
    ).toBeEnabled()
  })

  it('keeps a stale table closed after the server rejects its editable status', async () => {
    const action = vi.fn(async (): Promise<ReviseHostedTableResult> => ({
      status: 'not_editable',
    }))
    const { user } = renderForm({ action })
    await user.type(screen.getByLabelText('Menu title'), ' revised')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(
      await screen.findByText(
        englishMessages.ReviseTable.outcomes.not_editable,
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Menu title')).toHaveValue(
      'Sunday dinner revised',
    )
    expect(screen.getByLabelText('Menu title')).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Submit for Sofra approval' }),
    ).toBeDisabled()
  })

  it('validates demo edits without treating them as saved or submitting them', async () => {
    const { user, submitAction } = renderForm()
    await user.type(screen.getByLabelText('Menu title'), ' revised')
    await user.click(
      screen.getByRole('button', { name: 'Review changes locally' }),
    )
    expect(
      await screen.findByText(englishMessages.ReviseTable.outcomes.reviewed),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(englishMessages.ReviseTable.outcomes.saved),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Submit for Sofra approval' }),
    ).toBeDisabled()
    expect(submitAction).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByLabelText('Menu title')).toHaveValue(
      initialValues.menuTitle,
    )
    expect(
      screen.getByRole('button', { name: 'Submit for Sofra approval' }),
    ).toBeEnabled()
  })

  it('links Turkish validation messages to the field and saves in Turkish', async () => {
    const action = vi.fn(async (): Promise<ReviseHostedTableResult> => ({
      status: 'saved',
    }))
    const { user } = renderForm({ locale: 'tr', action })
    const title = screen.getByLabelText('Menü başlığı')
    await user.clear(title)
    await user.click(
      screen.getByRole('button', { name: 'Değişiklikleri kaydet' }),
    )
    expect(
      await screen.findByText(
        turkishMessages.ReviseTable.validation.menuTitleMin,
      ),
    ).toBeInTheDocument()
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(
      document.getElementById(title.getAttribute('aria-describedby') ?? ''),
    ).toHaveTextContent(turkishMessages.ReviseTable.validation.menuTitleMin)
    expect(action).not.toHaveBeenCalled()
    await user.type(title, 'Pazar akşamı sofrası')
    await user.click(
      screen.getByRole('button', { name: 'Değişiklikleri kaydet' }),
    )
    expect(
      await screen.findByText(turkishMessages.ReviseTable.outcomes.saved),
    ).toBeInTheDocument()
    expect(action).toHaveBeenCalledWith(
      { ...initialValues, menuTitle: 'Pazar akşamı sofrası' },
      'tr',
    )
    expect(
      screen.getByRole('button', { name: 'Sofra onayına gönder' }),
    ).toBeEnabled()
  })
})
