/**
 * What the dashboard says, as opposed to what it draws.
 *
 * Every figure and every sentence on the front page is decided here, from data
 * the page has already fetched. Pure and type-only in its imports, so it stays
 * out of the server/client argument entirely and can be tested without a
 * database — which matters more for the commentary than for the numbers. A
 * sentence that says "running ahead" is an assertion about someone's money, and
 * the conditions under which it appears deserve to be pinned down in a test
 * rather than buried in JSX.
 */

import type { BiggestPurchase, Budget, BudgetLine, PaceComparison, Sieve } from './queries.ts'
import { project } from './budget.ts'
// Whole dollars throughout: this is prose, and cents in a sentence read as
// precision that the claim around them does not have.
import { moneyWhole, plural, shortDate } from './format.ts'

export type Reading = {
  periodStart: string
  /** The period is still running, so pace and forecasts mean something. */
  partial: boolean
  elapsedDays: number
  totalDays: number
  sieve: Sieve
  budget: Budget
  /** Null once the period has closed: there is nothing left to forecast. */
  pace: PaceComparison | null
  /** Whole-period living costs, averaged over the other closed periods. */
  wholePeriodAverage: number
  biggest: BiggestPurchase | null
}

// ---------------------------------------------------------------------------
// Comparison and forecast
// ---------------------------------------------------------------------------

export type Comparison = {
  average: number
  /** Names what the average is of, since it differs for a part-finished period. */
  label: string
}

/**
 * What this period's living costs are measured against.
 *
 * A part-finished period is compared with the same point in prior periods; a
 * closed one with whole prior periods. Comparing a part-finished period against
 * whole-period averages is the trap this whole app exists to avoid: on day
 * three it would report spending down 90% and mean nothing.
 */
export function comparisonFor(reading: Reading): Comparison {
  if (reading.partial && reading.pace) {
    return { average: reading.pace.average, label: `vs average by day ${reading.elapsedDays}` }
  }
  return { average: reading.wholePeriodAverage, label: 'vs 12-period average' }
}

export type Forecast = {
  /** Living costs where this period lands, or null when it is too early to say. */
  living: number | null
  /** The same for spending against the budget. */
  budget: number | null
}

/**
 * Where the period ends up if the rest of it behaves like the ones before it.
 *
 * The two forecasts take their share of the period from different places on
 * purpose. Living costs use the pace query, which measures the whole
 * consumption total against itself. The budget uses its own expected-to-date
 * over its own total, which is the per-category day-shaping already computed
 * for every bar on the budget page, weighted by each category's limit. Both are
 * history-shaped rather than pro-rated, so neither reports the first of the
 * month as a catastrophe.
 */
export function forecastFor(reading: Reading): Forecast {
  if (!reading.partial) return { living: null, budget: null }

  const { pace, budget, sieve } = reading
  const livingShare = pace && pace.wholeAverage > 0 ? pace.average / pace.wholeAverage : 0
  const budgetShare = budget.total > 0 ? budget.expectedByNow / budget.total : 0

  return {
    living: project(sieve.living, livingShare),
    budget: project(budget.spent, budgetShare),
  }
}

// ---------------------------------------------------------------------------
// Headline numbers
// ---------------------------------------------------------------------------

export type Tile = {
  key: string
  label: string
  value: number
  tone: 'living' | 'alert' | 'neutral'
  /** Sits under the value: what it is measured against. */
  note: string
  /** An arrow and a phrase, where there is a comparison worth colouring. */
  delta?: { over: boolean; text: string }
}

/**
 * The three numbers the page opens with: what has been spent, what the budget
 * has left, and where the period is heading.
 *
 * Only three, and never the same figure twice. A row of tiles that restates the
 * detail below it teaches someone to stop reading the detail.
 */
