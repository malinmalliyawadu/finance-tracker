import Link from 'next/link'

import type { CategoryTotal } from '../lib/queries.ts'
import { verdictFor, type BudgetTone } from '../lib/budget.ts'
import { money, moneyWhole } from '../lib/format.ts'

/** What a budgeted category is measured against, keyed by category id. */
export type CategoryLimit = {
  budget: number
  /** What the limit allows by this point in the period. Ignored once closed. */
  expectedByNow: number
}

/**
 * Spend by category, with a mark on each bar for what that spend should be
 * measured against: the budget where one is set, and the category's own average
 * per period where none is. The bar answers "how much"; the mark answers "is
 * that too much", which is the question a bare ranking cannot.
 *
 * Non-consumption categories keep the capital colour so loan and investing are
 * never mistaken for living costs even when they top the list. A budgeted
 * category that has gone wrong overrides that colour, because a bar past its
 * own limit is the one thing on this list worth interrupting the ranking for.
 */
export function CategoryBars({
  totals,
  periodStart,
  showAverage = true,
  showCapitalTag = true,
  limits,
  partial = false,
}: {
  totals: CategoryTotal[]
  periodStart: string | null
  showAverage?: boolean
  /** Redundant in a list that is already all capital, and it crowds the name. */
  showCapitalTag?: boolean
  /** Budgeted categories only. Anything absent falls back to its average. */
  limits?: Map<string, CategoryLimit>
  /** The period is still running, so pace is worth measuring. */
  partial?: boolean
}) {
  const visible = totals.filter((total) => total.amount > 0)
  if (visible.length === 0) {
    return (
      <div className="empty">
        <strong>Nothing to show</strong>
        No categorised spending in this period.
      </div>
    )
  }

  const limitFor = (total: CategoryTotal): CategoryLimit | undefined =>
    total.categoryId ? limits?.get(total.categoryId) : undefined

  // Every mark that gets drawn counts towards the scale, or a limit above the
  // widest bar would sit pinned at the end of its track and read as "nearly
  // there" when the truth is the opposite.
  const widest = Math.max(
    ...visible.map((total) => {
      const limit = limitFor(total)
      if (limit) return Math.max(total.amount, limit.budget)
      return Math.max(total.amount, showAverage ? total.averagePerPeriod : 0)
    }),
  )

  return (
    <div>
      {visible.map((total) => {
        const href = total.categoryId
          ? `/transactions?category=${total.categoryId}${periodStart ? `&period=${periodStart}` : ''}`
          : '/transactions?unmatched=1'

        // The row's own figure is the spend, so the verdict is drawn from it
        // rather than from a second query's idea of the same number.
        const limit = limitFor(total)
        const verdict = limit
          ? verdictFor(
              { budget: limit.budget, spent: total.amount, expectedByNow: limit.expectedByNow },
              partial,
            )
          : undefined

        const base = total.isConsumption ? 'var(--living)' : 'var(--capital)'
        const fill =
          verdict?.tone === 'over'
            ? 'var(--alert)'
            : verdict?.tone === 'ahead'
              ? 'var(--warn)'
              : base

        return (
          <Link key={total.category} href={href} className="cat-row">
            <span className="cat-name">
              <span>{total.category}</span>
              {!total.isConsumption && showCapitalTag && (
                <span className="tag tag-capital">not spending</span>
              )}
            </span>

            <span className="cat-track">
              <span
                className="cat-fill"
                style={{
                  width: `${Math.max(1, (total.amount / widest) * 100)}%`,
                  background: fill,
                  opacity: 0.85,
                }}
              />
              {limit ? (
                <span
                  className="cat-limit"
                  style={{ left: `${Math.min(99.5, (limit.budget / widest) * 100)}%` }}
                  title={
                    partial
                      ? `Budget ${moneyWhole(limit.budget)}, ${moneyWhole(limit.expectedByNow)} of it expected by today`
                      : `Budget ${moneyWhole(limit.budget)}`
                  }
                />
              ) : (
                showAverage &&
                total.averagePerPeriod > 0 && (
                  <span
                    className="cat-avg"
                    style={{ left: `${Math.min(99.5, (total.averagePerPeriod / widest) * 100)}%` }}
                    title={`Average per period ${money(total.averagePerPeriod)}`}
                  />
                )
              )}
            </span>

            <span className="cat-value">
              {money(total.amount)}
              {limit && verdict && (
                <small className={NOTE_TONE[verdict.tone]}>
                  of {moneyWhole(limit.budget)}
                  {NOTE_TONE[verdict.tone] && (
                    <span className="visually-hidden">, {verdict.label}</span>
                  )}
                </small>
              )}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

/**
 * The limit under each figure carries the verdict's colour, so the reading
 * survives on a narrow screen where the track — and with it the bar's colour —
 * is hidden. An empty tone is the ordinary case and gets no emphasis; the two
 * that do also carry the verdict in words for anyone not reading colour.
 */
const NOTE_TONE: Record<BudgetTone, string> = {
  over: 'cat-note-alert',
  ahead: 'cat-note-warn',
  'on-track': '',
  under: '',
  unused: '',
}
