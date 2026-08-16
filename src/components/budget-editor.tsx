import { saveBudget, seedBudgetFromAverages } from '../app/actions.ts'
import type { BudgetLine } from '../lib/queries.ts'
import { money, periodLabel } from '../lib/format.ts'

/**
 * The whole budget as one form: every expense category, one number each.
 *
 * One form and one save, rather than a control per row, because a budget is
 * decided in a single sitting — the categories are argued against each other,
 * and saving them one at a time would make the totals meaningless halfway
 * through. It is also plain HTML with no client JavaScript, which is what
 * everything else in this app does.
 *
 * The placeholder in an empty field is what that category has actually been
 * costing. A blank grid of twenty categories is the reason budgets never get
 * written; a grid pre-loaded with the real answer turns it into editing.
 */
export function BudgetEditor({
  lines,
  periodStart,
  periodEnd,
  suggestions,
}: {
  lines: BudgetLine[]
  periodStart: string
  periodEnd: string
  /** Rounded averages, keyed by category, for the placeholders and the fill button. */
  suggestions: Map<string, number>
}) {
  const fillable = lines.filter(
    (line) => line.budget === null && (suggestions.get(line.categoryId) ?? 0) > 0,
  )

  return (
    <form action={saveBudget}>
      <input type="hidden" name="periodStart" value={periodStart} />

      <div className="budget-edit-grid">
        {lines.map((line) => {
          const suggestion = suggestions.get(line.categoryId) ?? 0

          return (
            <label key={line.categoryId} className="budget-edit-row">
              <span className="budget-edit-name">
                <span>{line.category}</span>
                {!line.isConsumption && <span className="tag tag-capital">not spending</span>}
              </span>

              <span className="budget-edit-field">
                <span aria-hidden>$</span>
                <input
                  name={`amount:${line.categoryId}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={line.budget === null ? '' : String(line.budget)}
                  placeholder={suggestion > 0 ? String(suggestion) : '—'}
                  aria-label={`${line.category} budget`}
                />
              </span>

              <span className="budget-edit-hint">
                {suggestion > 0 ? `avg ${money(line.averagePerPeriod)}` : 'no recent spend'}
              </span>
            </label>
          )
        })}
      </div>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <button className="btn" type="submit">
          Save budget
        </button>
        {fillable.length > 0 && (
          <button className="btn btn-quiet" type="submit" formAction={seedBudgetFromAverages}>
            Fill {fillable.length} blank {fillable.length === 1 ? 'category' : 'categories'} from my
            averages
          </button>
        )}
      </div>

      <p className="note" style={{ marginTop: 10 }}>
        Applies from {periodLabel(periodStart, periodEnd)} onwards, and to every period after it
        until it is changed again. Earlier periods keep the figures they were judged against at the
        time. Leave a category blank to leave it out of the budget entirely.
      </p>
    </form>
  )
}
