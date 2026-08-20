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

import type { BiggestPurchase, Budget, BudgetLine, Day, FlowPace, Sieve } from './queries.ts'
import { project, usedShare } from './budget.ts'
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
  pace: FlowPace | null
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
    return { average: reading.pace.spent.toDate, label: `vs average by day ${reading.elapsedDays}` }
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
  const livingShare = pace && pace.spent.whole > 0 ? pace.spent.toDate / pace.spent.whole : 0
  const budgetShare = budget.total > 0 ? budget.expectedByNow / budget.total : 0

  return {
    living: project(sieve.living, livingShare),
    budget: project(budget.spent, budgetShare),
  }
}

// ---------------------------------------------------------------------------
// The headline
// ---------------------------------------------------------------------------

export type Headline = {
  /** What the big figure is. */
  label: string
  value: number
  tone: 'living' | 'alert' | 'neutral'
  /** Immediately under the figure: what it is a part of. */
  sub: string
  /** The one sentence the page exists to say. */
  verdict: string
  verdictTone: 'living' | 'warn' | 'alert' | 'neutral'
  /** Where the sentence leads, when there is somewhere to go. */
  href?: string
}

/**
 * The single figure the page opens with, and the sentence that reads it.
 *
 * There is exactly one, and it is always the answer to the question someone
 * opens this page holding: how much can I still spend? A row of tiles asking to
 * be compared is what the rest of the page is for. Without a budget there is no
 * such figure, so the headline falls back to what has been spent and says
 * plainly that the question cannot be answered yet.
 */
export function headlineFor(reading: Reading): Headline {
  const { budget, sieve, partial, elapsedDays, totalDays } = reading
  const comparison = comparisonFor(reading)
  const forecast = forecastFor(reading)
  const daysLeft = Math.max(totalDays - elapsedDays, 0)

  if (!budget.exists) {
    const against =
      comparison.average > 0
        ? `${moneyWhole(Math.abs(sieve.living - comparison.average))} ${
            sieve.living > comparison.average ? 'above' : 'below'
          } ${comparison.label.replace('vs ', 'the ')}`
        : 'the first period there is'

    return {
      label: partial ? 'Spent so far' : 'Spent this period',
      value: sieve.living,
      tone: 'neutral',
      sub: partial ? `day ${elapsedDays} of ${totalDays}` : 'the period in full',
      verdict: `That is ${against} - which is all this page can say about a figure with no limit to measure it against.`,
      verdictTone: 'neutral',
      href: '/budget',
    }
  }

  const remaining = budget.total - budget.spent
  const over = remaining < 0

  if (!partial) {
    return {
      label: over ? 'Over the budget' : 'Left in the budget',
      value: Math.abs(remaining),
      tone: over ? 'alert' : 'living',
      sub: `${moneyWhole(budget.spent)} used of a ${moneyWhole(budget.total)} budget`,
      verdict: over
        ? `This period finished ${moneyWhole(-remaining)} past its budget.`
        : `This period finished ${moneyWhole(remaining)} inside its budget.`,
      verdictTone: over ? 'alert' : 'living',
      href: `/budget?period=${reading.periodStart}`,
    }
  }

  const verdict = ((): { text: string; tone: Headline['verdictTone'] } => {
    if (over) {
      return {
        text: `Already ${moneyWhole(-remaining)} past the budget with ${plural(daysLeft, 'day')} still to go.`,
        tone: 'alert',
      }
    }

    if (forecast.budget === null) {
      return {
        text: `Too early to call. The budget allows ${moneyWhole(budget.expectedByNow)} by day ${elapsedDays}, and ${moneyWhole(budget.spent)} has gone.`,
        tone: 'neutral',
      }
    }

    const gap = forecast.budget - budget.total

    if (gap > 0) {
      return {
        text: `On this pace the period ends ${moneyWhole(gap)} over. Holding to ${moneyWhole(remaining / Math.max(daysLeft, 1))} a day for the last ${plural(daysLeft, 'day')} keeps it inside.`,
        tone: 'warn',
      }
    }

    return {
      text: `On this pace the period ends ${moneyWhole(-gap)} inside the budget, with ${plural(daysLeft, 'day')} to go.`,
      tone: 'living',
    }
  })()

  return {
    label: over ? 'Over the budget' : 'Left to spend',
    value: Math.abs(remaining),
    tone: over ? 'alert' : 'living',
    sub: `${moneyWhole(budget.spent)} used of a ${moneyWhole(budget.total)} budget`,
    verdict: verdict.text,
    verdictTone: verdict.tone,
    href: `/budget?period=${reading.periodStart}`,
  }
}

// ---------------------------------------------------------------------------
// Money in, money spent, money put away
// ---------------------------------------------------------------------------

/**
 * Under this, a flow is doing what it always does. Pay lands a day early, one
 * weekly shop falls on the wrong side of today, and a figure moves by a few
 * percent for no reason worth reading into.
 */
const LEVEL = 0.08

export type Flow = {
  key: 'earned' | 'spent' | 'putAway'
  label: string
  value: number
  tone: 'income' | 'living' | 'capital'
  /** What it is measured against, in words. */
  note: string
  /**
   * How it sits against its own history. Null when there is no history, or when
   * the usual figure is too small to take a ratio of.
   */
  delta: {
    direction: 'above' | 'below' | 'level'
    text: string
    /**
     * Whether the direction is worth flagging. Only spending is ever flagged:
     * a page that colours a quiet month's earnings red is moralising, not
     * reporting.
     */
    alarming: boolean
  } | null
}

