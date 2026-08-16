import Link from 'next/link'

import type { CategoryTotal } from '../lib/queries.ts'
import { money } from '../lib/format.ts'

/**
 * Spend by category, with a tick marking that category's own average per
 * period. The bar answers "how much"; the tick answers "is that normal for
 * me", which is the question a bare ranking cannot.
 *
 * Non-consumption categories keep the capital colour so loan and investing are
 * never mistaken for living costs even when they top the list.
 */
export function CategoryBars({
  totals,
  periodStart,
  showAverage = true,
  showCapitalTag = true,
}: {
  totals: CategoryTotal[]
  periodStart: string | null
  showAverage?: boolean
  /** Redundant in a list that is already all capital, and it crowds the name. */
  showCapitalTag?: boolean
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

  const widest = Math.max(...visible.map((t) => Math.max(t.amount, showAverage ? t.averagePerPeriod : 0)))

  return (
    <div>
      {visible.map((total) => {
        const href = total.categoryId
          ? `/transactions?category=${total.categoryId}${periodStart ? `&period=${periodStart}` : ''}`
          : '/transactions?unmatched=1'

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
                  background: total.isConsumption ? 'var(--living)' : 'var(--capital)',
                  opacity: 0.85,
                }}
              />
              {showAverage && total.averagePerPeriod > 0 && (
                <span
                  className="cat-avg"
                  style={{ left: `${Math.min(99.5, (total.averagePerPeriod / widest) * 100)}%` }}
                  title={`Average per period ${money(total.averagePerPeriod)}`}
                />
              )}
            </span>

            <span className="cat-value">{money(total.amount)}</span>
          </Link>
        )
      })}
    </div>
  )
}
