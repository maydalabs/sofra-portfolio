import 'server-only'

import { cookies } from 'next/headers'

import type { Actor, ApplicationRole } from '@/server/authorization/roles'

const demoPersonaCookie = 'sofra_demo_persona'
export type DemoPersona = 'traveler' | 'host' | 'partner' | 'operator'

const personaRoles: Record<DemoPersona, readonly ApplicationRole[]> = {
  traveler: ['traveler'],
  host: ['traveler', 'certified_host'],
  partner: ['traveler', 'partner_user'],
  operator: ['traveler', 'operator'],
}

/**
 * Demo personas grant a role without authenticating anyone, so this is
 * opt-in. It used to default on whenever NODE_ENV was not 'production',
 * which meant any reachable non-production deployment handed operator access
 * to whoever asked. Production is refused twice over: here, and by
 * assertProductionEnvironment(), which will not let the app boot with the
 * flag set.
 */
export function isDemoMode() {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.SOFRA_DEMO_MODE === 'true'
  )
}

export async function getDemoActor(): Promise<Actor> {
  const cookieStore = await cookies()
  const rawPersona = cookieStore.get(demoPersonaCookie)?.value
  const persona: DemoPersona =
    rawPersona === 'host' ||
    rawPersona === 'partner' ||
    rawPersona === 'operator'
      ? rawPersona
      : 'traveler'

  return {
    id: `demo-${persona}`,
    email: `${persona}@sofra.example`,
    emailVerified: true,
    roles: personaRoles[persona],
    source: 'demo',
  }
}

export async function setDemoPersona(persona: DemoPersona) {
  if (!isDemoMode()) {
    throw new Error(
      'Demo personas are disabled outside local development and tests',
    )
  }
  const cookieStore = await cookies()
  cookieStore.set(demoPersonaCookie, persona, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 60 * 60 * 8,
  })
}
