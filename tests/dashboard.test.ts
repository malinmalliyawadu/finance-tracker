/**
 * The front page's arithmetic and its commentary.
 *
 * These assert against no database at all, which is the point: what the
 * dashboard is willing to say about someone's money is a decision, and a
 * decision belongs in a test rather than in JSX. The thresholds matter as much
 * as the sentences — an insight that fires on every period is not an insight,
 * and one that never fires is a dead branch nobody notices.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { project } from '../src/lib/budget.ts'
import {
  comparisonFor,
  flowsFor,
  forecastFor,
  headlineFor,
  insightsFor,
  pressureFor,
  tapeFor,
  type Reading,
} from '../src/lib/dashboard.ts'
import type { Budget, BudgetLine, Day, Sieve } from '../src/lib/queries.ts'

function line(over: Partial<BudgetLine> & { category: string }): BudgetLine {
  return {
    categoryId: over.category.toLowerCase().replaceAll(' ', '-'),
    isConsumption: true,
    budget: null,
    spent: 0,
    count: 0,
    averagePerPeriod: 0,
    shapeToDate: 1,
    expectedByNow: 0,
    ...over,
  }
}

/** Assembles the totals from the lines exactly as the query does. */
function budgetOf(lines: BudgetLine[]): Budget {
  const budgeted = lines.filter((l) => l.budget !== null)
  const unbudgeted = lines.filter((l) => l.budget === null && l.spent > 0)

  return {
    lines,
    budgeted,
    unbudgeted,
    total: budgeted.reduce((sum, l) => sum + (l.budget ?? 0), 0),
    spent: budgeted.reduce((sum, l) => sum + l.spent, 0),
    unbudgetedSpent: unbudgeted.reduce((sum, l) => sum + l.spent, 0),
    expectedByNow: budgeted.reduce((sum, l) => sum + l.expectedByNow, 0),
    exists: budgeted.length > 0,
  }
}

function sieveOf(
  living: number,
  unclassified = 0,
  flows: { income?: number; putAway?: number } = {},
): Sieve {
  const putAway = flows.putAway ?? 0

  return {
    bands: [
      {
        key: 'non_consumption',
        label: 'Investing and transfers',
        because: 'Real outflows, but saving rather than spending.',
        amount: putAway,
      },
    ],
    totalOut: living + putAway,
    living,
    income: flows.income ?? 0,
    passthroughRetained: 0,
    unclassified,
  }
}

function reading(over: Partial<Reading> = {}): Reading {
  return {
    periodStart: '2026-08-01',
    partial: true,
    elapsedDays: 16,
    totalDays: 31,
    sieve: sieveOf(1000),
    budget: budgetOf([]),
    pace: {
      periods: 6,
      spent: { toDate: 1000, whole: 2000 },
      earned: { toDate: 3000, whole: 6000 },
      putAway: { toDate: 400, whole: 800 },
    },
    wholePeriodAverage: 2000,
    biggest: null,
    ...over,
  }
}

const keys = (r: Reading): string[] => insightsFor(r).map((i) => i.key)

describe('projecting a part-finished period', () => {
  test('a total is scaled by how much of a normal period is behind us', () => {
    assert.equal(project(500, 0.5), 1000)
    assert.equal(project(300, 0.75), 400)
  })

  test('too early in the period is answered with silence, not a wild number', () => {
    // Day two of a month, one insurance premium in. Dividing by 0.05 would
    // forecast twenty times the truth and be drawn as fact.
    assert.equal(project(500, 0.05), null)
    assert.equal(project(500, 0), null)
    assert.equal(project(500, -1), null)
  })

  test('a forecast never lands below what has already gone', () => {
    // Refunds can push the share above where spending actually is.
    assert.equal(project(500, 1), 500)
    assert.equal(project(500, 1.4), 500)
  })

  test('a closed period has nothing left to forecast', () => {
    const closed = forecastFor(reading({ partial: false }))
    assert.deepEqual(closed, { living: null, budget: null })
  })

  test('the budget forecast is shaped per category, not by the calendar', () => {
    // Rent's whole limit has landed by day 16; groceries is a third through.
    // Half the budget is spent, but three quarters of it was due by now, so the
    // period lands under rather than over.
    const budget = budgetOf([
      line({ category: 'Rent', budget: 2000, spent: 2000, expectedByNow: 2000 }),
      line({ category: 'Groceries', budget: 600, spent: 200, expectedByNow: 300 }),
    ])
    const forecast = forecastFor(reading({ budget }))

    assert.ok(forecast.budget !== null)
    assert.ok(
      forecast.budget < budget.total,
      `a straight-line read would call this over; got ${forecast.budget} against ${budget.total}`,
    )
  })
})

