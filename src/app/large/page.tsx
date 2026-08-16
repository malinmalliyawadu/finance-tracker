import { PeriodPicker } from '../../components/period-picker.tsx'
import { TransactionsTable } from '../../components/transactions-table.tsx'
import { getCategories, getLargePurchases, getPeriods, getSettings } from '../../lib/queries.ts'
import { money, moneyWhole, plural } from '../../lib/format.ts'
import { setThreshold } from '../actions.ts'

export const dynamic = 'force-dynamic'

export default async function LargePurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period } = await searchParams
  const [periods, settings, categories] = await Promise.all([
    getPeriods(),
    getSettings(),
    getCategories(),
  ])

  // Defaults to every period: the point of this page is that a handful of
  // decisions across a year explain a quarter of the spending, which one
  // period at a time cannot show.
  const selected = period === undefined || period === 'all' ? null : period
  const { rows, total, shareOfLiving } = await getLargePurchases(
    settings.largePurchaseThreshold,
    selected,
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Large purchases</h1>
          <p>
            Everything over {moneyWhole(settings.largePurchaseThreshold)}. These are decisions
            rather than habits, and averaging them into a monthly figure hides them.
          </p>
        </div>
        <PeriodPicker periods={periods} selected={selected} basePath="/large" allowAll />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="eyebrow">Total</div>
          <div className="headline-value" style={{ marginTop: 4 }}>
            {moneyWhole(total)}
          </div>
          <p className="note" style={{ marginTop: 8 }}>
            {plural(rows.length, 'purchase')} over {moneyWhole(settings.largePurchaseThreshold)},
            making up <strong>{(shareOfLiving * 100).toFixed(0)}%</strong> of living costs
            {selected ? ' this period' : ' across every period'}.
          </p>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Threshold</h2>
              <p>What counts as large enough to be worth seeing on its own.</p>
            </div>
          </div>
          <form action={setThreshold} className="toolbar">
            <div className="field">
              <label htmlFor="threshold">NZ$</label>
              <input
                id="threshold"
                name="threshold"
                type="number"
                min="1"
                step="10"
                defaultValue={settings.largePurchaseThreshold}
                style={{ width: 110 }}
              />
            </div>
            <button className="btn" type="submit">
              Save threshold
            </button>
          </form>
        </section>
      </div>

      <TransactionsTable rows={rows} categories={categories} />
    </>
  )
}
