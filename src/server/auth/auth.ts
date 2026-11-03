import 'server-only'

import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { magicLink } from 'better-auth/plugins'
import { Pool } from 'pg'

import { getNotificationAdapter } from '@/server/notifications/notifications'

/**
 * The pool is constructed eagerly but connects lazily, so a missing
 * DATABASE_URL fails at first query with a clear database error rather than
 * at import time. That keeps schema generation and builds working without a
 * live database.
 */
const connectionString = process.env.DATABASE_URL ?? ''

// `pg` negotiates TLS only when the connection string asks for it, so a URL
// without sslmode would carry session tokens, magic-link values and the rate
// limit counters in cleartext -- while the app's own postgres.js client, which
// enforces this in code, stayed encrypted. Decided here rather than left to
// whoever pastes the URL into Vercel.
const isLocalDatabase = /@(localhost|127\.0\.0\.1)/.test(connectionString)

const pool = new Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? '10'),
  ssl: isLocalDatabase ? false : { rejectUnauthorized: true },
})

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',

  // Sofra authenticates with emailed links only. No passwords are stored.
  emailAndPassword: { enabled: false },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
  },

  /**
   * Without this, anyone can drive the magic-link endpoint in a loop and use
   * Sofra to send unlimited email to an address they do not control. Better
   * Auth stores counters in the database, so the limit holds across serverless
   * instances rather than resetting per process.
   */
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 30,
    customRules: {
      // Sending mail is the expensive, abusable action.
      '/sign-in/magic-link': { window: 300, max: 5 },
      '/magic-link/verify': { window: 300, max: 10 },
    },
  },

  plugins: [
    magicLink({
      expiresIn: 60 * 15,
      async sendMagicLink({ email, url }) {
        const notifications = await getNotificationAdapter()
        await notifications.send({
          to: email,
          subject: 'Your Sofra sign-in link',
          text: `Sign in to Sofra:\n\n${url}\n\nThis link expires in 15 minutes. If you did not request it, you can ignore this email.`,
        })
      },
    }),
    // Lets server actions set auth cookies. Must stay last in this array.
    nextCookies(),
  ],
})