function deltaAgainst(value: number, usual: number, flag: 'above' | null): Flow['delta'] {
  if (!(usual > 0)) return null

  const ratio = value / usual - 1
  if (Math.abs(ratio) < LEVEL) {
    return { direction: 'level', text: `about usual (${moneyWhole(usual)})`, alarming: false }
  }

  const direction = ratio > 0 ? 'above' : 'below'
  return {
    direction,
    text: `${Math.abs(ratio * 100).toFixed(0)}% ${direction} the usual ${moneyWhole(usual)}`,
    alarming: flag === direction,
  }
}

/**
 * The three flows of a period: what came in, what was spent, and what was put
 * away - each against what it usually is by this point.
 *
 * They are shown together because they are one movement of money rather than
 * three statistics, and separately from the budget because the budget is a
 * decision and these are facts. Every comparison is against the same day of
 * prior periods, which matters most for income: pay arrives in one or two lumps
 * near the end of a period, so on day twenty "earned" is not a small number,
 * it is a number that has not happened yet.
 */
export function flowsFor(reading: Reading): Flow[] {
  const { sieve, budget, partial, elapsedDays, pace } = reading
  // A closed period compares against whole prior periods, which is what the
  // same query returns once the day it is asked about is the last one.
  const against = partial ? `by day ${elapsedDays}` : 'over the period'

  const putAway = sieve.bands.find((band) => band.key === 'non_consumption')?.amount ?? 0

  return [
    {
      key: 'earned',
      label: 'Earned',
      value: sieve.income,
      tone: 'income',
      note: `what landed ${against}`,
      delta: deltaAgainst(sieve.income, pace?.earned.toDate ?? 0, null),
    },
    {
      key: 'spent',
      label: 'Spent',
      value: sieve.living,
      tone: 'living',
      // Never "of the budget": the budget covers what is put away as well, so
      // the figure above is not a part of it and saying so would invite a
      // subtraction that does not work.
      note: `living costs ${against}`,
      delta: deltaAgainst(sieve.living, pace?.spent.toDate ?? 0, 'above'),
    },
    {
      key: 'putAway',
      label: 'Put away',
      value: putAway,
      tone: 'capital',
      note: 'investing, savings and loan principal',
      delta: deltaAgainst(putAway, pace?.putAway.toDate ?? 0, null),
    },
  ]
}

// ---------------------------------------------------------------------------
// Categories under pressure
// ---------------------------------------------------------------------------

export type Pressure = {
  line: BudgetLine
  /** How full the limit is, for drawing. */
  used: number
  /** Where the limit expects to be by today, for the mark on the bar. */
  expected: number
  /** Sorts the list. Never shown. */
  rank: number
}

/**
 * The budget lines worth looking at today, worst first.
 *
 * Ranked by how far past its own pace a category is rather than by how much it
 * costs, because the largest line in a budget is the mortgage and it is never
 * the problem. A category exactly on its pace ranks at zero, so the list runs
 * out naturally: once everything is behaving, there is nothing at the top of it
 * clamouring to be read.
 */
export function pressureFor(budget: Budget, partial: boolean, limit = 5): Pressure[] {
  return budget.budgeted
    .map((line) => {
      const budgeted = line.budget ?? 0
      const expected = partial ? line.expectedByNow : budgeted
      const past = budgeted > 0 ? Math.max(line.spent - budgeted, 0) / budgeted : 0
      const ahead = expected > 0 ? Math.max(line.spent - expected, 0) / expected : 0

      return {
        line,
        used: usedShare(line.spent, budgeted),
        expected: budgeted > 0 ? Math.min(expected / budgeted, 1) : 0,
        // Anything already past its limit sorts above everything still inside
        // one, however fast the rest are moving: an overspend has happened and
        // a pace is a forecast. Within each group the ranking is relative, so a
        // small category blowing its limit is not buried under a large one
        // drifting a percent.
        rank: (past > 0 ? 10 + past : 0) + ahead,
      }
    })
    .filter((row) => row.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// The period, day by day
// ---------------------------------------------------------------------------

export type DayTape = {
  days: Day[]
  /** The tallest day, which every column is drawn against. */
  peak: number
  /** What a day has cost on average so far, and the line drawn across the tape. */
  perDay: number
  /** What is left to spend per remaining day, or null without a budget to divide. */
  allowancePerDay: number | null
  daysLeft: number
}

/**
 * The period as a run of days rather than a running total.
 *
 * A total answers "how much" and hides "when", and the two are different
 * questions: thirty even days and one $900 Saturday add to the same figure and
 * mean nothing alike. The days are also the only part of this page that shows
 * yesterday, which is the thing someone checking daily actually came for.
 */
export function tapeFor(reading: Reading, days: Day[]): DayTape {
  const { budget, elapsedDays, totalDays, sieve } = reading
  const daysLeft = Math.max(totalDays - elapsedDays, 0)
  const remaining = budget.total - budget.spent

  return {
    days,
    peak: days.reduce((max, day) => Math.max(max, day.spent), 0),
    perDay: elapsedDays > 0 ? sieve.living / elapsedDays : 0,
    allowancePerDay:
      budget.exists && daysLeft > 0 && remaining > 0 ? remaining / daysLeft : null,
    daysLeft,
  }
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

  // Nothing here asks for a budget. The headline already does, in the largest
  // type on the page, and being asked twice on one screen reads as nagging
  // rather than as two findings.

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