describe('the headline', () => {
  test('a part-finished period leads with what is left and where it lands', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 200, expectedByNow: 300 }),
    ])
    const headline = headlineFor(reading({ budget }))

    assert.equal(headline.label, 'Left to spend')
    assert.equal(headline.value, 400)
    assert.equal(headline.tone, 'living')
    assert.match(headline.verdict, /inside the budget/)
  })

  test('being over the limit is never drawn in the reassuring colour', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 900, expectedByNow: 300 }),
    ])
    const headline = headlineFor(reading({ budget }))

    assert.equal(headline.label, 'Over the budget')
    assert.equal(headline.tone, 'alert')
    assert.equal(headline.value, 300, 'the overspend is shown, not a negative remainder')
    assert.equal(headline.verdictTone, 'alert')
  })

  test('heading past the limit is a warning while there is still time to act', () => {
    // Half the budget gone against a quarter of it due: inside the limit today,
    // and nowhere near inside it by the end.
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 300, expectedByNow: 150 }),
    ])
    const headline = headlineFor(reading({ budget }))

    assert.equal(headline.label, 'Left to spend', 'still inside the limit')
    assert.equal(headline.verdictTone, 'warn')
    assert.match(headline.verdict, /ends \$600 over/)
    assert.match(headline.verdict, /a day for the last 15 days/, 'says what to do about it')
  })

  test('too early to forecast says so rather than inventing a number', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 30, expectedByNow: 24 }),
    ])
    const headline = headlineFor(reading({ elapsedDays: 2, budget }))

    assert.equal(headline.verdictTone, 'neutral')
    assert.match(headline.verdict, /Too early to call/)
    assert.match(headline.verdict, /\$24 by day 2/)
  })

  test('with no budget the headline falls back to what has been spent', () => {
    const headline = headlineFor(reading())

    assert.equal(headline.label, 'Spent so far')
    assert.equal(headline.value, 1000)
    assert.equal(headline.href, '/budget')
  })

  test('a closed period reports where it finished, not where it is heading', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 500, expectedByNow: 600 }),
    ])
    const headline = headlineFor(reading({ partial: false, pace: null, budget }))

    assert.equal(headline.label, 'Left in the budget')
    assert.match(headline.verdict, /finished \$100 inside its budget/)
  })

  test('a closed period is compared against whole periods, not against a day', () => {
    const closed = reading({ partial: false, pace: null, sieve: sieveOf(2400) })
    assert.equal(comparisonFor(closed).label, 'vs 12-period average')
    assert.match(headlineFor(closed).verdict, /\$400 above the 12-period average/)
  })

  test('a part-finished period is compared against the same day of prior ones', () => {
    assert.equal(comparisonFor(reading()).label, 'vs average by day 16')
  })
})

describe('money in, spent and put away', () => {
  const flowing = reading({ sieve: sieveOf(1200, 0, { income: 2400, putAway: 500 }) })

  test('all three are read against the same day of prior periods', () => {
    const flows = flowsFor(flowing)

    assert.deepEqual(
      flows.map((f) => [f.key, f.value]),
      [
        ['earned', 2400],
        ['spent', 1200],
        ['putAway', 500],
      ],
    )
    assert.equal(flows[0]!.delta?.direction, 'below', '$2,400 against a usual $3,000 by now')
    assert.equal(flows[1]!.delta?.direction, 'above', '$1,200 against a usual $1,000 by now')
  })

  test('only spending is ever flagged', () => {
    const flows = flowsFor(flowing)

    assert.equal(flows[1]!.delta?.alarming, true, 'spending 20% above usual is worth flagging')
    assert.equal(
      flows[0]!.delta?.alarming,
      false,
      'a quiet fortnight before payday is not bad news',
    )
    assert.equal(flows[2]!.delta?.alarming, false)
  })

  test('a few percent either way is not a signal', () => {
    // One weekly shop landing on the wrong side of today moves a figure by
    // more than this.
    const level = flowsFor(reading({ sieve: sieveOf(1040, 0, { income: 3000 }) }))
    assert.equal(level[1]!.delta?.direction, 'level')
    assert.match(level[1]!.delta!.text, /about usual/)
  })

  test('nothing to compare against is left uncompared, not compared with zero', () => {
    const fresh = flowsFor(reading({ pace: null }))
    assert.deepEqual(
      fresh.map((f) => f.delta),
      [null, null, null],
    )
  })
})

