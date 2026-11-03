import type { ReactNode } from 'react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface RecordColumn<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** Becomes the card's heading on a narrow screen. Exactly one per list. */
  primary?: boolean
  /** Spans the full card width instead of sitting in a label/value pair. */
  wide?: boolean
  /**
   * Whether this column has anything to say about this record. A cell that
   * renders to nothing still leaves its label standing over empty space,
   * and a JSX element is truthy even when the component returns null.
   */
  visible?: (row: T) => boolean
}

/**
 * The same records as a table on a wide screen and as cards on a narrow one.
 *
 * A table wrapped in overflow-x-auto technically "fits" any viewport: the
 * document never scrolls sideways, so an automated width check passes. What
 * actually happens on a phone is that the later columns are simply gone
 * behind a scroll nobody discovers -- on the bookings queue that meant an
 * operator saw booking ids and menu titles while status and payment, the two
 * things the screen exists to show, were off-screen.
 *
 * Both views are rendered from one column definition rather than two blocks
 * of markup, so they cannot drift apart.
 */
export function RecordList<T>({
  columns,
  rows,
  getKey,
  caption,
  empty,
}: {
  columns: RecordColumn<T>[]
  rows: readonly T[]
  getKey: (row: T) => string
  /** Describes the table for assistive technology. */
  caption: string
  empty: ReactNode
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground rounded-2xl border p-5 text-sm">
        {empty}
      </p>
    )
  }

  const primary = columns.find((column) => column.primary) ?? columns[0]
  const rest = columns.filter((column) => column !== primary)

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key}>{column.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={getKey(row)}>
                {columns.map((column) => (
                  <TableCell key={column.key}>{column.cell(row)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-3 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={getKey(row)} className="grid gap-3 rounded-2xl border p-4">
            <div className="min-w-0 font-medium break-words">
              {primary.cell(row)}
            </div>
            <dl className="grid gap-2 text-sm">
              {rest.map((column) => {
                if (column.visible && !column.visible(row)) return null
                const value = column.cell(row)
                if (value === null || value === undefined || value === false) {
                  return null
                }
                return (
                  <div
                    key={column.key}
                    className={cn(
                      'min-w-0 gap-1',
                      column.wide
                        ? 'grid'
                        : 'grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-baseline gap-3',
                    )}
                  >
                    <dt className="text-muted-foreground text-xs">
                      {column.header}
                    </dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                  </div>
                )
              })}
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}
