import Link from 'next/link'

import { BudgetPressure } from '../../components/budget-pressure.tsx'
import { CategoryBars } from '../../components/category-bars.tsx'
import { Commentary } from '../../components/commentary.tsx'
import { DayTape } from '../../components/day-tape.tsx'
import { FlowLedger } from '../../components/flow-ledger.tsx'
import { FlowTrend } from '../../components/flow-trend.tsx'
import { PeriodPicker } from '../../components/period-picker.tsx'
import { RecentActivity } from '../../components/recent-activity.tsx'
import { Sieve } from '../../components/sieve.tsx'
import {
  getBiggestPurchase,
  getBudget,
  getCategoryTotals,
  getDays,
  getFlowPace,
  getHealth,
  getPeriods,
  getSettings,
  getSieve,
  getTransactions,
  getTrend,
} from '../../lib/queries.ts'
import {
  comparisonFor,
  flowsFor,
  headlineFor,
  insightsFor,
  pressureFor,
  tapeFor,
  type Reading,
} from '../../lib/dashboard.ts'
import { dateTime, moneyWhole, periodLabel, periodRule, plural } from '../../lib/format.ts'
import { usedShare } from '../../lib/budget.ts'

export const dynamic = 'force-dynamic'

/** Enough of the feed to cover a long weekend, short enough to stay a glance. */
const FEED_LENGTH = 8

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period } = await searchParams
  const periods = await getPeriods()

  if (periods.length === 0) {
    return (
      <div className="page-head">
        <div>
          <h1>Nothing here yet</h1>
          <p>
            Connect an account and run a sync, or load twelve months of demo data with{' '}
            <code>npm run seed:demo &amp;&amp; npm run recompute</code>.
          </p>
        </div>
      </div>
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

  const [sieve, trend, categories, health, pace, budget, biggest, settings, days, recent] =
    await Promise.all([
      getSieve(selected),
      getTrend(13),
      getCategoryTotals(selected),
      getHealth(),
      getFlowPace(selected, active.elapsedDays),
      getBudget(selected, active.elapsedDays, active.totalDays),
      getBiggestPurchase(selected),
      getSettings(),
      getDays(selected),
      // Not filtered to the period while that period is the one we are living
      // in: on its first days the newest thing that happened is still filed
      // under the period before, and a feed that hides it is a feed that says
      // nothing happened. A closed period being read as history keeps its
      // filter, because there "latest" means latest in that period.
      getTransactions({ periodStart: active.isCurrent ? null : selected, limit: FEED_LENGTH }),
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

  const headline = headlineFor(reading)
  const flows = flowsFor(reading)
  const insights = insightsFor(reading)
  const pressure = pressureFor(budget, partial)
  const tape = tapeFor(reading, days)

  const previous = periods.find((p) => p.start < selected && p.hasData)
  const daysLeft = Math.max(active.totalDays - active.elapsedDays, 0)

  // The ledger's own today, which the feed needs to say "yesterday" with. Only
  // meaningful inside the period that contains it.
  const today = active.isCurrent
    ? new Date(new Date(`${selected}T00:00:00Z`).getTime() + (active.elapsedDays - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10)
    : null

  // Only categories with a limit in force for this period. The rest of the
  // ranking keeps its average tick, so an unbudgeted category is still measured
  // against something rather than reading as unmeasured.
  const limits = new Map(
    budget.budgeted.map((line) => [
      line.categoryId,
      { budget: line.budget ?? 0, expectedByNow: line.expectedByNow },
    ]),
  )

  const nothingRecorded = sieve.totalOut === 0

  return (
    <>
      <header className="today">
        <div>
          <p className="eyebrow">{active.isCurrent ? 'This period' : 'Closed period'}</p>
          <h1>{periodLabel(active.start, active.end)}</h1>
          <p className="today-meta">
            {partial ? (
              <>
                Day {active.elapsedDays} of {active.totalDays}, {plural(daysLeft, 'day')} left
              </>
            ) : (
              <>{active.totalDays} days, all of them in</>
            )}
            {health.lastSynced && <> · synced {dateTime(health.lastSynced)}</>}
          </p>
        </div>
        <PeriodPicker periods={periods} selected={selected} basePath="/" showLabel={false} />
      </header>

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
                The sync has not reached {health.stale.map((a) => a.name).join(', ')} recently.
                Figures below are missing whatever has happened since.
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

      {nothingRecorded ? (
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
          <section className={`hero hero-${headline.tone}`}>
            <div className="hero-headline">
              <p className="eyebrow">{headline.label}</p>
              <p className="hero-value num">{moneyWhole(headline.value)}</p>
              <p className="hero-sub">{headline.sub}</p>

              {budget.exists && (
                <span className="hero-meter" aria-hidden>
                  <span
                    className="hero-meter-fill"
                    style={{ width: `${usedShare(budget.spent, budget.total) * 100}%` }}
                  />
                  {partial && budget.expectedByNow > 0 && (
                    <span
                      className="hero-meter-mark"
                      style={{
                        left: `${usedShare(budget.expectedByNow, budget.total) * 100}%`,
                      }}
                    />
                  )}
                </span>
              )}
            </div>

            <div className="hero-tape">
              <DayTape tape={tape} partial={partial} />
            </div>

            <p className={`hero-verdict verdict-${headline.verdictTone}`}>
              {headline.verdict}{' '}
              {headline.href && (
                <Link href={headline.href}>
                  {budget.exists ? 'Open the budget' : 'Set a budget'}
                </Link>
              )}
            </p>
          </section>

          <section className="card card-flat">
            <FlowLedger flows={flows} />
          </section>

          {insights.length > 0 && (
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Worth knowing</h2>
                  <p>Only what clears a threshold worth acting on.</p>
                </div>
              </div>
              <Commentary insights={insights} />
            </section>
          )}

          <div className="grid-2 grid-top">
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Under pressure</h2>
                  <p>
                    {budget.exists ? (
                      <>
                        Budgets running past where they should be by now, hardest first. The mark
                        on each bar is what that limit allows by today.
                      </>
                    ) : (
                      <>A limit per category is what turns a figure into a verdict.</>
                    )}
                  </p>
                </div>
              </div>

              {pressure.length > 0 ? (
                <BudgetPressure rows={pressure} periodStart={selected} partial={partial} />
              ) : (
                <p className="note">
                  {budget.exists ? (
                    <>
                      All {plural(budget.budgeted.length, 'budget')} are inside their pace.{' '}
                      <Link href={`/budget?period=${selected}`}>See them all</Link>
                    </>
                  ) : (
                    <>
                      No limits are set for this period, so there is nothing to run past.{' '}
                      <Link href="/budget">Set a budget</Link>
                    </>
                  )}
                </p>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Latest activity</h2>
                  <p>The last few days of the ledger, newest first.</p>
                </div>
              </div>
              <RecentActivity rows={recent} today={today} />
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Out against in</h2>
                <p>
                  {periodRule(settings.statementStartDay)} Each column is money leaving - spending
                  in green, with what was put away stacked above it. The blue line is what came in
                  that period, so a column that clears its line is a period that did not pay for
                  itself.
                </p>
              </div>
            </div>
            <FlowTrend
              points={trend}
              selected={selected}
              partialPeriod={current?.start}
            />
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Where it went</h2>
                <p>
                  {budget.exists ? (
                    <>
                      The mark on each bar is that category&rsquo;s budget where one is set, and its
                      own average per period where none is.{' '}
                    </>
                  ) : (
                    <>The tick on each bar is that category&rsquo;s own average per period. </>
                  )}
                  Select a category to see the transactions behind it.
                </p>
              </div>
              <Link href="/categories" className="btn btn-quiet">
                All categories
              </Link>
            </div>
            <CategoryBars
              totals={categories.slice(0, 8)}
              periodStart={selected}
              limits={limits}
              partial={partial}
            />
          </section>

          <section className="card card-quiet">
            <div className="card-head">
              <div>
                <h2>What did not count as spending</h2>
                <p>
                  Everything that left the account, with each band that is not spending peeling off
                  in turn, ending in the one that is. This is the working behind every figure
                  above.
                </p>
              </div>
            </div>
            <Sieve
              data={sieve}
              comparison={comparisonFor(reading)}
              progress={
                partial
                  ? { elapsedDays: active.elapsedDays, totalDays: active.totalDays }
                  : undefined
              }
              showHeadline={false}
            />
          </section>
        </>
      )}
    </>
  )
}
