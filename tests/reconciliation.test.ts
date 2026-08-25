/**
 * The reconciliation test. Requires a database, and is meant to fail CI.
 *
 * Two claims:
 *   1. Every raw transaction is classified exactly once.
 *   2. The classified buckets add back up to raw net cash.
 *
 * If either breaks, some money is being counted twice or dropped, and every
 * figure in the app is wrong by an amount nobody can see.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import type postgres from 'postgres'

import { connect } from '../src/lib/db.ts'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required. These tests assert against real data and must not be skipped in CI.',
  )
}

const sql = connect()

describe('reconciliation', () => {
  let recon: Record<string, string>

  before(async () => {
    const [row] = await sql<Record<string, string>[]>`select * from reconciliation`
    recon = row ?? {}
  })

  after(async () => {
    await sql.end()
  })

  test('every raw transaction has a derived row', async () => {
    assert.equal(
      Number(recon.unenriched_count),
      0,
      'transactions_raw rows with no transactions_enriched row: run `npm run recompute`',
    )
  })

  test('no transaction is classified twice', async () => {
    // The check constraint makes category-and-exclusion impossible, so the only
    // remaining way to be classified twice is a duplicate derived row. The
    // primary key makes that impossible too; this asserts both still hold.
    const [dupes] = await sql<{ n: string }[]>`
      select count(*) as n from (
        select transaction_id from transactions_enriched group by 1 having count(*) > 1
      ) d
    `
    assert.equal(Number(dupes?.n), 0)

    const [both] = await sql<{ n: string }[]>`
      select count(*) as n from transactions_enriched
      where category_id is not null and exclusion_reason is not null
    `
    assert.equal(Number(both?.n), 0, 'a row may carry a category or an exclusion, never both')
  })

  test('the buckets add up to raw net cash', () => {
    const netCash = Number(recon.net_cash)
    const buckets =
      Number(recon.income_signed) +
      Number(recon.spend_signed) +
      Number(recon.non_consumption_signed) +
      Number(recon.excluded_signed) +
      Number(recon.unclassified_signed)

    // Everything is numeric(14,2), so this is exact arithmetic, not floating
    // point. A cent of tolerance would hide a real bug.
    assert.equal(
      round2(netCash - buckets),
      0,
      `out by ${round2(netCash - buckets)}: net cash ${netCash} vs buckets ${round2(buckets)}`,
    )
  })

  test('card payments net out against the purchases they settle', async () => {
    // Not an identity — a statement can straddle a period boundary — but a
    // large one-sided total means only one leg is being excluded.
    const [row] = await sql<{ legs: string; net: string }[]>`
      select count(*) as legs, coalesce(sum(amount), 0) as net
      from transactions where exclusion_reason = 'card_payment'
    `
    const legs = Number(row?.legs ?? 0)
    if (legs === 0) return

    const gross = await sql<{ gross: string }[]>`
      select coalesce(sum(abs(amount)), 0) as gross
      from transactions where exclusion_reason = 'card_payment'
    `
    const ratio = Math.abs(Number(row?.net)) / Number(gross[0]?.gross ?? 1)
    assert.ok(
      ratio < 0.2,
      `card payment legs are ${(ratio * 100).toFixed(1)}% one-sided; one side is probably not being excluded`,
    )
  })

  /**
   * The identity above is checked against whatever happens to be in the ledger,
   * so it only fails once real money has already gone missing from the page.
   * This builds the two shapes that broke it - an override that excludes
   * something the rules classified, and an override that reclaims something the
   * rules excluded - and measures what each one moves.
   *
   * The two errors have opposite signs, so a ledger holding both can net back
   * to a small drift, or to none, while every figure on the page is wrong. That
   * is why this asserts the movement of each bucket and not only the total.
   * Everything happens inside a transaction that is always rolled back, so the
   * ledger it runs against is untouched.
   */
  test('an override moves money between buckets, never out of them or into two', async () => {
    const rollback = Symbol('rollback')
    let opening: Buckets | undefined
    let closing: Buckets | undefined

    try {
      await sql.begin(async (tx) => {
        opening = await buckets(tx)

        const [account] = await tx<{ id: string }[]>`
          insert into accounts (external_id, name, source)
          values ('recon_test_account', 'Reconciliation fixture', 'akahu')
          returning id
        `
        const [category] = await tx<{ id: string }[]>`
          insert into categories (name, slug, kind, is_consumption)
          values ('Reconciliation fixture spend', 'recon-fixture-spend', 'expense', true)
          returning id
        `

        const raw = await tx<{ id: string; external_id: string }[]>`
          insert into transactions_raw (external_id, account_id, date, description, amount, raw)
          select v.ext, ${account!.id}, app_today(), v.descr, v.amt, '{}'::jsonb
          from (values
            ('recon_excluded_by_hand', 'Rules said groceries, human said transfer', -820.00),
            ('recon_reclaimed_by_hand', 'Rules said transfer, human said groceries', -250.00)
          ) as v(ext, descr, amt)
          returning id, external_id
        `
        const id = (ext: string) => raw.find((r) => r.external_id === ext)!.id

        // What the rules produced.
        await tx`
          insert into transactions_enriched (transaction_id, category_id, exclusion_reason, classified_by)
          values
            (${id('recon_excluded_by_hand')}, ${category!.id}, null, 'rule'),
            (${id('recon_reclaimed_by_hand')}, null, 'internal_transfer', 'rule')
        `

        // What the human then said, exactly as the UI writes it.
        await tx`
          insert into overrides (transaction_id, exclusion_reason)
          values (${id('recon_excluded_by_hand')}, 'internal_transfer')
        `
        await tx`
          insert into overrides (transaction_id, category_id, force_included)
          values (${id('recon_reclaimed_by_hand')}, ${category!.id}, true)
        `

        closing = await buckets(tx)

        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }

    assert.ok(opening && closing, 'the fixture transaction did not run')
    const moved = (key: keyof Buckets) => round2(closing![key] - opening![key])

    assert.equal(moved('net_cash'), -1070, 'the two fixture rows are -820 and -250')

    // The hand exclusion belongs in excluded and nowhere else. Under the old
    // view it left spend without arriving here, and -820 simply vanished.
    assert.equal(moved('excluded_signed'), -820, 'a hand exclusion must land in excluded')

    // The reclaimed transfer belongs in spend and nowhere else. Under the old
    // view it arrived here while still being counted as excluded.
    assert.equal(moved('spend_signed'), -250, 'a hand category must land in spend')

    assert.equal(moved('income_signed'), 0)
    assert.equal(moved('non_consumption_signed'), 0)
    assert.equal(moved('unclassified_signed'), 0)

    // Neither override is a rule match, but both are classified by a human, so
    // coverage must not treat them as unmatched.
    assert.equal(moved('unmatched_count'), 0, 'an overridden transaction is classified')

    assert.equal(moved('drift'), 0, `two overrides put the ledger out by ${moved('drift')}`)
  })

  test('categorisation coverage stays above 99%', async () => {
    const total = Number(recon.raw_count)
    if (total === 0) return

    const coverage = 1 - Number(recon.unmatched_count) / total
    assert.ok(
      coverage > 0.99,
      `coverage is ${(coverage * 100).toFixed(2)}% over ${total} transactions ` +
        `(${recon.unmatched_count} unmatched); add rules to data/categorisation-rules.json`,
    )
  })
})

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

type Buckets = {
  net_cash: number
  income_signed: number
  spend_signed: number
  non_consumption_signed: number
  excluded_signed: number
  unclassified_signed: number
  unmatched_count: number
  drift: number
}

/** The whole view as numbers, so a fixture can be measured as a difference. */
async function buckets(tx: postgres.TransactionSql): Promise<Buckets> {
  const [row] = await tx<Record<string, string>[]>`select * from reconciliation`
  const n = (key: string) => Number(row?.[key] ?? 0)

  return {
    net_cash: n('net_cash'),
    income_signed: n('income_signed'),
    spend_signed: n('spend_signed'),
    non_consumption_signed: n('non_consumption_signed'),
    excluded_signed: n('excluded_signed'),
    unclassified_signed: n('unclassified_signed'),
    unmatched_count: n('unmatched_count'),
    drift: round2(
      n('net_cash') -
        (n('income_signed') +
          n('spend_signed') +
          n('non_consumption_signed') +
          n('excluded_signed') +
          n('unclassified_signed')),
    ),
  }
}
