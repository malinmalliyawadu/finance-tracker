import { NZ_TIME_ZONE, calendarDate as toDate } from './time.ts'

// Re-exported because the display layer reaches for it constantly and should
// not have to know which module encodes a calendar date.
export { toDate }

const NZD = new Intl.NumberFormat('en-NZ', {
  style: 'currency',
  currency: 'NZD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const NZD_WHOLE = new Intl.NumberFormat('en-NZ', {
  style: 'currency',
  currency: 'NZD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Exact figure, for tables and anything that has to reconcile. */
export function money(value: number | string): string {
  return NZD.format(Number(value))
}

/** Rounded figure, for headlines where cents are noise. */
export function moneyWhole(value: number | string): string {
  return NZD_WHOLE.format(Number(value))
}

export function percent(value: number, digits = 0): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`
}

/**
 * Every date formatter is pinned to UTC, and that is not a contradiction of the
 * app being in New Zealand time - it is what makes it true.
 *
 * These render calendar dates, which `calendarDate` encodes as UTC midnight. A
 * formatter left unpinned reads that instant in whatever zone it is running
 * in, so the same transaction renders as the 16th on the server and the 15th
 * in a browser in Los Angeles, and Next hydration finds the two disagreeing.
 * Pinning to UTC undoes the encoding exactly, and the day that comes out is the
 * day the bank put in.
 *
 * Instants are a different question and are formatted by `dateTime` below.
 */
const calendarFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-NZ', { timeZone: 'UTC', ...options })

const DAY_MONTH = calendarFormat({ day: 'numeric', month: 'short' })
const DAY_MONTH_YEAR = calendarFormat({ day: 'numeric', month: 'short', year: 'numeric' })
const MONTH_SHORT = calendarFormat({ month: 'short' })
const WEEKDAY_DAY_MONTH = calendarFormat({ weekday: 'short', day: 'numeric', month: 'short' })

/** A real point in time, in New Zealand: "16/08/2026, 9:04 am". */
const NZ_DATE_TIME = new Intl.DateTimeFormat('en-NZ', {
  timeZone: NZ_TIME_ZONE,
  dateStyle: 'short',
  timeStyle: 'short',
})

export function shortDate(value: Date | string): string {
  return DAY_MONTH.format(toDate(value))
}

/** "Wed 19 Aug", for a feed of days where the weekday is half the meaning. */
export function weekdayDate(value: Date | string): string {
  return WEEKDAY_DAY_MONTH.format(toDate(value))
}

export function fullDate(value: Date | string): string {
  return DAY_MONTH_YEAR.format(toDate(value))
}

/** Abbreviated month of a calendar date: "Aug". */
export function monthShort(value: Date | string): string {
  return MONTH_SHORT.format(toDate(value))
}

/**
 * A real point in time - when a sync ran - in New Zealand time.
 *
 * Distinct from the calendar-date formatters above, and the only formatter that
 * converts zones. A sync that finished at 9:04am should say 9:04am to the
 * person who ran it, not 21:04 the previous day because the container is UTC.
 */
export function dateTime(instant: Date | string): string {
  return NZ_DATE_TIME.format(instant instanceof Date ? instant : new Date(instant))
}

/** "16 Aug – 15 Sep 2026". The period is the app's unit of time, so it is always spelled out. */
export function periodLabel(start: Date | string, end: Date | string): string {
  return `${DAY_MONTH.format(toDate(start))} – ${DAY_MONTH_YEAR.format(toDate(end))}`
}

function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13
  return `${day}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][day % 10] ?? 'th')}`
}

/**
 * How the app's unit of time is cut, in words: "the 16th to the 15th".
 *
 * Read from settings rather than written into the copy. The statement day is
 * configurable, and a page that asserts the 16th while the data is cut on the
 * 1st is worse than one that says nothing — it teaches the reader to distrust
 * the labels on everything else.
 */
export function periodRule(statementStartDay: number): string {
  if (statementStartDay === 1) return 'Calendar months.'
  return `Statement periods, the ${ordinal(statementStartDay)} to the ${ordinal(statementStartDay - 1)}.`
}

/** Compact label for chart axes. */
export function periodTick(start: Date | string): string {
  const date = toDate(start)
  const month = MONTH_SHORT.format(date)
  return date.getUTCMonth() === 0 ? `${month} ${String(date.getUTCFullYear()).slice(2)}` : month
}

export function isoDate(value: Date | string): string {
  return toDate(value).toISOString().slice(0, 10)
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
