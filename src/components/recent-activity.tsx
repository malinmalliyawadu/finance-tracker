import Link from 'next/link'

import type { TransactionRow } from '../lib/queries.ts'
import { money, weekdayDate } from '../lib/format.ts'

/**
 * The last few days of the ledger, grouped by the day they landed on.
 *
 * The one thing a daily reader came for and the one thing a page of totals
 * cannot give them: what actually went through since yesterday. Grouped by day
 * rather than listed flat, because "did that refund come through" and "what did
 * Saturday cost" are both questions about a day.
 *
 * Money that does not count as spending is still shown, greyed. It happened,
 * and leaving it out would make the feed disagree with the bank.
 */
export function RecentActivity({
  rows,
  today,
}: {
  rows: TransactionRow[]
  /** The ledger's today, for naming the most recent day. Null on a closed period. */
  today: string | null
}) {
  if (rows.length === 0) {
    return <p className="note">Nothing has come through yet.</p>
  }

  const days = new Map<string, TransactionRow[]>()
  for (const row of rows) {
    const bucket = days.get(row.date)
    if (bucket) bucket.push(row)
    else days.set(row.date, [row])
  }

  const yesterday = today
    ? new Date(`${today}T00:00:00Z`).getTime() - 86_400_000
    : null

  const nameFor = (date: string) => {
    if (date === today) return 'Today'
    if (yesterday !== null && new Date(`${date}T00:00:00Z`).getTime() === yesterday) {
      return 'Yesterday'
    }
    return weekdayDate(date)
  }

  return (
    <div className="feed">
      {[...days].map(([date, entries]) => (
        <div key={date} className="feed-day">
          <p className="feed-date">{nameFor(date)}</p>
          <ul className="feed-list">
            {entries.map((row) => (
              <li key={row.id} className="feed-row">
                <span className="feed-what">
                  <strong>{row.merchant ?? row.description}</strong>
                  <small>{row.category ?? (row.exclusionReason ? 'not spending' : 'uncategorised')}</small>
                </span>
                <span
                  className={`num ${
                    row.exclusionReason
                      ? 'amount-muted'
                      : row.amount < 0
                        ? 'amount-out'
                        : 'amount-in'
                  }`}
                >
                  {money(row.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <Link href="/transactions" className="feed-more">
        Every transaction
      </Link>
    </div>
  )
}
