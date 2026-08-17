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
  forecastFor,
  headlineTiles,
  insightsFor,
  investedShare,
  investedShareAcross,
  type Reading,
} from '../src/lib/dashboard.ts'
import type { Budget, BudgetLine, Sieve, TrendPoint } from '../src/lib/queries.ts'

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

function sieveOf(living: number, unclassified = 0): Sieve {
  return {
    bands: [],
    totalOut: living,
    living,
    income: 0,
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
    pace: { average: 1000, wholeAverage: 2000, periods: 6 },
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

describe('the headline tiles', () => {
  test('a part-finished period leads with what is left and where it lands', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 200, expectedByNow: 300 }),
    ])
    const tiles = headlineTiles(reading({ budget }))

    assert.deepEqual(
      tiles.map((t) => t.key),
      ['living', 'remaining', 'pace'],
    )
    assert.equal(tiles[1]!.label, 'Left in the budget')
    assert.equal(tiles[1]!.value, 400)
  })

  test('being over the limit is never drawn in the reassuring colour', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 900, expectedByNow: 300 }),
    ])
    const tiles = headlineTiles(reading({ budget }))

    assert.equal(tiles[1]!.label, 'Over the budget')
    assert.equal(tiles[1]!.tone, 'alert')
    assert.equal(tiles[1]!.value, 300, 'the overspend is shown, not a negative remainder')
  })

  test('too early to forecast falls back to what the budget allows by today', () => {
    const budget = budgetOf([
      line({ category: 'Groceries', budget: 600, spent: 30, expectedByNow: 24 }),
    ])
    const tiles = headlineTiles(reading({ elapsedDays: 2, budget }))

    assert.equal(tiles[2]!.key, 'expected')
    assert.equal(tiles[2]!.value, 24)
  })

  test('no budget leaves the one figure that does not depend on having one', () => {
    assert.deepEqual(
      headlineTiles(reading()).map((t) => t.key),
      ['living'],
    )
  })

  test('a closed period is compared against whole periods, not against a day', () => {
    const closed = reading({ partial: false, pace: null, sieve: sieveOf(2400) })
    assert.equal(comparisonFor(closed).label, 'vs 12-period average')

    const tile = headlineTiles(closed)[0]!
    assert.equal(tile.delta?.over, true)
    assert.equal(tile.delta?.text, '20% vs 12-period average')
  })

  test('a part-finished period is compared against the same day of prior ones', () => {
    assert.equal(comparisonFor(reading()).label, 'vs average by day 16')
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

  test('a period with no budget is asked for one exactly once', () => {
    assert.deepEqual(keys(reading()), ['no-budget'])
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

describe('the share put away rather than spent', () => {
  const point = (living: number, nonConsumption: number): TrendPoint => ({
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    living,
    nonConsumption,
    income: 0,
  })

  test('a period is measured against everything that went out, not against income', () => {
    assert.equal(investedShare(point(7500, 2500)), 0.25)
    assert.equal(investedShare(point(3000, 1000)), 0.25)
  })

  test('the share put away and the share spent meet at the whole', () => {
    const share = investedShare(point(4000, 1000))!
    assert.equal(share + (1 - share), 1)
  })

  test('a period that put nothing away is left unlabelled, not labelled zero', () => {
    assert.equal(investedShare(point(4000, 0)), null)
    // A period with nothing in it at all, which the current one is on day one.
    assert.equal(investedShare(point(0, 0)), null)
  })

  test('the summary weighs periods by their size, not one vote each', () => {
    // A big month at 10% and a small one at 50% is not a 30% habit.
    const across = investedShareAcross([point(9000, 1000), point(500, 500)])!
    assert.equal(Math.round(across * 100), 14)
  })

  test('nothing put away across the whole run says nothing', () => {
    assert.equal(investedShareAcross([point(4000, 0), point(3000, 0)]), null)
    assert.equal(investedShareAcross([]), null)
  })
})