export function headlineTiles(reading: Reading): Tile[] {
  const { budget, sieve, partial, elapsedDays, totalDays } = reading
  const comparison = comparisonFor(reading)
  const forecast = forecastFor(reading)

  const living: Tile = {
    key: 'living',
    label: partial ? 'Living costs so far' : 'Living costs',
    value: sieve.living,
    tone: 'living',
    note: partial ? `Day ${elapsedDays} of ${totalDays}` : 'The period in full',
    delta:
      comparison.average > 0
        ? {
            over: sieve.living > comparison.average,
            text: `${Math.abs((sieve.living / comparison.average - 1) * 100).toFixed(0)}% ${comparison.label}`,
          }
        : undefined,
  }

  if (!budget.exists) return [living]

  const remaining = budget.total - budget.spent
  const over = remaining < 0
  const categories = plural(budget.budgeted.length, 'category', 'categories')

  if (!partial) {
    return [
      living,
      {
        key: 'standing',
        label: over ? 'Over the budget by' : 'Under the budget by',
        value: Math.abs(remaining),
        tone: over ? 'alert' : 'living',
        note: `${categories} budgeted`,
      },
      {
        key: 'spent',
        label: 'Spent against it',
        value: budget.spent,
        tone: 'neutral',
        note: `of ${moneyWhole(budget.total)}`,
      },
    ]
  }

  const standing: Tile = {
    key: 'remaining',
    label: over ? 'Over the budget' : 'Left in the budget',
    value: Math.abs(remaining),
    tone: over ? 'alert' : 'living',
    note: `of ${moneyWhole(budget.total)} across ${categories}`,
  }

  // Too early to extrapolate from. Saying what the budget allows by today is
  // the honest thing left to say, and it is the figure the pace marks are
  // drawn from anyway.
  if (forecast.budget === null) {
    return [
      living,
      standing,
      {
        key: 'expected',
        label: 'Expected by now',
        value: budget.expectedByNow,
        tone: 'neutral',
        note: `what the budget allows by day ${elapsedDays}`,
      },
    ]
  }

  const gap = forecast.budget - budget.total

  return [
    living,
    standing,
    {
      key: 'pace',
      label: 'On this pace',
      value: forecast.budget,
      tone: gap > 0 ? 'alert' : 'living',
      note: 'if the rest of the period runs like recent ones',
      delta: {
        over: gap > 0,
        text: gap > 0
          ? `${moneyWhole(gap)} past the budget`
          : `${moneyWhole(-gap)} inside the budget`,
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Commentary
// ---------------------------------------------------------------------------

export type Insight = {
  key: string
  tone: 'alert' | 'warn' | 'good' | 'neutral'
  /** The claim, in a few words. */
  headline: string
  /** The figures it rests on, so the claim can be checked rather than believed. */
  detail: string
  href?: string
  /** Higher sorts first. Never shown. */
  weight: number
}

/** Four is what fits above the fold, and a list nobody finishes says nothing. */
const MAX_INSIGHTS = 4

/**
 * A category has to be meaningfully ahead, not marginally ahead, to be worth a
 * sentence. The budget page already tags anything past 1.05 amber; repeating
 * every amber row here as prose would be a second copy of the same table.
 */
const AHEAD_RATIO = 1.25
const AHEAD_FLOOR = 75

/** Above its own history by half again, and by enough money to act on. */
const UNUSUAL_RATIO = 1.5
const UNUSUAL_FLOOR = 100

/** One purchase this big stops being a category and becomes the story. */
const DOMINANT_SHARE = 0.15

const overshoot = (line: BudgetLine): number => line.spent - (line.budget ?? 0)

/** Where a category normally stands by this point, from its own recent periods. */
const usualByNow = (line: BudgetLine): number => line.averagePerPeriod * line.shapeToDate

/**
 * The commentary: what is worth saying about this period that the numbers do
 * not say by themselves.
 *
 * Everything here is a claim with its own arithmetic attached, and everything
 * has a threshold under which it stays quiet. A dashboard that always has four
 * things to tell you has nothing to tell you.
 */
export function insightsFor(reading: Reading): Insight[] {
  const { budget, sieve, partial, elapsedDays, totalDays, periodStart, biggest } = reading
  const forecast = forecastFor(reading)
  const found: Insight[] = []

  const daysLeft = Math.max(totalDays - elapsedDays, 0)
  const remaining = budget.total - budget.spent
  const categoryHref = (id: string) => `/transactions?category=${id}&period=${periodStart}`

  if (!budget.exists) {
    found.push({
      key: 'no-budget',
      tone: 'neutral',
      weight: 95,
      headline: 'No budget for this period',
      detail:
        'With a limit per category this page can say whether a figure is a problem, rather than only what it is. Every box starts pre-filled with what the category has actually been costing.',
      href: '/budget',
    })
  }

  if (budget.exists && remaining < 0) {
    found.push({
      key: 'over-budget',
      tone: 'alert',
      weight: 100,
      headline: `Over the budget by ${moneyWhole(-remaining)}`,
      detail: partial
        ? `${moneyWhole(budget.spent)} spent of ${moneyWhole(budget.total)}, with ${plural(daysLeft, 'day')} still to go.`
        : `${moneyWhole(budget.spent)} spent of ${moneyWhole(budget.total)}.`,
      href: '/budget',
    })
  }

  // Inside the limit today and heading past it. The only warning on this page
  // that arrives while there is still a period left in which to act on it.
  if (budget.exists && partial && remaining >= 0 && forecast.budget !== null && forecast.budget > budget.total) {
    found.push({
      key: 'pace-over',
      tone: 'warn',
      weight: 90,
      headline: `On this pace it ends ${moneyWhole(forecast.budget - budget.total)} over`,
      detail: `Inside the limit today, but ${moneyWhole(budget.spent)} by day ${elapsedDays} lands around ${moneyWhole(forecast.budget)} against a ${moneyWhole(budget.total)} budget.`,
      href: '/budget',
    })
  }

  const overspent = budget.budgeted
    .filter((line) => overshoot(line) > 0)
    .sort((a, b) => overshoot(b) - overshoot(a))

  for (const [index, line] of overspent.slice(0, 2).entries()) {
    found.push({
      key: `over-${line.categoryId}`,
      tone: 'alert',
      weight: 80 - index,
      headline: `${line.category} is ${moneyWhole(overshoot(line))} past its limit`,
      detail: `${moneyWhole(line.spent)} against ${moneyWhole(line.budget ?? 0)}${
        partial ? `, with ${plural(daysLeft, 'day')} left` : ''
      }.`,
      href: categoryHref(line.categoryId),
    })
  }

  // Not counted anywhere above: without a category it is neither living costs
  // nor an exclusion, so it is missing from the totals rather than misfiled
  // inside them.
  if (sieve.unclassified >= 50 && sieve.unclassified > sieve.living * 0.01) {
    found.push({
      key: 'unclassified',
      tone: 'warn',
      weight: 75,
      headline: `${moneyWhole(sieve.unclassified)} has not been categorised`,
      detail:
        'It left the account without landing in any category, so it is missing from the figures on this page rather than filed under the wrong one.',
      href: '/transactions?unmatched=1',
    })
  }

  const ahead = partial
    ? budget.budgeted
        .filter(
          (line) =>
            overshoot(line) <= 0 &&
            line.spent > line.expectedByNow * AHEAD_RATIO &&
            line.spent - line.expectedByNow >= AHEAD_FLOOR,
        )
        .sort((a, b) => b.spent - b.expectedByNow - (a.spent - a.expectedByNow))
    : []

  for (const [index, line] of ahead.slice(0, 2).entries()) {
    found.push({
      key: `ahead-${line.categoryId}`,
      tone: 'warn',
      weight: 65 - index,
      headline: `${line.category} is running ahead of its budget`,
      detail: `${moneyWhole(line.spent)} by day ${elapsedDays}, against the ${moneyWhole(line.expectedByNow)} its ${moneyWhole(line.budget ?? 0)} limit allows by now.`,
      href: categoryHref(line.categoryId),
    })
  }

  // A category with no limit still has a history, and this is the only place
  // one gets measured against it. The budget page lists them; it cannot say
  // which of them is behaving oddly.
  const unusual = budget.unbudgeted
    .filter(
      (line) =>
        usualByNow(line) > 0 &&
        line.spent > usualByNow(line) * UNUSUAL_RATIO &&
        line.spent - usualByNow(line) >= UNUSUAL_FLOOR,
    )
    .sort((a, b) => b.spent - usualByNow(b) - (a.spent - usualByNow(a)))

  const worst = unusual[0]
  if (worst) {
    found.push({
      key: `unusual-${worst.categoryId}`,
      tone: 'warn',
      weight: 60,
      headline: `${worst.category} is well above its usual, with no limit set`,
      detail: partial
        ? `${moneyWhole(worst.spent)} by day ${elapsedDays}, against the ${moneyWhole(usualByNow(worst))} it normally reaches by now.`
        : `${moneyWhole(worst.spent)} against a usual ${moneyWhole(usualByNow(worst))} per period.`,
      href: categoryHref(worst.categoryId),
    })
  }

  if (
    budget.exists &&
    budget.unbudgetedSpent >= 100 &&
    budget.unbudgetedSpent > budget.total * 0.05
  ) {
    found.push({
      key: 'unbudgeted',
      tone: 'neutral',
      weight: 50,
      headline: `${moneyWhole(budget.unbudgetedSpent)} sits outside the budget`,
      detail: `${plural(budget.unbudgeted.length, 'category', 'categories')} with no limit set. A budget that covers most of the spending and none of the surprises is the usual way one turns out to be wrong.`,
      href: '/budget',
    })
  }

  // Large is not the same as remarkable. The mortgage interest is reliably the
  // biggest line in the ledger and reliably the least interesting, so an item
  // also has to cost more on its own than its whole category usually costs in a
  // period before it is worth pointing at.
  const routine = biggest?.categoryId
    ? (budget.lines.find((line) => line.categoryId === biggest.categoryId)?.averagePerPeriod ?? 0)
    : 0

  if (
    biggest &&
    sieve.living > 0 &&
    biggest.amount >= sieve.living * DOMINANT_SHARE &&
    biggest.amount > routine
  ) {
    found.push({
      key: 'biggest',
      tone: 'neutral',
      weight: 40,
      headline: `One purchase is ${Math.round((biggest.amount / sieve.living) * 100)}% of the period`,
      detail: `${moneyWhole(biggest.amount)} at ${biggest.name} on ${shortDate(biggest.date)}${
        biggest.category ? `, more than ${biggest.category} usually costs in a whole period` : ''
      }.`,
      href: '/large',
    })
  }

  // Good news, but only the kind that carries its own evidence. "All good" on
  // its own is the sort of reassurance that stops being read.
  if (
    budget.exists &&
    partial &&
    overspent.length === 0 &&
    ahead.length === 0 &&
    (forecast.budget === null || forecast.budget <= budget.total)
  ) {
    found.push({
      key: 'clean',
      tone: 'good',
      weight: 20,
      headline: 'Nothing is running over',
      detail: `${moneyWhole(budget.spent)} spent by day ${elapsedDays}, against the ${moneyWhole(budget.expectedByNow)} the budget allows by now. Every category is inside its limit and on its usual pace.`,
    })
  }

  return found.sort((a, b) => b.weight - a.weight).slice(0, MAX_INSIGHTS)
}
