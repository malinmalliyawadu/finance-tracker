'use client'

import { useOptimistic, useTransition } from 'react'

import { restoreTransaction } from '../app/actions.ts'
import type { DeletedTransactionRow } from '../lib/queries.ts'
import { dateTime, fullDate, money } from '../lib/format.ts'

/**
 * The rows a human has deleted, each with a way back.
 *
 * Deletion is a tombstone rather than a delete, and this list is the reason
 * that matters: a mistaken click costs a second click here, not a re-sync.
 */
export function DeletedTransactions({ rows }: { rows: DeletedTransactionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="empty">
        <strong>Nothing deleted</strong>
        Rows deleted from the transactions list appear here and can be put back.
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 104 }}>Date</th>
            <th>Description</th>
            <th className="col-account" style={{ width: 150 }}>
              Account
            </th>
            <th style={{ width: 170 }}>Deleted</th>
            <th className="col-amount" style={{ width: 120 }}>
              Amount
            </th>
            <th style={{ width: 90 }}>
              <span className="visually-hidden">Restore</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({ row }: { row: DeletedTransactionRow }) {
  const [pending, startTransition] = useTransition()
  const [restored, showRestored] = useOptimistic(false)

  if (restored) return null

  return (
    <tr style={pending ? { opacity: 0.5 } : undefined}>
      <td className="col-num" style={{ textAlign: 'left', fontSize: 12, color: 'var(--ink-muted)' }}>
        {fullDate(row.date)}
      </td>

      <td>
        <span className="desc">
          <strong>{row.description}</strong>
        </span>
      </td>

      <td className="col-account" style={{ color: 'var(--ink-muted)', fontSize: 12 }}>
        {row.account}
      </td>

      <td style={{ color: 'var(--ink-muted)', fontSize: 12 }}>{dateTime(row.deletedAt)}</td>

      <td className="col-amount">
        <span
          className={row.amount > 0 ? 'amount-in' : 'amount-out'}
          style={{ color: 'var(--ink-faint)' }}
        >
          {money(row.amount)}
        </span>
      </td>

      <td>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              showRestored(true)
              await restoreTransaction(row.id)
            })
          }}
        >
          Restore
        </button>
      </td>
    </tr>
  )
}
