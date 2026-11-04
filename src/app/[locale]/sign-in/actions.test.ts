import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requestMagicLinkAction } from './actions'

const mocks = vi.hoisted(() => ({
  headers: vi.fn<() => Promise<Headers>>(),
  handler: vi.fn<(request: Request) => Promise<Response>>(),
  redirect: vi.fn<(url: string) => never>(),
}))

vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/server/auth/auth', () => ({
  auth: { handler: mocks.handler },
}))

function signInForm(email = 'host@sofra.invalid', locale = 'en') {
  const form = new FormData()
  form.set('email', email)
  form.set('locale', locale)
  return form
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://sofra.example')
  mocks.headers.mockResolvedValue(new Headers())
  mocks.handler.mockResolvedValue(new Response('{}', { status: 200 }))
  mocks.redirect.mockImplementation((url) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  })
})

afterEach(() => vi.unstubAllEnvs())

describe('requestMagicLinkAction', () => {
  it('forwards cookie, origin and fetch context to the rate-limited HTTP handler', async () => {
    const incoming = new Headers({
      cookie: 'better-auth.session_token=existing-browser-cookie',
      origin: 'https://sofra.example',
      referer: 'https://sofra.example/tr/sign-in',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'x-forwarded-for': '192.0.2.10',
      'x-real-ip': '192.0.2.10',
      'cf-connecting-ip': '192.0.2.10',
      'user-agent': 'Existing browser',
      'x-unrelated-header': 'Do not forward',
    })
    mocks.headers.mockResolvedValue(incoming)

    await expect(
      requestMagicLinkAction(signInForm('  host@sofra.invalid  ', 'tr')),
    ).rejects.toThrow('NEXT_REDIRECT:/tr/verify-email')

    expect(mocks.handler).toHaveBeenCalledOnce()
    const [request] = mocks.handler.mock.calls[0]
    expect(request.url).toBe(
      'https://sofra.example/api/auth/sign-in/magic-link',
    )
    expect(request.method).toBe('POST')
    expect(Object.fromEntries(request.headers)).toEqual({
      'content-type': 'application/json',
      cookie: incoming.get('cookie'),
      origin: incoming.get('origin'),
      referer: incoming.get('referer'),
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'x-forwarded-for': '192.0.2.10',
      'x-real-ip': '192.0.2.10',
      'cf-connecting-ip': '192.0.2.10',
      'user-agent': 'Existing browser',
    })
    expect(await request.json()).toEqual({
      email: 'host@sofra.invalid',
      callbackURL: '/tr/account',
    })
  })

  it.each([undefined, 'null', 'https://untrusted.example'])(
    'does not replace a missing or untrusted origin with the application origin: %s',
    async (origin) => {
      const incoming = new Headers({ cookie: 'existing-cookie=value' })
      if (origin !== undefined) incoming.set('origin', origin)
      mocks.headers.mockResolvedValue(incoming)
      // The action must leave rejection to Better Auth and must not turn a
      // rejected request into the normal successful email-check destination.
      mocks.handler.mockResolvedValue(new Response(null, { status: 403 }))

      await expect(requestMagicLinkAction(signInForm())).rejects.toThrow(
        'Magic link request failed with 403',
      )
      const [request] = mocks.handler.mock.calls[0]
      expect(request.headers.get('origin')).toBe(origin ?? null)
      expect(request.headers.has('referer')).toBe(false)
      expect(request.headers.get('cookie')).toBe('existing-cookie=value')
      expect(mocks.redirect).not.toHaveBeenCalled()
    },
  )

  it('preserves a referer without fabricating an origin', async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        cookie: 'existing-cookie=value',
        referer: 'https://sofra.example/en/sign-in',
      }),
    )

    await expect(requestMagicLinkAction(signInForm())).rejects.toThrow(
      'NEXT_REDIRECT:/en/verify-email',
    )
    const [request] = mocks.handler.mock.calls[0]
    expect(request.headers.has('origin')).toBe(false)
    expect(request.headers.get('referer')).toBe(
      'https://sofra.example/en/sign-in',
    )
  })

  it('preserves cross-site fetch metadata even without cookies', async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        origin: 'https://untrusted.example',
        referer: 'https://untrusted.example/form',
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
      }),
    )
    mocks.handler.mockResolvedValue(new Response(null, { status: 403 }))

    await expect(requestMagicLinkAction(signInForm())).rejects.toThrow(
      'Magic link request failed with 403',
    )
    const [request] = mocks.handler.mock.calls[0]
    expect(request.headers.get('origin')).toBe('https://untrusted.example')
    expect(request.headers.get('referer')).toBe(
      'https://untrusted.example/form',
    )
    expect(request.headers.get('sec-fetch-site')).toBe('cross-site')
    expect(request.headers.get('sec-fetch-mode')).toBe('navigate')
    expect(request.headers.get('sec-fetch-dest')).toBe('document')
    expect(request.headers.has('cookie')).toBe(false)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('preserves an empty cookie header because Better Auth checks its presence', async () => {
    mocks.headers.mockResolvedValue(new Headers({ cookie: '' }))
    mocks.handler.mockResolvedValue(new Response(null, { status: 403 }))

    await expect(requestMagicLinkAction(signInForm())).rejects.toThrow(
      'Magic link request failed with 403',
    )
    const [request] = mocks.handler.mock.calls[0]
    expect(request.headers.has('cookie')).toBe(true)
    expect(request.headers.get('cookie')).toBe('')
    expect(request.headers.has('origin')).toBe(false)
  })

  it('rejects invalid email before reading headers or invoking auth', async () => {
    await expect(
      requestMagicLinkAction(signInForm('not-an-email', 'tr')),
    ).rejects.toThrow('NEXT_REDIRECT:/tr/sign-in?error=invalid_email')
    expect(mocks.headers).not.toHaveBeenCalled()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('retains the localized rate-limit outcome', async () => {
    mocks.handler.mockResolvedValue(new Response(null, { status: 429 }))

    await expect(
      requestMagicLinkAction(signInForm('host@sofra.invalid', 'tr')),
    ).rejects.toThrow('NEXT_REDIRECT:/tr/sign-in?error=too_many_requests')
    expect(mocks.handler).toHaveBeenCalledOnce()
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      '/tr/sign-in?error=too_many_requests',
    )
  })
})
