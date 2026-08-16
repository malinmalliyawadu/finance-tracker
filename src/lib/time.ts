/**
 * The app's clock. One time zone, named once.
 *
 * This is a New Zealand ledger read by someone in New Zealand, but nothing it
 * runs on agrees: the container is UTC, Postgres is UTC, and the browser is
 * whatever the laptop is set to. Left alone, "today" means three different days
 * for eleven hours out of every twenty-four, and the damage is quiet - the
 * dashboard is a day into the wrong statement period on the morning of the
 * 16th, pace and forecast divide by an elapsed-day count that is off by one,
 * and a coffee bought at 9am lands on yesterday.
 *
 * Two kinds of value, and the difference is the whole point:
 *
 *   calendar date  What a bank statement means by a date. No time, no zone.
 *                  Stored as Postgres `date`, carried in TypeScript as
 *                  `YYYY-MM-DD` or as a Date pinned to UTC midnight, and
 *                  rendered without a zone conversion of any kind.
 *   instant        A real point in time - when a sync ran. Stored as
 *                  `timestamptz`, and displayed in New Zealand time.
 *
 * Converting between them is the only place a zone is allowed to matter, and
 * every such conversion goes through this file.
 */

/**
 * Mirrors the default of `settings.timezone`, which is what `app_today()` in
 * db/migrations/0009_new_zealand_time.sql reads. Change one and change both.
 */
export const NZ_TIME_ZONE = 'Pacific/Auckland'

const NZ_DATE_PARTS = new Intl.DateTimeFormat('en-NZ', {
  timeZone: NZ_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * The calendar date an instant fell on in New Zealand, as `YYYY-MM-DD`.
 *
 * Assembled from parts rather than by slicing a formatted string: the layout of
 * `en-NZ` is day-first and locale data is free to change, but the part types
 * are fixed.
 */
export function nzDate(instant: Date | string): string {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Not a timestamp: ${JSON.stringify(instant)}`)
  }

  const parts = NZ_DATE_PARTS.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? ''

  return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * Today in New Zealand, as `YYYY-MM-DD`.
 *
 * `now` is a parameter rather than a call to the clock so anything built on it
 * stays reproducible, which is the same reason `detectRecurring` takes `asOf`.
 */
export function nzToday(now: Date = new Date()): string {
  return nzDate(now)
}

/**
 * A calendar date as a Date, pinned to UTC midnight.
 *
 * That pinning is the convention the whole app leans on. Postgres `date`
 * columns arrive from postgres.js this way, so a date from the database and a
 * date built from a string here are the same object, and `getUTCFullYear` and
 * a UTC-pinned formatter both read back exactly the day that was stored - on a
 * server in Auckland, a server in UTC, and a browser in Los Angeles alike.
 */
export function calendarDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(`${value}T00:00:00Z`)
}
