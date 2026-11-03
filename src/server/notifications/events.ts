import 'server-only'

import type { AppLocale } from '@/i18n/routing'

/**
 * The things that happen to a person which they should not have to discover
 * by logging in and looking.
 *
 * Every payload here is deliberately thin. A notification is one of the
 * easiest ways to put something sensitive in the wrong inbox, so these carry
 * the dinner's public face -- its menu title, when it is, which neighbourhood
 * -- and never an address, another guest, a dietary disclosure, or a sum of
 * money. If a template ever needs one of those, that is a decision to take
 * deliberately, not a field to widen quietly.
 */
export interface DinnerContext {
  menuTitle: string
  startsAt: string
  neighborhood: string
}

export type NotificationEvent =
  | { kind: 'booking_confirmed_traveller'; dinner: DinnerContext }
  | { kind: 'booking_confirmed_host'; dinner: DinnerContext; partySize: number }
  | { kind: 'booking_cancelled_host'; dinner: DinnerContext; partySize: number }
  | { kind: 'dinner_cancelled_traveller'; dinner: DinnerContext }
  | {
      kind: 'host_application_decided'
      decision: 'approve' | 'changes_requested' | 'decline'
    }

export interface RenderedNotification {
  subject: string
  text: string
}

function formatWhen(startsAt: string, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(startsAt))
}

const signOff = {
  en: 'Sofra',
  tr: 'Sofra',
} as const

/**
 * Templates live here rather than in the message catalogues because these
 * strings are not part of any rendered page: they are sent to a person who is
 * not looking at the site, in whichever language they chose, and they need to
 * read as a letter rather than as UI copy.
 */
export function renderNotification(
  event: NotificationEvent,
  locale: AppLocale,
  recipientName: string,
): RenderedNotification {
  const tr = locale === 'tr'
  const hello = tr ? `Merhaba ${recipientName},` : `Hello ${recipientName},`
  const end = `\n\n— ${signOff[locale]}`

  switch (event.kind) {
    case 'booking_confirmed_traveller': {
      const when = formatWhen(event.dinner.startsAt, locale)
      return {
        subject: tr
          ? `Yeriniz onaylandı: ${event.dinner.menuTitle}`
          : `Your seat is confirmed: ${event.dinner.menuTitle}`,
        text: tr
          ? `${hello}\n\nYeriniz onaylandı.\n\n${event.dinner.menuTitle}\n${when}\n${event.dinner.neighborhood}\n\nTam adres ve varış notları, yemekten kısa süre önce hesabınızdaki rezervasyon sayfasında görünecek.${end}`
          : `${hello}\n\nYour seat is confirmed.\n\n${event.dinner.menuTitle}\n${when}\n${event.dinner.neighborhood}\n\nThe exact address and arrival notes appear on your booking page shortly before the dinner.${end}`,
      }
    }
    case 'booking_confirmed_host': {
      const when = formatWhen(event.dinner.startsAt, locale)
      return {
        subject: tr
          ? `Sofranıza yeni bir katılım: ${event.dinner.menuTitle}`
          : `Someone is joining your table: ${event.dinner.menuTitle}`,
        text: tr
          ? `${hello}\n\n${event.dinner.menuTitle} sofranıza ${event.partySize} kişilik bir katılım onaylandı.\n${when}\n\nGüncel listeyi ev sahibi panelinizden görebilirsiniz.${end}`
          : `${hello}\n\nA party of ${event.partySize} is confirmed for your table, ${event.dinner.menuTitle}.\n${when}\n\nYour host portal has the current roster.${end}`,
      }
    }
    case 'booking_cancelled_host': {
      const when = formatWhen(event.dinner.startsAt, locale)
      return {
        subject: tr
          ? `Bir katılım iptal edildi: ${event.dinner.menuTitle}`
          : `A party cancelled: ${event.dinner.menuTitle}`,
        text: tr
          ? `${hello}\n\n${event.dinner.menuTitle} sofranızdan ${event.partySize} kişilik bir katılım iptal edildi ve yerler yeniden açıldı.\n${when}\n\nBaşka bir işlem yapmanız gerekmiyor.${end}`
          : `${hello}\n\nA party of ${event.partySize} cancelled for your table, ${event.dinner.menuTitle}, and their seats are open again.\n${when}\n\nThere is nothing you need to do.${end}`,
      }
    }
    case 'dinner_cancelled_traveller': {
      const when = formatWhen(event.dinner.startsAt, locale)
      return {
        subject: tr
          ? `Yemek iptal edildi: ${event.dinner.menuTitle}`
          : `Your dinner was cancelled: ${event.dinner.menuTitle}`,
        text: tr
          ? `${hello}\n\nÜzgünüz — ${when} tarihli ${event.dinner.menuTitle} yemeği gerçekleşmeyecek.\n\nÖdediğiniz tutarın tamamı iade edilecek. Bunun için yapmanız gereken bir şey yok.${end}`
          : `${hello}\n\nWe are sorry — ${event.dinner.menuTitle} on ${when} will not go ahead.\n\nYou will be refunded in full. There is nothing you need to do.${end}`,
      }
    }
    case 'host_application_decided': {
      if (event.decision === 'approve') {
        return {
          subject: tr
            ? 'Başvurunuz onaylandı'
            : 'Your host application is approved',
          text: tr
            ? `${hello}\n\nEv sahibi başvurunuz onaylandı. Artık ev sahibi panelinizden sofra oluşturabilirsiniz.${end}`
            : `${hello}\n\nYour host application is approved. You can now create tables from your host portal.${end}`,
        }
      }
      if (event.decision === 'changes_requested') {
        return {
          subject: tr
            ? 'Başvurunuz için birkaç düzeltme gerekiyor'
            : 'Your host application needs a few changes',
          text: tr
            ? `${hello}\n\nBaşvurunuzu inceledik ve devam etmeden önce birkaç noktanın netleşmesi gerekiyor. Ayrıntılar için ev sahibi panelinize bakabilirsiniz.${end}`
            : `${hello}\n\nWe reviewed your application and a few things need to be clearer before we can continue. Your host portal has the details.${end}`,
        }
      }
      return {
        subject: tr ? 'Başvurunuz hakkında' : 'About your host application',
        text: tr
          ? `${hello}\n\nBaşvurunuzu dikkatle değerlendirdik ve şu aşamada devam etmeyeceğiz. Zaman ayırdığınız için teşekkür ederiz.${end}`
          : `${hello}\n\nWe considered your application carefully and will not be taking it further at this stage. Thank you for the time you gave it.${end}`,
      }
    }
  }
}
