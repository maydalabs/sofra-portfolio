import { describe, expect, it } from 'vitest'

import { renderNotification, type NotificationEvent } from './events'

const dinner = {
  menuTitle: 'Karadeniz usulü hamsili pilav',
  startsAt: '2026-10-04T19:30:00.000Z',
  neighborhood: 'Kuzguncuk',
}

/**
 * Everything a notification must never carry. These are not fields on any
 * event type -- that is the primary defence -- so this asserts the rendered
 * text as well, which is what actually reaches an inbox.
 */
const mustNeverAppear = [
  'İcadiye Caddesi 42',
  'Yeşil kapı, ikinci zil',
  'shellfish allergy',
  'kabuklu deniz ürünleri',
  'Fatma Yılmaz',
  '1600.00',
  '160000',
]

const everyEvent: NotificationEvent[] = [
  { kind: 'booking_confirmed_traveller', dinner },
  { kind: 'booking_confirmed_host', dinner, partySize: 2 },
  { kind: 'booking_cancelled_host', dinner, partySize: 2 },
  { kind: 'dinner_cancelled_traveller', dinner },
  { kind: 'host_application_decided', decision: 'approve' },
  { kind: 'host_application_decided', decision: 'changes_requested' },
  { kind: 'host_application_decided', decision: 'decline' },
]

describe('notification templates', () => {
  it('renders every event in both languages with a subject and a body', () => {
    for (const event of everyEvent) {
      for (const locale of ['en', 'tr'] as const) {
        const rendered = renderNotification(event, locale, 'Alex')
        expect(rendered.subject.length).toBeGreaterThan(0)
        expect(rendered.text.length).toBeGreaterThan(0)
        expect(rendered.text).toContain('Alex')
        // No unresolved interpolation escaped into the text.
        expect(rendered.text).not.toMatch(/\{[a-zA-Z]/)
        expect(rendered.subject).not.toMatch(/\{[a-zA-Z]/)
      }
    }
  })

  it('never carries an address, another guest, dietary text, or money', () => {
    for (const event of everyEvent) {
      for (const locale of ['en', 'tr'] as const) {
        const rendered = renderNotification(event, locale, 'Alex')
        const whole = `${rendered.subject}\n${rendered.text}`
        for (const forbidden of mustNeverAppear) {
          expect(whole).not.toContain(forbidden)
        }
      }
    }
  })

  it('writes Turkish to a Turkish recipient and English to an English one', () => {
    const tr = renderNotification(
      { kind: 'booking_confirmed_traveller', dinner },
      'tr',
      'Ayşe',
    )
    const en = renderNotification(
      { kind: 'booking_confirmed_traveller', dinner },
      'en',
      'Alex',
    )
    expect(tr.subject).toContain('Yeriniz onaylandı')
    expect(en.subject).toContain('Your seat is confirmed')
    expect(tr.text).toContain('Merhaba Ayşe,')
    expect(en.text).toContain('Hello Alex,')
    // The time is rendered in the recipient's locale, in Istanbul time.
    expect(tr.text).toContain('22:30')
    expect(en.text).toContain('22:30')
  })

  it('tells a cancelled guest they are refunded without making them chase it', () => {
    for (const locale of ['en', 'tr'] as const) {
      const rendered = renderNotification(
        { kind: 'dinner_cancelled_traveller', dinner },
        locale,
        'Alex',
      )
      expect(rendered.text).toMatch(
        locale === 'tr' ? /iade edilecek/ : /refunded in full/,
      )
      expect(rendered.text).toMatch(
        locale === 'tr'
          ? /yapmanız gereken bir şey yok/
          : /nothing you need to do/,
      )
    }
  })

  it('does not repeat the operator-facing reason to the applicant', () => {
    for (const decision of [
      'approve',
      'changes_requested',
      'decline',
    ] as const) {
      for (const locale of ['en', 'tr'] as const) {
        const rendered = renderNotification(
          { kind: 'host_application_decided', decision },
          locale,
          'Alex',
        )
        expect(rendered.text).not.toContain('reason')
        expect(rendered.text).not.toContain('gerekçe')
      }
    }
  })
})
