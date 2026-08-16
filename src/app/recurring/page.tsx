import Link from 'next/link'

import { getRecurring } from '../../lib/queries.ts'
import { fullDate, money, plural } from '../../lib/format.ts'

export const dynamic = 'force-dynamic'

const CADENCE: [number, number, string][] = [
  [5, 9, 'Weekly'],
  [11, 17, 'Fortnightly'],
  [26, 35, 'Monthly'],
  [80, 100, 'Quarterly'],
  [350, 380, 'Yearly'],
]

function cadenceLabel(days: number): string {
  return CADENCE.find(([lo, hi]) => days >= lo && days <= hi)?.[2] ?? `Every ${days} days`
}

export default async function RecurringPage() {
  const rows = await getRecurring()
  const overdue = rows.filter((row) => row.possiblyCancelled)
  const live = rows.filter((row) => !row.possiblyCancelled)
  const monthlyTotal = live.reduce((sum, row) => sum + row.monthlyEquivalent, 0)

  // Loan repayments and Sharesies are the two largest things charging on a
  // cycle, and they dwarf everything else. Rolling them into one "committed"
  // figure would make it read as a subscriptions total when it mostly isn't.
  const capitalMonthly = live
    .filter((row) => !row.isConsumption)
    .reduce((sum, row) => sum + row.monthlyEquivalent, 0)
  const livingMonthly = monthlyTotal - capitalMonthly

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Recurring</h1>
          <p>
            Anything charging on a rhythm, with the interval worked out from the gaps between
            charges. Nothing here is labelled as a subscription by the bank — it is all inferred.
          </p>
        </div>
        <div className="headline" style={{ minWidth: 260 }}>
          <div className="eyebrow">Recurring living costs</div>
          <div className="headline-value" style={{ fontSize: 30 }}>
            {money(livingMonthly)}
          </div>
          <div className="headline-note">
            per month, across {plural(live.length, 'active charge')}.
            {capitalMonthly > 0 && (
              <>
                {' '}
                Loan and investing add another{' '}
                <strong className="num">{money(capitalMonthly)}</strong>.
              </>
            )}
          </div>
        </div>
      </div>

      {overdue.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Overdue — possibly cancelled</h2>
              <p>
                Past twice its own interval without a charge. Either it stopped, or it is about to
                surprise you.
              </p>
            </div>
          </div>
          <Table rows={overdue} highlight />
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Charging on schedule</h2>
            <p>Ordered by what each one costs per month.</p>
          </div>
        </div>
        <Table rows={live} />
      </section>
    </>
  )
}

function Table({
  rows,
  highlight = false,
}: {
  rows: Awaited<ReturnType<typeof getRecurring>>
  highlight?: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="empty">
        <strong>Nothing detected</strong>
        A merchant needs at least three charges at a consistent interval before it counts.
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Merchant</th>
            <th style={{ width: 130 }}>Cadence</th>
            <th style={{ width: 170 }}>Last charged</th>
            <th className="col-amount" style={{ width: 110 }}>
              Typical
            </th>
            <th className="col-amount" style={{ width: 120 }}>
              Per month
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.merchant}>
              <td>
                <Link
                  href={`/transactions?q=${encodeURIComponent(row.merchant)}`}
                  style={{ textDecoration: 'none', fontWeight: 500 }}
                >
                  {row.merchant}
                </Link>
                {row.isPayg && (
                  <span className="tag tag-ghost" style={{ marginLeft: 6 }}>
                    pay as you go
                  </span>
                )}
                {row.category && (
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{row.category}</div>
                )}
              </td>
              <td>
                {cadenceLabel(row.cadenceDays)}
                <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                  {plural(row.chargeCount, 'charge')}
                </div>
              </td>
              <td>
                <span style={{ fontSize: 12 }}>{fullDate(row.lastCharged)}</span>
                <div
                  style={{
                    fontSize: 11,
                    color: highlight ? 'var(--warn)' : 'var(--ink-faint)',
                    fontWeight: highlight ? 600 : 400,
                  }}
                >
                  {row.daysSinceLast} days ago
                  {highlight && ` — ${Math.round(row.daysSinceLast / row.cadenceDays)}× its interval`}
                </div>
              </td>
              <td className="col-num">{money(row.averageAmount)}</td>
              <td className="col-num" style={{ fontWeight: 600 }}>
                {money(row.monthlyEquivalent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
