import type { DayTape } from '../lib/dashboard.ts'
import { fullDate, money, moneyWhole, shortDate } from '../lib/format.ts'

/**
 * The period as a run of days rather than as a running total.
 *
 * Each day that has happened is a column of what it cost. Each day still to
 * come is an outline at whatever the budget leaves per remaining day - so the
 * days behind and the days ahead are drawn at the same scale, and the question
 * "can I keep doing what I have been doing" is answered by looking at whether
 * the solid columns clear the hollow ones rather than by arithmetic.
 *
 * Weekends are tinted because that is where discretionary spending lands, and a
 * run of tall Saturdays is a different diagnosis from a tall Tuesday.
 */
export function DayTape({ tape, partial }: { tape: DayTape; partial: boolean }) {
  const { days, peak, perDay, allowancePerDay, daysLeft } = tape

  // A period always has days, but a query that returned none would take the
  // labels below down with it, and an empty strip is a better failure than a
  // blank page.
  if (days.length === 0) return null

  // Scaled to whichever is taller so the two kinds of column stay comparable.
  // The floor keeps a period with almost nothing in it from drawing one stray
  // coffee as a full-height spike.
  const ceiling = Math.max(peak, allowancePerDay ?? 0, perDay * 2, 1)
  const height = (value: number) => `${Math.min((value / ceiling) * 100, 100)}%`

  const spentDays = days.filter((day) => !day.isFuture)
  const busiest = spentDays.reduce(
    (worst, day) => (worst === null || day.spent > worst.spent ? day : worst),
    null as (typeof days)[number] | null,
  )

  const description = [
    `${spentDays.length} days of the period so far, ${moneyWhole(perDay)} a day on average.`,
    busiest && busiest.spent > 0
      ? `The most expensive was ${fullDate(busiest.date)} at ${moneyWhole(busiest.spent)}.`
      : null,
    allowancePerDay !== null
      ? `The budget leaves ${moneyWhole(allowancePerDay)} a day for the remaining ${daysLeft}.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="tape">
      <div className="tape-days" role="img" aria-label={description}>
        {days.map((day) => {
          const today = partial && !day.isFuture && day.day === spentDays.length

          return (
            <div
              key={day.date}
              className={[
                'tape-day',
                day.isWeekend ? 'is-weekend' : '',
                day.isFuture ? 'is-future' : '',
                today ? 'is-today' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={
                day.isFuture
                  ? `${fullDate(day.date)} - to come`
                  : `${fullDate(day.date)} - ${money(day.spent)}`
              }
            >
              {day.isFuture ? (
                allowancePerDay !== null && (
                  <span className="tape-allowance" style={{ height: height(allowancePerDay) }} />
                )
              ) : (
                <span className="tape-column" style={{ height: height(day.spent) }} />
              )}
            </div>
          )
        })}
      </div>

      <div className="tape-axis" aria-hidden>
        <span>{shortDate(days[0]!.date)}</span>
        {partial && spentDays.length > 0 && (
          <span
            className="tape-axis-today"
            style={{ left: `${((spentDays.length - 0.5) / days.length) * 100}%` }}
          >
            today
          </span>
        )}
        <span>{shortDate(days[days.length - 1]!.date)}</span>
      </div>

      <p className="tape-key">
        {partial ? (
          <>
            <span className="tape-key-item">
              <span className="tape-swatch" aria-hidden /> what each day cost
            </span>
            {allowancePerDay !== null && (
              <span className="tape-key-item">
                <span className="tape-swatch tape-swatch-allowance" aria-hidden />{' '}
                {moneyWhole(allowancePerDay)} a day for the last {daysLeft}
              </span>
            )}
          </>
        ) : (
          <span className="tape-key-item">
            <span className="tape-swatch" aria-hidden /> what each day cost, averaging{' '}
            {moneyWhole(perDay)}
          </span>
        )}
      </p>
    </div>
  )
}
