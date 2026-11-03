/**
 * The outcome of trying to create a table draft.
 *
 * Deliberately its own module rather than living beside the server action:
 * the create form is a client component, and importing anything -- even a
 * type -- from a 'use server' module pulls that module into the client graph
 * and stops the component hydrating. The form then falls back to a native GET
 * submit, which looks like it worked and writes nothing.
 */
export type CreateHostedTableResult =
  | { status: 'created'; tableId: string; slug: string }
  | { status: 'unavailable' }
  | { status: 'not_certified' }
  | { status: 'address_unverified' }
  | { status: 'capacity_exceeded' }
  | { status: 'schedule_rejected' }
  | { status: 'table_limit_reached' }
  | { status: 'invalid_request' }
  | { status: 'unexpected_error' }
