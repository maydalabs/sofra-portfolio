import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthorizationError, type Actor } from '@/server/authorization/roles'
import {
  HostWriteError,
  type HostWriteErrorCode,
} from '@/server/repositories/write-contracts'

import { reviseHostedTableAction } from './actions'

const mocks = vi.hoisted(() => ({
  currentActor: vi.fn<() => Promise<Actor | null>>(),
  canPersist: vi.fn<() => boolean>(),
  hostRepository: vi.fn(),
  reviseDraft: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/server/auth/current-actor', () => ({
  getCurrentActor: mocks.currentActor,
}))
vi.mock('@/server/auth/demo-session', () => ({ isDemoMode: vi.fn() }))
vi.mock('@/server/repositories/queries', () => ({
  findHostCertification: vi.fn(),
  findHostTableById: vi.fn(),
}))
vi.mock('@/server/repositories/write-factory', () => ({
  canPersistWrites: mocks.canPersist,
  getSofraHostWriteRepository: mocks.hostRepository,
}))

const tableId = 'b3200000-0000-4000-8000-000000000001'
const host: Actor = {
  id: 'a3200000-0000-4000-8000-000000000001',
  email: 'revision-host@sofra.invalid',
  emailVerified: true,
  roles: ['certified_host'],
  source: 'database',
}
const revision = {
  menuTitle: 'Sunday household dinner',
  menuDescription:
    'Lentil soup, seasonal vegetables, rice, fruit and Turkish tea.',
  atmosphere: 'A quiet evening with conversation over tea.',
  expectedHouseholdParticipants: 'The verified host joins dinner and tea.',
  practicalInformation: 'One flight of stairs; shoes are left at the door.',
  accessibilityInformation: 'No lift is available.',
}

function expectNoWrite() {
  expect(mocks.hostRepository).not.toHaveBeenCalled()
  expect(mocks.reviseDraft).not.toHaveBeenCalled()
  expect(mocks.revalidatePath).not.toHaveBeenCalled()
}

