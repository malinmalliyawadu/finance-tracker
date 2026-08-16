import { verdictFor } from '../lib/budget.ts'
import { money, moneyWhole } from '../lib/format.ts'

/**
 * The whole budget as one bar: what has been spent, where the budget expects to
 * be by today, and where this pace lands by the end.
 *
 * The track is scaled to whichever of those three is largest rather than to the
 * budget, so the budget is a mark on the bar rather than the bar itself. A track
 * that ends at the limit can only ever be full, which is exactly the reading a
 * period heading past its budget must not be allowed to give. When nothing
 * exceeds the limit the mark lands on the right-hand edge and the bar reads as
 * an ordinary progress bar again.
 */

const FILL: Record<string, string> = {
  over: 'var(--alert)',
  ahead: 'var(--warn)',
  'on-track': 'var(--living)',
  under: 'var(--living)',
  unused: 'var(--excluded)',
}

export function BudgetTrack({
  total,
  spent,
  expectedByNow,
  projected,
  partial,
  elapsedDays,
}: {
  total: number
  spent: number
  /** What the budget allows by today, shaped by how the categories usually land. */
  expectedByNow: number
  /** Where this pace ends up, or null when it is too early to say. */
  projected: number | null
  partial: boolean
  elapsedDays: number
}) {
  const verdict = verdictFor({ budget: total, spent, expectedByNow }, partial)
  const fill = FILL[verdict.tone] ?? 'var(--living)'

  const ceiling = Math.max(total, spent, projected ?? 0, 1)
  const pct = (value: number) => Math.min(Math.max((value / ceiling) * 100, 0), 100)

  const spentPct = pct(spent)
  // Only ever drawn as the stretch beyond what has actually gone, so a forecast
  // is never mistaken for money already spent.
  const forecastPct = projected !== null && projected > spent ? pct(projected) - spentPct : 0

  return (
    <div className="track">
      <div
        className="track-bar"
        role="img"
        aria-label={`${money(spent)} spent of a ${money(total)} budget${
          partial ? `, with ${money(expectedByNow)} allowed by day ${elapsedDays}` : ''
        }${projected !== null ? `, projected to reach ${money(projected)}` : ''}.`}
      >
        <span className="track-fill" style={{ width: `${spentPct}%`, background: fill }} />

        {forecastPct > 0 && (
          <span
            className="track-forecast"
            style={{ left: `${spentPct}%`, width: `${forecastPct}%`, background: fill }}
          />
        )}

        {partial && expectedByNow > 0 && (
          <span className="track-mark" style={{ left: `${pct(expectedByNow)}%` }} />
        )}

        {/* Always drawn, including when it is the right-hand edge: a track that
            simply stops at the limit leaves the limit to be inferred. */}
        <span className="track-mark track-mark-budget" style={{ left: `${pct(total)}%` }} />
      </div>

      <div className="track-legend">
        <span>
          <span className="track-key" style={{ background: fill }} aria-hidden />
          {moneyWhole(spent)} spent against the budget
        </span>

        {partial && expectedByNow > 0 && (
          <span>
            <span className="track-key-mark" aria-hidden />
            {moneyWhole(expectedByNow)} allowed by day {elapsedDays}
          </span>
        )}

        {forecastPct > 0 && projected !== null && (
          <span>
            <span
              className="track-key track-key-forecast"
              style={{ background: fill }}
              aria-hidden
            />
            {moneyWhole(projected)} on this pace
          </span>
        )}

        <span>
          <span className="track-key-mark track-key-mark-budget" aria-hidden />
          {moneyWhole(total)} budgeted
        </span>
      </div>
    </div>
  )
}
