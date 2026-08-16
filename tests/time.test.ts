/**
 * The clock, and the line between an instant and a calendar date.
 *
 * These need no database, which is the point: the bug they pin down is one that
 * only appears for eleven hours out of twenty-four, on a machine set to a zone
 * nobody who runs the app lives in. That is not a thing anyone catches by
 * looking at the dashboard, so it is asserted here instead.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { calendarDate, nzDate, nzToday } from '../src/lib/time.ts'
import { dateTime, fullDate, monthShort, shortDate } from '../src/lib/format.ts'

describe('nzDate', () => {
  test('a morning coffee belongs to the New Zealand day, not the UTC one', () => {
    // 9:04am on 17 August in Wellington. Slicing the UTC instant, which is what
    // the ingest used to do, yields the 16th.
    assert.equal(nzDate('2026-08-16T21:04:00.000Z'), '2026-08-17')
  })

  test('midnight UTC is still the same New Zealand day', () => {
    // Akahu often reports a plain bank date as UTC midnight. Converting must
    // not shift those forward.
    assert.equal(nzDate('2026-08-16T00:00:00.000Z'), '2026-08-16')
  })

  test('holds across the daylight saving boundary', () => {
    // NZDT (UTC+13) ends at 3am on 5 April 2026, so the same UTC instant sits
    // on either side of the offset change.
    assert.equal(nzDate('2026-04-04T12:30:00.000Z'), '2026-04-05') // +13
    assert.equal(nzDate('2026-04-05T12:30:00.000Z'), '2026-04-06') // +12
  })

  test('the last moment of a New Zealand day is still that day', () => {
    assert.equal(nzDate('2026-08-16T11:59:59.999Z'), '2026-08-16')
    assert.equal(nzDate('2026-08-16T12:00:00.000Z'), '2026-08-17')
  })

  test('rejects a value that is not a timestamp', () => {
    assert.throws(() => nzDate('not a date'), /Not a timestamp/)
  })
})

describe('nzToday', () => {
  test('reads the New Zealand day off the given instant', () => {
    assert.equal(nzToday(new Date('2026-08-16T20:00:00.000Z')), '2026-08-17')
  })
})

describe('calendar dates survive the round trip', () => {
  test('a date string encodes to UTC midnight and reads back unchanged', () => {
    const date = calendarDate('2026-08-16')
    assert.equal(date.toISOString(), '2026-08-16T00:00:00.000Z')
    assert.equal(date.getUTCFullYear(), 2026)
    assert.equal(date.getUTCMonth(), 7)
  })

  test('formatters render the day that was stored, whatever zone they run in', () => {
    // The assertions below are the reason the formatters are pinned: run this
    // process with TZ=America/Los_Angeles and an unpinned formatter reports the
    // 15th for every one of them.
    assert.equal(shortDate('2026-08-16'), '16 Aug')
    assert.equal(fullDate('2026-08-16'), '16 Aug 2026')
    assert.equal(monthShort('2026-08-16'), 'Aug')
  })

  test('a date column from postgres formats the same as its string form', () => {
    // postgres.js parses a `date` column to UTC midnight, so the two paths into
    // the formatters have to agree.
    const fromDb = new Date('2026-01-01T00:00:00.000Z')
    assert.equal(fullDate(fromDb), fullDate('2026-01-01'))
  })
})

describe('instants are shown in New Zealand time', () => {
  test('a sync that ran at 9am says 9am, not last night', () => {
    const shown = dateTime('2026-08-16T21:04:00.000Z')
    assert.match(shown, /17\/08\/2026/)
    assert.match(shown, /9:04/)
  })
})
