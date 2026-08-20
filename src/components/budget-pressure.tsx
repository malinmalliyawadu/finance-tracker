import Link from 'next/link'

import { verdictFor } from '../lib/budget.ts'
import type { Pressure } from '../lib/dashboard.ts'
import { money, moneyWhole } from '../lib/format.ts'

const FILL: Record<string, string> = {
  over: 'var(--alert)',
  ahead: 'var(--warn)',
  'on-track': 'var(--living)',
  under: 'var(--living)',
  unused: 'var(--excluded)',
}

/**
 * The budget lines worth doing something about today.
 *
 * Ranked by how far past its own pace a category has run, not by what it costs.
 * Ranking by size would put the mortgage at the top of this list every period,
 * where it would be both the largest number on the page and the one thing
 * nobody can act on.
 *
 * The mark on each bar is where that category's limit expects to be by today,
 * shaped by how it has landed in previous periods - so rent on day one is not
 * a blowout and a grocery shop on day twenty-eight is not a triumph.
 */
export function BudgetPressure({
  rows,
  periodStart,
  partial,
}: {
  rows: Pressure[]
  periodStart: string
  partial: boolean
}) {
  return (
    <ul className="pressure">
      {rows.map(({ line, used, expected }) => {
        const budget = line.budget ?? 0
        const verdict = verdictFor(
          { budget, spent: line.spent, expectedByNow: line.expectedByNow },
          partial,
        )

        return (
          <li key={line.categoryId} className="pressure-row">
            <Link
              href={`/transactions?category=${line.categoryId}&period=${periodStart}`}
              className="pressure-link"
            >
              <span className="pressure-name">
                {line.category}
                {/* Every row in this list is ahead of its pace - that is what
                    the list is - so saying so on each of them is a column of
                    identical labels. Only passing the limit earns a tag. */}
                {verdict.tone === 'over' && (
                  <span className={`tag ${verdict.tag}`}>{verdict.label}</span>
                )}
              </span>

              <span className="pressure-track" aria-hidden>
                <span
                  className="pressure-fill"
                  style={{ width: `${used * 100}%`, background: FILL[verdict.tone] }}
                />
                {partial && expected > 0 && expected < 1 && (
                  <span className="pressure-mark" style={{ left: `${expected * 100}%` }} />
                )}
              </span>

              <span className="pressure-figures num">
                {money(line.spent)}
                <small>of {moneyWhole(budget)}</small>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
