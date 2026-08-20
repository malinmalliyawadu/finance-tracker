import Link from 'next/link'

import type { Period } from '../lib/queries.ts'
import { monthShort, periodLabel, toDate } from '../lib/format.ts'

/**
 * Statement periods run the 16th to the 15th, not calendar months, so the
 * period is never left implicit — it is named in full above the picker and
 * every chip is labelled by the month it opens in. Pages whose own heading is
 * the period turn that label off rather than print it twice.
 */
export function PeriodPicker({
  periods,
  selected,
  basePath,
  allowAll = false,
  showLabel = true,
}: {
  periods: Period[]
  selected: string | null
  basePath: string
  allowAll?: boolean
  showLabel?: boolean
}) {
  const shown = periods.slice(0, 13).reverse()
  const active = periods.find((p) => p.start === selected)

  return (
    <div className="period-picker">
      {showLabel && (
        <div className="eyebrow" style={{ marginBottom: 6, textAlign: 'right' }}>
          {active ? periodLabel(active.start, active.end) : 'All periods'}
        </div>
      )}
      <div className="periods" role="group" aria-label="Statement period">
        {allowAll && (
          <Link
            href={basePath}
            className="period-chip"
            aria-current={selected === null ? 'true' : undefined}
          >
            All
          </Link>
        )}
        {shown.map((period, i) => (
          <Link
            key={period.start}
            href={`${basePath}?period=${period.start}`}
            className="period-chip"
            aria-current={period.start === selected ? 'true' : undefined}
            title={periodLabel(period.start, period.end)}
          >
            {chipLabel(period, i === 0)}
          </Link>
        ))}
      </div>
    </div>
  )
}

/**
 * A chip is labelled by the month its period opens in. The year is shown only
 * where it changes — on January and on the oldest chip — so a row of thirteen
 * periods reads as a timeline rather than a wall of repeated years, and two
 * Augusts a year apart still cannot be confused.
 */
function chipLabel(period: Period, isOldest: boolean): string {
  const start = toDate(period.start)
  const month = monthShort(start)
  const showYear = isOldest || start.getUTCMonth() === 0
  return showYear ? `${month} ${String(start.getUTCFullYear()).slice(2)}` : month
}
