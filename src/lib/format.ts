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

const DAY_MONTH = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short' })
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
const MONTH_SHORT = new Intl.DateTimeFormat('en-NZ', { month: 'short' })

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(`${value}T00:00:00Z`)
}

export function shortDate(value: Date | string): string {
  return DAY_MONTH.format(toDate(value))
}

export function fullDate(value: Date | string): string {
  return DAY_MONTH_YEAR.format(toDate(value))
}

/** "16 Aug – 15 Sep 2026". The period is the app's unit of time, so it is always spelled out. */
export function periodLabel(start: Date | string, end: Date | string): string {
  return `${DAY_MONTH.format(toDate(start))} – ${DAY_MONTH_YEAR.format(toDate(end))}`
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
