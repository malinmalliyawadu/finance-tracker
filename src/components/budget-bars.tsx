import Link from 'next/link'

import type { BudgetLine } from '../lib/queries.ts'
import { usedShare, verdictFor } from '../lib/budget.ts'
import { money, moneyWhole } from '../lib/format.ts'

/**
 * Each budgeted category as a bar against its own limit.
 *
 * The bar is coloured by the verdict rather than by the category, because the
 * question here is not "where did it go" — the categories page answers that —
 * but "is this one going wrong". While a period is running there is a second
 * mark on the track, at the point the budget has reached by today, so a bar
 * that is two thirds full on day five reads as a problem rather than as
 * progress.
 */

const FILL: Record<string, string> = {
  over: 'var(--alert)',
  ahead: 'var(--warn)',
  'on-track': 'var(--living)',
  under: 'var(--living)',
  unused: 'var(--excluded)',
}

export function BudgetBars({
  lines,
  periodStart,
  partial,
}: {
  lines: BudgetLine[]
  periodStart: string
  /** The period is still running, so pace is worth measuring. */
  partial: boolean
}) {
  return (
    <div>
      {lines.map((line) => {
        const budget = line.budget ?? 0
        const verdict = verdictFor(
          { budget, spent: line.spent, expectedByNow: line.expectedByNow },
          partial,
        )
        const paceLeft = budget > 0 ? Math.min(99.5, (line.expectedByNow / budget) * 100) : 0

        return (
          <Link
            key={line.categoryId}
            href={`/transactions?category=${line.categoryId}&period=${periodStart}`}
            className="budget-row"
          >
            <span className="cat-name">
              <span>{line.category}</span>
              {!line.isConsumption && <span className="tag tag-capital">not spending</span>}
            </span>

            <span className="cat-track">
              <span
                className="cat-fill"
                style={{
                  width: `${usedShare(line.spent, budget) * 100}%`,
                  background: FILL[verdict.tone],
                  opacity: 0.85,
                }}
              />
              {partial && budget > 0 && (
                <span
                  className="cat-avg"
                  style={{ left: `${paceLeft}%` }}
                  title={`${moneyWhole(line.expectedByNow)} by today`}
                />
              )}
            </span>

            <span className="budget-figures">
              <span className="num">{money(line.spent)}</span>
              <small>of {moneyWhole(budget)}</small>
            </span>

            <span className="budget-verdict">
              <span className={`tag ${verdict.tag}`}>{verdict.label}</span>
            </span>
          </Link>
        )
      })}
    </div>
  )
}
