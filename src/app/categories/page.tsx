import { CategoryBars } from '../../components/category-bars.tsx'
import { PeriodPicker } from '../../components/period-picker.tsx'
import { getCategoryTotals, getPeriods } from '../../lib/queries.ts'
import { money, plural } from '../../lib/format.ts'

export const dynamic = 'force-dynamic'

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period } = await searchParams
  const periods = await getPeriods()
  const selected = period === undefined ? (periods[0]?.start ?? null) : period === 'all' ? null : period

  const totals = await getCategoryTotals(selected)
  const consumption = totals.filter((t) => t.isConsumption)
  const capital = totals.filter((t) => !t.isConsumption)

  const livingTotal = consumption.reduce((sum, t) => sum + t.amount, 0)
  const capitalTotal = capital.reduce((sum, t) => sum + t.amount, 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Categories</h1>
          <p>
            Living costs first, then the money that left but was not consumed. Select any category
            to see the transactions behind it.
          </p>
        </div>
        <PeriodPicker periods={periods} selected={selected} basePath="/categories" allowAll />
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Living costs</h2>
            <p>
              {money(livingTotal)} across {plural(consumption.length, 'category', 'categories')}.
            </p>
          </div>
        </div>
        {/* The tick compares a period against a per-period average, so it only
            means something when a single period is in view. */}
        <CategoryBars totals={consumption} periodStart={selected} showAverage={selected !== null} />
      </section>

      {capital.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Not living costs</h2>
              <p>
                {money(capitalTotal)} of investing and personal transfers. Real outflows, but
                saving rather than spending, so they sit outside the headline figure.
              </p>
            </div>
          </div>
          <CategoryBars
            totals={capital}
            periodStart={selected}
            showAverage={selected !== null}
            showCapitalTag={false}
          />
        </section>
      )}
    </>
  )
}
