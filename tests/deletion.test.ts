/**
 * Deleting a transaction by hand. Requires a database, like reconciliation.
 *
 * A deletion is a tombstone the `transactions` view resolves at read time, so
 * three things have to hold: the row leaves everything the app reads at once,
 * the reconciliation identity keeps holding without it, and the next sync -
 * which upserts the same row again - cannot bring it back.
 *
 * Everything happens inside a transaction that is always rolled back.
 */

import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import type postgres from 'postgres'

import { connect } from '../src/lib/db.ts'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required. These tests assert against real data and must not be skipped in CI.',
  )
}

const sql = connect()
const rollback = Symbol('rollback')

async function inRolledBackTransaction(body: (tx: postgres.TransactionSql) => Promise<void>) {
  try {
    await sql.begin(async (tx) => {
      await body(tx)
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }
}

async function fixture(tx: postgres.TransactionSql): Promise<{ id: string; accountId: string }> {
  const [account] = await tx<{ id: string }[]>`
    insert into accounts (external_id, name, source)
    values ('deletion_test_account', 'Deletion fixture', 'akahu')
    returning id
  `
  const [row] = await tx<{ id: string }[]>`
    insert into transactions_raw (external_id, source, account_id, date, description, amount, raw)
    values ('deletion_test_row', 'akahu', ${account!.id}, app_today(), 'Sent twice by the provider', -42.50, '{"v": 1}'::jsonb)
    returning id
  `
  await tx`
    insert into transactions_enriched (transaction_id, category_id, exclusion_reason, classified_by)
    select ${row!.id}, id, null, 'rule' from categories where kind = 'expense' and is_consumption limit 1
  `
  return { id: row!.id, accountId: account!.id }
}

async function visible(tx: postgres.TransactionSql, id: string): Promise<boolean> {
  const [row] = await tx<{ n: string }[]>`select count(*) as n from transactions where id = ${id}`
  return Number(row?.n) === 1
}

async function netCash(tx: postgres.TransactionSql): Promise<number> {
  const [row] = await tx<{ net_cash: string; drift: string }[]>`
    select net_cash,
           net_cash - (income_signed + spend_signed + non_consumption_signed + excluded_signed + unclassified_signed) as drift
    from reconciliation
  `
  assert.equal(Number(row?.drift), 0, 'reconciliation buckets must always add back to net cash')
  return Number(row?.net_cash)
}

describe('deleting a transaction', () => {
  after(async () => {
    await sql.end()
  })

  test('a tombstone hides the row everywhere the app reads, and restoring brings it back', async () => {
    await inRolledBackTransaction(async (tx) => {
      const { id, accountId } = await fixture(tx)
      const before = await netCash(tx)
      assert.ok(await visible(tx, id), 'the fixture row should start out visible')

      await tx`insert into deleted_transactions (transaction_id) values (${id})`

      assert.ok(!(await visible(tx, id)), 'a deleted row must leave the transactions view')
      assert.equal(
        Math.round((before - (await netCash(tx))) * 100) / 100,
        -42.5,
        'the deleted amount must leave net cash and every bucket with it',
      )

      const [health] = await tx<{ transaction_count: string; latest_transaction: Date | null }[]>`
        select transaction_count, latest_transaction from account_health where id = ${accountId}
      `
      assert.equal(Number(health?.transaction_count), 0, 'account health must not count a deleted row')
      assert.equal(health?.latest_transaction, null)

      await tx`delete from deleted_transactions where transaction_id = ${id}`

      assert.ok(await visible(tx, id), 'restoring must bring the row back')
      assert.equal(await netCash(tx), before)
    })
  })

  test('a re-sync cannot resurrect a deleted row', async () => {
    await inRolledBackTransaction(async (tx) => {
      const { id, accountId } = await fixture(tx)
      await tx`insert into deleted_transactions (transaction_id) values (${id})`

      // Exactly the upsert the Akahu sync runs, once with the same payload and
      // once with a revised one. Both must leave the tombstone alone.
      for (const raw of [{ v: 1 }, { v: 2 }]) {
        await tx`
          insert into transactions_raw (external_id, source, account_id, date, description, amount, raw)
          values ('deletion_test_row', 'akahu', ${accountId}, app_today(), 'Sent twice by the provider', -42.50, ${tx.json(raw)})
          on conflict (source, external_id) do update set
            date        = excluded.date,
            description = excluded.description,
            amount      = excluded.amount,
            raw         = excluded.raw,
            revised_at  = now()
          where transactions_raw.raw is distinct from excluded.raw
        `
        assert.ok(
          !(await visible(tx, id)),
          `a sync upsert with payload ${JSON.stringify(raw)} must not undelete the row`,
        )
      }

      // And the CSV import's shape, which never updates.
      await tx`
        insert into transactions_raw (external_id, source, account_id, date, description, amount, raw)
        values ('deletion_test_row', 'akahu', ${accountId}, app_today(), 'Sent twice by the provider', -42.50, '{"v": 3}'::jsonb)
        on conflict (source, external_id) do nothing
      `
      assert.ok(!(await visible(tx, id)), 'a re-import must not undelete the row')

      // Deleting twice is a no-op rather than an error, as the action writes it.
      await tx`
        insert into deleted_transactions (transaction_id) values (${id})
        on conflict (transaction_id) do nothing
      `
    })
  })

  test('the derived layer is not what hides the row, so a recompute cannot show it again', async () => {
    await inRolledBackTransaction(async (tx) => {
      const { id } = await fixture(tx)
      await tx`insert into deleted_transactions (transaction_id) values (${id})`

      // What recompute does to every row: drop the derived row and write a new one.
      await tx`delete from transactions_enriched where transaction_id = ${id}`
      assert.ok(!(await visible(tx, id)), 'an unenriched deleted row must stay hidden')

      await tx`
        insert into transactions_enriched (transaction_id, category_id, exclusion_reason, classified_by)
        values (${id}, null, null, 'unmatched')
      `
      assert.ok(!(await visible(tx, id)), 'a re-enriched deleted row must stay hidden')

      const [recon] = await tx<{ unenriched_count: string }[]>`select unenriched_count from reconciliation`
      assert.ok(recon, 'reconciliation should still answer')
    })
  })
})
