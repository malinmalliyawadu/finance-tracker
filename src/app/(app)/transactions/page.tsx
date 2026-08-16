import { PeriodPicker } from '../../../components/period-picker.tsx'
import { TransactionsTable } from '../../../components/transactions-table.tsx'
import { getCategories, getPeriods, getTransactions } from '../../../lib/queries.ts'
import { money } from '../../../lib/format.ts'

export const dynamic = 'force-dynamic'

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; category?: string; q?: string; unmatched?: string }>
}) {
  const params = await searchParams
  const periods = await getPeriods()
  const selected =
    params.period === undefined
      ? null
      : params.period === 'all'
        ? null
        : params.period

  const [rows, categories] = await Promise.all([
    getTransactions({
      periodStart: selected,
      categoryId: params.category ?? null,
      search: params.q ?? null,
      onlyUnmatched: params.unmatched === '1',
      limit: 400,
    }),
    getCategories(),
  ])

  const activeCategory = categories.find((c) => c.id === params.category)
  const total = rows.filter((r) => r.countsAsSpend).reduce((sum, r) => sum + Math.abs(r.amount), 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Transactions</h1>
          <p>
            Change a category here and it is written as an override — it beats the rules and
            survives every recompute. Edited rows offer “back to the rules” to drop the override
            again.
          </p>
        </div>
        <PeriodPicker periods={periods} selected={selected} basePath="/transactions" allowAll />
      </div>

      <form className="toolbar">
        {selected && <input type="hidden" name="period" value={selected} />}
        {params.category && <input type="hidden" name="category" value={params.category} />}
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={params.q ?? ''} placeholder="Merchant or descriptor" />
        </div>
        <button className="btn" type="submit">
          Search
        </button>
        {(params.q || params.category || params.unmatched) && (
          <a className="btn btn-quiet" href="/transactions">
            Clear
          </a>
        )}
        <a
          className="btn btn-quiet"
          href={`/transactions?unmatched=1${selected ? `&period=${selected}` : ''}`}
        >
          Uncategorised only
        </a>

        <span className="note" style={{ marginLeft: 'auto' }}>
          {rows.length} shown{activeCategory ? ` in ${activeCategory.name}` : ''} ·{' '}
          {money(total)} of spending among them
        </span>
      </form>

      <TransactionsTable rows={rows} categories={categories} />
    </>
  )
}
