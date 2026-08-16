import Link from 'next/link'

import { BudgetBars } from '../../components/budget-bars.tsx'
import { BudgetEditor } from '../../components/budget-editor.tsx'
import { PeriodPicker } from '../../components/period-picker.tsx'
import { suggestedAmount, verdictFor } from '../../lib/budget.ts'
import { getBudget, getPeriods } from '../../lib/queries.ts'
import { money, moneyWhole, periodLabel, plural } from '../../lib/format.ts'

export const dynamic = 'force-dynamic'

export default async function BudgetPage({
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
          <h1>Nothing to budget yet</h1>
          <p>
            A budget is set against categories, and there are no transactions to categorise. Run a
            sync, or load twelve months of demo data with{' '}
            <code>npm run seed:demo &amp;&amp; npm run recompute</code>.
          </p>
        </div>
      </div>
    )
  }

  // Unlike the dashboard, this defaults to the period we are living in even
  // when nothing has landed in it. A budget for a period that has not started
  // spending yet is the most useful thing on this page, not an empty one.
  const requested = period ? periods.find((p) => p.start === period) : undefined
  const active = requested ?? periods.find((p) => p.isCurrent) ?? periods[0]!

  const partial = active.isCurrent && active.elapsedDays < active.totalDays
  const budget = await getBudget(active.start, active.elapsedDays, active.totalDays)

  const suggestions = new Map(
    budget.lines
      .map((line) => [line.categoryId, suggestedAmount(line.averagePerPeriod) ?? 0] as const)
      .filter(([, amount]) => amount > 0),
  )

  const remaining = budget.total - budget.spent
  const verdict = verdictFor(
    { budget: budget.total, spent: budget.spent, expectedByNow: budget.expectedByNow },
    partial,
  )
  const over = verdict.tone === 'over'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Budget</h1>
          <p>
            What each category is meant to cost, against what it actually did. Set once and it
            carries forward, so a period is always judged against the figure that was in force
            while it was running.
          </p>
        </div>
        <PeriodPicker periods={periods} selected={active.start} basePath="/budget" />
      </div>

      {budget.exists ? (
        <section className="card">
          <div className="budget-summary">
            <div>
              <div className="eyebrow" style={{ marginBottom: 12 }}>
                {plural(budget.budgeted.length, 'category', 'categories')} budgeted
              </div>
              <BudgetBars lines={budget.budgeted} periodStart={active.start} partial={partial} />
            </div>

            <div>
              <div className={`headline${over ? ' headline-over' : ''}`}>
                <div className="eyebrow">{over ? 'Over budget' : 'Left to spend'}</div>
                <div className="headline-value">{moneyWhole(Math.abs(remaining))}</div>

                {partial && (
                  <>
                    <div className="progress" aria-hidden>
                      <span
                        className="progress-fill"
                        style={{ width: `${(active.elapsedDays / active.totalDays) * 100}%` }}
                      />
                    </div>
                    <div className="headline-note">
                      Day {active.elapsedDays} of {active.totalDays}, with{' '}
                      {moneyWhole(budget.expectedByNow)} of the budget expected to be gone by now.
                    </div>
                  </>
                )}

                <div className={`headline-delta ${over ? 'delta-over' : 'delta-under'}`}>
                  {over ? '▲' : '▼'} {verdict.label}
                </div>
              </div>

              <dl className="stat-list">
                <div className="stat-row">
                  <dt>Budgeted</dt>
                  <dd>{moneyWhole(budget.total)}</dd>
                </div>
                <div className="stat-row">
                  <dt>Spent against it</dt>
                  <dd>−{moneyWhole(budget.spent)}</dd>
                </div>
                <div className="stat-row" style={{ borderTop: '2px solid var(--ink)', paddingTop: 10 }}>
                  <dt style={{ fontWeight: 600, color: 'var(--ink)' }}>
                    {over ? 'Overspent' : 'Remaining'}
                  </dt>
                  <dd
                    style={{
                      fontWeight: 700,
                      color: over ? 'var(--alert)' : 'var(--living)',
                    }}
                  >
                    {moneyWhole(remaining)}
                  </dd>
                </div>
                {budget.unbudgetedSpent > 0 && (
                  <div className="stat-row">
                    <dt>Spent outside the budget</dt>
                    <dd style={{ color: 'var(--warn)' }}>{moneyWhole(budget.unbudgetedSpent)}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>No budget for {periodLabel(active.start, active.end)}</h2>
              <p>
                Set a limit against any category below and it applies from this period onwards. The
                greyed figure in each box is what that category has actually cost per period
                recently, so the fastest way to start is to fill them all in and then argue with the
                two or three that are wrong.
              </p>
            </div>
          </div>

          <BudgetEditor
            lines={budget.lines}
            periodStart={active.start}
            periodEnd={active.end}
            suggestions={suggestions}
          />
        </section>
      )}

      {budget.exists && budget.unbudgeted.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Spent outside the budget</h2>
              <p>
                {moneyWhole(budget.unbudgetedSpent)} in{' '}
                {plural(budget.unbudgeted.length, 'category', 'categories')} with no limit set. A
                budget that covers most of the spending and none of the surprises is the usual way
                one turns out to be wrong, so these are listed rather than quietly left out.
              </p>
            </div>
          </div>

          <ul className="budget-loose">
            {budget.unbudgeted.map((line) => (
              <li key={line.categoryId}>
                <Link href={`/transactions?category=${line.categoryId}&period=${active.start}`}>
                  {line.category}
                </Link>
                <span className="num">{money(line.spent)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {budget.exists && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Adjust the budget</h2>
              <p>
                Changes apply from {periodLabel(active.start, active.end)} onwards. Select an
                earlier period above to correct what that period was judged against instead.
              </p>
            </div>
          </div>

          <BudgetEditor
            lines={budget.lines}
            periodStart={active.start}
            periodEnd={active.end}
            suggestions={suggestions}
          />
        </section>
      )}
    </>
  )
}
