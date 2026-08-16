import Link from 'next/link'

import { CategoryBars } from '../components/category-bars.tsx'
import { PeriodPicker } from '../components/period-picker.tsx'
import { Sieve } from '../components/sieve.tsx'
import { TrendChart } from '../components/trend-chart.tsx'
import {
  getCategoryTotals,
  getHealth,
  getPaceComparison,
  getPeriods,
  getSieve,
  getTrend,
} from '../lib/queries.ts'
import { moneyWhole, periodLabel } from '../lib/format.ts'

export const dynamic = 'force-dynamic'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period } = await searchParams
  const periods = await getPeriods()

  if (periods.length === 0) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Nothing here yet</h1>
            <p>
              Connect an account and run a sync, or load twelve months of demo data with{' '}
              <code>npm run seed:demo &amp;&amp; npm run recompute</code>.
            </p>
          </div>
        </div>
      </>
    )
  }

  // Defaults to the period we are living in, not the last one that closed.
  const active = periods.find((p) => p.start === period) ?? periods[0]!
  const selected = active.start
  const partial = active.isCurrent && active.elapsedDays < active.totalDays

  const [sieve, trend, categories, health, pace] = await Promise.all([
    getSieve(selected),
    getTrend(13),
    getCategoryTotals(selected),
    getHealth(),
    partial ? getPaceComparison(selected, active.elapsedDays) : null,
  ])

  // A part-finished period is compared against the same point in prior periods.
  // A closed one is compared against whole prior periods, excluding itself so
  // it is not partly measured against its own value.
  // Only closed periods, and never the selected one. A period still running is
  // a partial total, and averaging it in drags the benchmark down by however
  // far through it we happen to be.
  const closed = new Set(periods.filter((p) => !p.isCurrent).map((p) => p.start))
  const others = trend.filter((point) => point.periodStart !== selected && closed.has(point.periodStart))
  const wholePeriodAverage =
    others.length > 0 ? others.reduce((sum, p) => sum + p.living, 0) / others.length : 0

  const comparison = partial
    ? { average: pace!.average, label: `vs average by day ${active.elapsedDays}` }
    : { average: wholePeriodAverage, label: 'vs 12-period average' }

  const previous = periods.find((p) => p.start < selected && p.hasData)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>What I actually spend</h1>
          <p>
            Everything that moved, with the money that only looks like spending taken back out.
          </p>
        </div>
        <PeriodPicker periods={periods} selected={selected} basePath="/" />
      </div>

      {health.stale.length > 0 && (
        <div className="banner">
          <span aria-hidden>⚠</span>
          <div>
            <strong>
              {health.stale.length === 1
                ? `${health.stale[0]!.name} is behind.`
                : `${health.stale.length} accounts are behind.`}
            </strong>{' '}
            {health.stale.some((a) => a.source === 'csv') ? (
              <>
                A card statement has not been imported for{' '}
                {health.stale.find((a) => a.source === 'csv')!.daysSinceTransaction} days. Its
                purchases are missing while the payment that settles them is still excluded, so
                spending below is understated. Export a fresh CSV and run{' '}
                <code>npm run import:csv</code>.
              </>
            ) : (
              <>
                The sync has not reached{' '}
                {health.stale.map((a) => a.name).join(', ')} recently. Figures below are missing
                whatever has happened since.
              </>
            )}
          </div>
        </div>
      )}

      {health.drift !== 0 && (
        <div className="banner">
          <span aria-hidden>⚠</span>
          <div>
            <strong>These totals do not reconcile.</strong> Raw net cash is out by{' '}
            <span className="num">{moneyWhole(health.drift)}</span> against the classified buckets,
            so something is counted twice or not at all. Fix this before trusting anything on this
            page.
          </div>
        </div>
      )}

      {sieve.totalOut === 0 && active.isCurrent ? (
        <section className="card">
          <div className="empty">
            <strong>Nothing yet this period</strong>
            {active.elapsedDays === 1
              ? 'This period started today.'
              : `${active.elapsedDays} days in, and nothing has come through yet.`}{' '}
            {previous && (
              <>
                <Link href={`/?period=${previous.start}`}>
                  See {periodLabel(previous.start, previous.end)}
                </Link>{' '}
                instead.
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="card">
          <Sieve
            data={sieve}
            comparison={comparison}
            progress={
              partial
                ? { elapsedDays: active.elapsedDays, totalDays: active.totalDays }
                : undefined
            }
          />
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Living costs by period</h2>
            <p>
              Statement periods, the 16th to the 15th. The pale block above each column is
              investing and transfers — real money, but saving rather than spending.
            </p>
          </div>
        </div>
        {/* Always the whole-period average: the chart's columns are whole
            periods, whatever the headline above is comparing. */}
        <TrendChart points={trend} selected={selected} average={wholePeriodAverage} />
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Where it went</h2>
            <p>
              The tick on each bar is that category&rsquo;s own average per period. Select a
              category to see the transactions behind it.
            </p>
          </div>
          <Link href="/categories" className="btn btn-quiet">
            All categories
          </Link>
        </div>
        <CategoryBars totals={categories.slice(0, 10)} periodStart={selected} />
      </section>
    </>
  )
}
