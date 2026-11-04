'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { auth } from '@/server/auth/auth'

const emailSchema = z.string().trim().email()

/** Preserve client identity for rate limiting and request context for CSRF checks. */
const forwardedHeaders = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'user-agent',
  'cookie',
  'origin',
  'referer',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
]

export async function requestMagicLinkAction(formData: FormData) {
  const locale = formData.get('locale') === 'tr' ? 'tr' : 'en'

  // A malformed address is a form error, not a crash. Previously this threw and
  // the person landed on the error boundary.
  const parsed = emailSchema.safeParse(formData.get('email'))
  if (!parsed.success) {
    redirect(`/${locale}/sign-in?error=invalid_email`)
  }

  // Sent through the HTTP handler rather than auth.api, because Better Auth
  // applies rate limiting in the router's onRequest hook only. Calling
  // auth.api.signInMagicLink() directly skips that hook entirely, which left
  // this form -- the one path that actually sends mail -- unlimited, while the
  // configured 5-per-5-minutes protected an endpoint the app never used.
  const incoming = await headers()
  const outgoing = new Headers({ 'content-type': 'application/json' })
  for (const name of forwardedHeaders) {
    const value = incoming.get(name)
    if (value !== null) outgoing.set(name, value)
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const response = await auth.handler(
    new Request(`${baseUrl}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: outgoing,
      body: JSON.stringify({
        email: parsed.data,
        callbackURL: `/${locale}/account`,
      }),
    }),
  )

  if (response.status === 429) {
    redirect(`/${locale}/sign-in?error=too_many_requests`)
  }

  if (!response.ok) {
    throw new Error(`Magic link request failed with ${response.status}`)
  }

  // The same destination regardless of whether the address is registered, so
  // this form cannot be used to enumerate accounts.
  redirect(`/${locale}/verify-email`)
}
