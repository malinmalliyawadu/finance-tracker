import Link from 'next/link'

import { BudgetTrack } from '../../components/budget-track.tsx'
import { CategoryBars } from '../../components/category-bars.tsx'
import { Commentary } from '../../components/commentary.tsx'
import { HeadlineTiles } from '../../components/headline-tiles.tsx'
import { PeriodPicker } from '../../components/period-picker.tsx'
import { Sieve } from '../../components/sieve.tsx'
import { TrendChart } from '../../components/trend-chart.tsx'
import {
  getBiggestPurchase,
  getBudget,
  getCategoryTotals,
  getHealth,
  getPaceComparison,
  getPeriods,
  getSettings,
  getSieve,
  getTrend,
} from '../../lib/queries.ts'
import {
  comparisonFor,
  forecastFor,
  headlineTiles,
  insightsFor,
  type Reading,
} from '../../lib/dashboard.ts'
import { moneyWhole, periodLabel, periodRule } from '../../lib/format.ts'

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

  // Defaults to the period we are living in — but only once it has something in
  // it. Bank data runs a few days behind, so for the first days of every period
  // the current one is genuinely empty, and opening on a blank page is worse
  // than opening on the most recent period that has anything to show.
  const requested = period ? periods.find((p) => p.start === period) : undefined
  const mostRecentWithData = periods.find((p) => p.hasData)
  const active = requested ?? mostRecentWithData ?? periods[0]!
  const selected = active.start

  const current = periods.find((p) => p.isCurrent)
  const waitingOnData = !requested && current !== undefined && !current.hasData && !active.isCurrent

  const partial = active.isCurrent && active.elapsedDays < active.totalDays

  const [sieve, trend, categories, health, pace, budget, biggest, settings] = await Promise.all([
    getSieve(selected),
    getTrend(13),
    getCategoryTotals(selected),
    getHealth(),
    partial ? getPaceComparison(selected, active.elapsedDays) : null,
    getBudget(selected, active.elapsedDays, active.totalDays),
    getBiggestPurchase(selected),
    getSettings(),
  ])

  // Only closed periods, and never the selected one. A period still running is
  // a partial total, and averaging it in drags the benchmark down by however
  // far through it we happen to be.
  const closed = new Set(periods.filter((p) => !p.isCurrent).map((p) => p.start))
  const others = trend.filter((point) => point.periodStart !== selected && closed.has(point.periodStart))
  const wholePeriodAverage =
    others.length > 0 ? others.reduce((sum, p) => sum + p.living, 0) / others.length : 0

  const reading: Reading = {
    periodStart: selected,
    partial,
    elapsedDays: active.elapsedDays,
    totalDays: active.totalDays,
    sieve,
    budget,
    pace,
    wholePeriodAverage,
    biggest,
  }

  const comparison = comparisonFor(reading)
  const forecast = forecastFor(reading)
  const tiles = headlineTiles(reading)
  const insights = insightsFor(reading)

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

      {waitingOnData && current && (
        <p className="note">
          {periodLabel(current.start, current.end)} has nothing in it yet
          {current.elapsedDays === 1
            ? ', because it started today'
            : `, ${current.elapsedDays} days in`}
          . Bank data runs a few days behind.{' '}
          <Link href={`/?period=${current.start}`}>Open it anyway</Link>, or carry on with the
          period below.
        </p>
      )}

      {sieve.totalOut === 0 ? (
        <section className="card">
          <div className="empty">
            <strong>Nothing recorded in this period</strong>
            {active.isCurrent && active.elapsedDays === 1
              ? 'It started today, and bank data runs a few days behind.'
              : 'No transactions have come through for these dates.'}{' '}
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
        <>
          {budget.exists && (
            <section className="card">
              <HeadlineTiles tiles={tiles} />

              <BudgetTrack
                total={budget.total}
                spent={budget.spent}
                expectedByNow={budget.expectedByNow}
                projected={forecast.budget}
                partial={partial}
                elapsedDays={active.elapsedDays}
              />

              <p className="note track-foot">
                {partial ? (
                  <>
                    Measured against what these categories usually spend by day{' '}
                    {active.elapsedDays}, not against a straight-line share of the period.{' '}
                  </>
                ) : (
                  <>Every limit as it stood while this period was running. </>
                )}
                <Link href={`/budget?period=${selected}`}>See it by category</Link>
              </p>
            </section>
          )}

          {insights.length > 0 && (
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>What stands out</h2>
                  <p>
                    Only what clears a threshold worth acting on. A period with nothing unusual
                    in it has a short list.
                  </p>
                </div>
              </div>
              <Commentary insights={insights} />
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <div>
                <h2>What counts as spending</h2>
                <p>
                  Everything that left the account, with each band that is not spending peeling
                  off in turn, ending in the one that is.
                </p>
              </div>
            </div>
            <Sieve
              data={sieve}
              comparison={comparison}
              progress={
                partial
                  ? { elapsedDays: active.elapsedDays, totalDays: active.totalDays }
                  : undefined
              }
              showHeadline={!budget.exists}
            />
          </section>
        </>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Living costs by period</h2>
            <p>
              {periodRule(settings.statementStartDay)} The pale block above each column is
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