describe('the budgets under pressure', () => {
  test('ranked by how far past its own pace a category is, not by what it costs', () => {
    const budget = budgetOf([
      // The largest line on the page, and behaving perfectly.
      line({ category: 'Mortgage', budget: 3000, spent: 1500, expectedByNow: 1500 }),
      line({ category: 'Eating out', budget: 300, spent: 240, expectedByNow: 150 }),
      line({ category: 'Groceries', budget: 800, spent: 500, expectedByNow: 400 }),
    ])

    assert.deepEqual(
      pressureFor(budget, true).map((row) => row.line.category),
      ['Eating out', 'Groceries'],
      'the mortgage is the biggest number and the one nobody can act on',
    )
  })

  test('past the limit outranks merely running fast', () => {
    const budget = budgetOf([
      // Twice its pace, but still inside the limit.
      line({ category: 'Eating out', budget: 900, spent: 400, expectedByNow: 200 }),
      line({ category: 'Groceries', budget: 400, spent: 420, expectedByNow: 390 }),
    ])

    assert.equal(pressureFor(budget, true)[0]!.line.category, 'Groceries')
  })

  test('a budget behaving itself keeps the list short', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 800, spent: 300, expectedByNow: 400 }),
    ])

    assert.deepEqual(pressureFor(budget, true), [])
  })
})