describe('reviseHostedTableAction', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.currentActor.mockResolvedValue(host)
    mocks.canPersist.mockReturnValue(true)
    mocks.hostRepository.mockResolvedValue({
      reviseHostedTableDraft: mocks.reviseDraft,
    })
    mocks.reviseDraft.mockResolvedValue({
      id: tableId,
      slug: 'original-household-dinner',
      status: 'draft',
      startsAt: '2026-11-20T16:00:00.000Z',
      proposedCapacity: 4,
      hostNetPayoutKurus: 120_000,
      guestPriceKurus: 160_000,
    })
  })

  it('requires a signed-in actor before constructing a write repository', async () => {
    mocks.currentActor.mockResolvedValue(null)

    await expect(reviseHostedTableAction(tableId, revision)).rejects.toThrow(
      'Authentication required',
    )
    expectNoWrite()
  })

  it.each(['traveler', 'host_applicant', 'operator'] as const)(
    'rejects a signed-in actor without the certified-host role: %s',
    async (role) => {
      mocks.currentActor.mockResolvedValue({ ...host, roles: [role] })

      await expect(
        reviseHostedTableAction(tableId, revision),
      ).rejects.toBeInstanceOf(AuthorizationError)
      expectNoWrite()
    },
  )

  it('requires verified email even when the host role is present', async () => {
    mocks.currentActor.mockResolvedValue({ ...host, emailVerified: false })

    await expect(
      reviseHostedTableAction(tableId, revision),
    ).rejects.toBeInstanceOf(AuthorizationError)
    expectNoWrite()
  })

  it.each(['not-a-uuid', '../another-table', ''])(
    'rejects a malformed target before database access: %s',
    async (invalidId) => {
      await expect(
        reviseHostedTableAction(invalidId, revision),
      ).resolves.toEqual({ status: 'invalid_request' })
      expectNoWrite()
    },
  )

  it.each([
    { ...revision, menuTitle: '   ' },
    { ...revision, menuDescription: 'too short' },
    { ...revision, atmosphere: 'x'.repeat(241) },
    { ...revision, accessibilityInformation: null },
  ])('rejects invalid content on the server', async (invalidRevision) => {
    await expect(
      reviseHostedTableAction(tableId, invalidRevision),
    ).resolves.toEqual({ status: 'invalid_request' })
    expectNoWrite()
  })

  it('refuses attempts to smuggle identity, lifecycle or commercial fields into a revision', async () => {
    await expect(
      reviseHostedTableAction(tableId, {
        ...revision,
        tableId: 'b3200000-0000-4000-8000-000000000002',
        actorId: 'another-host',
        status: 'published',
        startsAt: '2026-11-05T16:00:00Z',
        proposedCapacity: 100,
        hostNetPayoutKurus: 1,
        guestPriceKurus: 1,
      }),
    ).resolves.toEqual({ status: 'invalid_request' })
    expectNoWrite()
  })

  it('does not save or claim success when durable writes are unavailable', async () => {
    mocks.currentActor.mockResolvedValue({ ...host, source: 'demo' })
    mocks.canPersist.mockReturnValue(false)

    await expect(reviseHostedTableAction(tableId, revision)).resolves.toEqual({
      status: 'unavailable',
    })
    expectNoWrite()
  })

  it('uses the authenticated profile and sends only normalized experience fields', async () => {
    const padded = Object.fromEntries(
      Object.entries(revision).map(([key, value]) => [key, `  ${value}  `]),
    )

    await expect(
      reviseHostedTableAction(tableId, padded, 'tr'),
    ).resolves.toEqual({
      status: 'saved',
    })
    expect(mocks.hostRepository).toHaveBeenCalledExactlyOnceWith(host.id)
    expect(mocks.reviseDraft).toHaveBeenCalledExactlyOnceWith({
      tableId,
      ...revision,
    })

    // A Turkish edit must not leave stale English host or operator views.
    for (const locale of ['en', 'tr']) {
      for (const path of [
        `/host/tables/${tableId}/edit`,
        '/host/tables',
        '/host/dashboard',
        `/admin/tables/${tableId}`,
        '/admin/tables',
        '/admin',
        '/admin/audit',
      ]) {
        expect(mocks.revalidatePath).toHaveBeenCalledWith(`/${locale}${path}`)
      }
    }
  })

  it.each<[HostWriteErrorCode, string]>([
    ['TABLE_NOT_FOUND', 'not_found'],
    ['TABLE_NOT_EDITABLE', 'not_editable'],
    ['NO_ACTIVE_CERTIFICATION', 'not_certified'],
    ['NO_CERTIFIED_HOUSEHOLD', 'not_certified'],
    ['TABLE_CONTENT_INVALID', 'invalid_request'],
  ])(
    'returns a safe outcome for %s without revalidating',
    async (code, status) => {
      mocks.reviseDraft.mockRejectedValue(
        new HostWriteError(
          code,
          'Private database detail must not reach the form',
        ),
      )

      await expect(reviseHostedTableAction(tableId, revision)).resolves.toEqual(
        {
          status,
        },
      )
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    },
  )

  it('does not use an arbitrary client locale as a cache path', async () => {
    await expect(
      reviseHostedTableAction(tableId, revision, '../../unrelated'),
    ).resolves.toEqual({ status: 'saved' })

    expect(mocks.revalidatePath).toHaveBeenCalled()
    for (const [path] of mocks.revalidatePath.mock.calls) {
      expect(path).toMatch(/^\/(en|tr)\/(host|admin)(\/|$)/)
      expect(path).not.toContain('..')
    }
  })

  it('does not expose unexpected database failures or claim a save', async () => {
    mocks.reviseDraft.mockRejectedValue(
      new Error('Sensitive connection or household diagnostic'),
    )

    await expect(reviseHostedTableAction(tableId, revision)).resolves.toEqual({
      status: 'unexpected_error',
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