describe('the period, day by day', () => {
  const days = (spends: number[]): Day[] =>
    spends.map((spent, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, '0')}`,
      day: index + 1,
      spent,
      isWeekend: false,
      isFuture: index >= spends.filter((s) => s >= 0).length,
    }))

  test('what is left is spread over the days that are left, not the whole period', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 3000, spent: 1500, expectedByNow: 1500 }),
    ])
    const tape = tapeFor(reading({ budget }), days([100, 200, 300]))

    assert.equal(tape.daysLeft, 15)
    assert.equal(tape.allowancePerDay, 100, '$1,500 left across the 15 days remaining')
    assert.equal(tape.peak, 300)
  })

  test('an overspent budget leaves no allowance to draw', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 1000, spent: 1200, expectedByNow: 800 }),
    ])
    assert.equal(tapeFor(reading({ budget }), days([100])).allowancePerDay, null)
  })

  test('without a budget there is nothing to divide', () => {
    assert.equal(tapeFor(reading(), days([100])).allowancePerDay, null)
  })
})

describe('the commentary', () => {
  test('an ordinary period on an ordinary budget says so, with its figures', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 280, expectedByNow: 300 }),
    ])
    const insights = insightsFor(reading({ budget }))

    assert.deepEqual(
      insights.map((i) => i.key),
      ['clean'],
    )
    assert.match(insights[0]!.detail, /\$280 spent by day 16/)
    assert.equal(insights[0]!.tone, 'good')
  })

  test('over the budget outranks everything else on the page', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 900, expectedByNow: 300 }),
      line({ category: 'Petrol', budget: 200, spent: 400, expectedByNow: 100 }),
    ])
    const insights = insightsFor(reading({ budget }))

    assert.equal(insights[0]!.key, 'over-budget')
    assert.equal(insights[0]!.tone, 'alert')
    assert.match(insights[0]!.detail, /with 15 days still to go/)
    // The categories responsible follow, worst first.
    assert.deepEqual(insights.slice(1, 3).map((i) => i.key), ['over-groceries', 'over-petrol'])
  })

  test('heading over the limit is said while there is still time to act', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 500, expectedByNow: 300 }),
    ])
    const insights = insightsFor(reading({ budget }))
    const paceOver = insights.find((i) => i.key === 'pace-over')

    assert.ok(paceOver, 'inside the limit today, but not by the end of the period')
    assert.match(paceOver.headline, /^On this pace it ends \$400 over$/)
  })

  test('a category only marginally ahead is not worth a sentence', () => {
    // The budget page already tags this amber. Repeating every amber row here
    // as prose would be a second copy of the same table.
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 6000, spent: 3150, expectedByNow: 3000 }),
    ])
    assert.ok(!keys(reading({ budget })).some((k) => k.startsWith('ahead-')))
  })

  test('a category meaningfully ahead of its own budget is', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 6000, spent: 3900, expectedByNow: 3000 }),
    ])
    const ahead = insightsFor(reading({ budget })).find((i) => i.key === 'ahead-groceries')

    assert.ok(ahead)
    assert.match(ahead.detail, /\$3,900 by day 16, against the \$3,000/)
  })

  test('a category with no limit is measured against its own history instead', () => {
    // The budget page can list this; only here can it be called unusual.
    const budget = budgetOf([
      line({ category: 'Rent', budget: 2000, spent: 2000, expectedByNow: 2000 }),
      line({ category: 'Home', spent: 400, averagePerPeriod: 200, shapeToDate: 0.5 }),
    ])
    const unusual = insightsFor(reading({ budget })).find((i) => i.key === 'unusual-home')

    assert.ok(unusual, '$400 against the $100 it normally reaches by day 16')
    assert.match(unusual.detail, /against the \$100 it normally reaches by now/)
  })

  test('a category with no limit and no history is left alone', () => {
    const budget = budgetOf([
      line({ category: 'Rent', budget: 2000, spent: 2000, expectedByNow: 2000 }),
      line({ category: 'Home', spent: 400, averagePerPeriod: 0, shapeToDate: 0.5 }),
    ])
    assert.ok(!keys(reading({ budget })).some((k) => k.startsWith('unusual-')))
  })

  test('money that reached no category is called missing, not miscategorised', () => {
    const insight = insightsFor(reading({ sieve: sieveOf(1000, 250) })).find(
      (i) => i.key === 'unclassified',
    )

    assert.ok(insight)
    assert.match(insight.detail, /missing from the figures/)
  })

  test('a few dollars uncategorised is noise and stays quiet', () => {
    assert.ok(!keys(reading({ sieve: sieveOf(1000, 20) })).includes('unclassified'))
  })

  test('one purchase big enough to explain the period is named', () => {
    const biggest = {
      amount: 400,
      name: 'Mitre 10',
      date: '2026-08-04',
      category: 'Home & shopping',
      categoryId: 'home',
    }
    const insight = insightsFor(reading({ biggest })).find((i) => i.key === 'biggest')

    assert.ok(insight)
    assert.equal(insight.headline, 'One purchase is 40% of the period')
  })

  test('an ordinary purchase is not', () => {
    const biggest = {
      amount: 60,
      name: 'Mitre 10',
      date: '2026-08-04',
      category: null,
      categoryId: null,
    }
    assert.ok(!keys(reading({ biggest })).includes('biggest'))
  })

  test('a big charge in a category that is always this big is not news', () => {
    // The mortgage interest is the largest line in the ledger every single
    // period. Naming it every single period is a fact, and useless.
    const budget = budgetOf([line({ category: 'Mortgage', averagePerPeriod: 1800, spent: 650 })])
    const biggest = {
      amount: 650,
      name: 'Loan Interest',
      date: '2026-08-05',
      category: 'Mortgage',
      categoryId: 'mortgage',
    }
    assert.ok(!keys(reading({ budget, biggest })).includes('biggest'))
  })

  test('a period with no budget is asked for one by the headline, not twice', () => {
    assert.deepEqual(keys(reading()), [], 'the commentary leaves the ask to the headline')
    assert.equal(headlineFor(reading()).href, '/budget')
  })

  test('the list is capped, so the worst things are the ones that survive', () => {
    const budget = budgetOf([
      line({ category: 'A', budget: 100, spent: 900, expectedByNow: 50 }),
      line({ category: 'B', budget: 100, spent: 800, expectedByNow: 50 }),
      line({ category: 'C', budget: 100, spent: 700, expectedByNow: 50 }),
      line({ category: 'D', spent: 900, averagePerPeriod: 100, shapeToDate: 1 }),
    ])
    const insights = insightsFor(reading({ budget, sieve: sieveOf(3300, 900) }))

    assert.equal(insights.length, 4)
    assert.deepEqual(
      insights.map((i) => i.key),
      ['over-budget', 'over-a', 'over-b', 'unclassified'],
    )
  })

  test('nothing is reported as both fine and over at once', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 900, expectedByNow: 300 }),
    ])
    const found = keys(reading({ budget }))

    assert.ok(found.includes('over-budget'))
    assert.ok(!found.includes('clean'), 'the reassurance and the alarm are mutually exclusive')
  })
})
