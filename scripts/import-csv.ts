/**
 * Imports a Latitude/Gem statement CSV for the Flight Centre Mastercard, which
 * Akahu cannot connect to.
 *
 *   npm run import:csv -- ~/Downloads/transactions.csv
 *   npm run import:csv -- ~/Downloads/transactions.csv --dry-run
 *
 * Idempotent in the same way the Akahu sync is: each row gets a natural key
 * derived from the account and the original CSV line, so re-importing a file
 * that overlaps a previous one inserts nothing. Exports overlap by design —
 * you cannot ask the statement for "everything since last time" — so the
 * import has to be safe to run on the whole file every time.
 *
 * The key hashes the untouched line rather than the parsed fields, so changing
 * how descriptions are normalised later cannot silently duplicate history.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { connect } from '../src/lib/db.ts'
import { parseGemStatement } from '../src/lib/csv.ts'

const ACCOUNT = {
  externalId: 'gem-flight-centre',
  name: 'Flight Centre Mastercard',
  institution: 'Latitude',
  type: 'CREDITCARD',
  // A file I have to remember to export gets a month before it is called stale,
  // where an Akahu account gets three days.
  staleAfterDays: 35,
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const path = args.find((arg) => !arg.startsWith('--'))

if (!path) {
  process.stderr.write('Usage: npm run import:csv -- <file.csv> [--dry-run]\n')
  process.exit(1)
}

const file = resolve(path)
const text = readFileSync(file, 'utf8')
const rows = parseGemStatement(text)

if (rows.length === 0) {
  log({ event: 'import.empty', file: basename(file) })
  process.exit(0)
}

// Identical lines can legitimately appear twice in one statement — two $3.69
// coffees on the same day at the same shop. Index them so each gets a distinct
// key, and so the same file always produces the same keys.
const seen = new Map<string, number>()
const keyed = rows.map((row) => {
  const occurrence = seen.get(row.rawLine) ?? 0
  seen.set(row.rawLine, occurrence + 1)

  const externalId = createHash('sha256')
    .update(`csv|${ACCOUNT.externalId}|${row.rawLine}|${occurrence}`)
    .digest('hex')
    .slice(0, 40)

  return { ...row, externalId, occurrence }
})

const dates = keyed.map((row) => row.date).sort()
const oldest = dates[0]!
const newest = dates.at(-1)!

if (dryRun) {
  log({
    event: 'import.dry_run',
    file: basename(file),
    rows: keyed.length,
    from: oldest,
    to: newest,
    debits: keyed.filter((r) => r.amount < 0).length,
    credits: keyed.filter((r) => r.amount > 0).length,
    net: round2(keyed.reduce((sum, r) => sum + r.amount, 0)),
  })
  process.exit(0)
}

const sql = connect('sync')

try {
  const result = await sql.begin(async (tx) => {
    const [account] = await tx<{ id: string }[]>`
      insert into accounts (external_id, source, name, institution, type,
                            stale_after_days, first_connected_at)
      values (${ACCOUNT.externalId}, 'csv', ${ACCOUNT.name}, ${ACCOUNT.institution},
              ${ACCOUNT.type}, ${ACCOUNT.staleAfterDays}, now())
      on conflict (source, external_id) do update set
        name             = excluded.name,
        institution      = excluded.institution,
        stale_after_days = excluded.stale_after_days
      returning id
    `

    const accountId = account!.id

    const before = await tx<{ n: string }[]>`
      select count(*) as n from transactions_raw where account_id = ${accountId}
    `

    const payload = keyed.map((row) => ({
      external_id: row.externalId,
      source: 'csv',
      account_id: accountId,
      date: row.date,
      description: row.description,
      amount: row.amount,
      raw: {
        source: 'csv',
        file: basename(file),
        line: row.lineNumber,
        raw_line: row.rawLine,
        card_number: row.cardNumber,
        date: row.date,
        description: row.description,
        amount: row.amount,
      },
    }))

    // do nothing, not do update: transactions_raw is immutable, and a statement
    // re-export is not an upstream correction.
    for (let i = 0; i < payload.length; i += 500) {
      await tx`
        insert into transactions_raw ${tx(payload.slice(i, i + 500))}
        on conflict (source, external_id) do nothing
      `
    }

    const after = await tx<{ n: string }[]>`
      select count(*) as n from transactions_raw where account_id = ${accountId}
    `

    await tx`
      update accounts set
        last_synced_at          = now(),
        oldest_transaction_date = least(coalesce(oldest_transaction_date, ${oldest}::date), ${oldest}::date),
        backfill_completed_at   = coalesce(backfill_completed_at, now()),
        backfill_notes          = ${`manual CSV import; latest file ${basename(file)}`}
      where id = ${accountId}
    `

    return { inserted: Number(after[0]!.n) - Number(before[0]!.n), total: Number(after[0]!.n) }
  })

  log({
    event: 'import.complete',
    file: basename(file),
    rows_in_file: keyed.length,
    inserted: result.inserted,
    already_present: keyed.length - result.inserted,
    account_total: result.total,
    from: oldest,
    to: newest,
    note: 'run `npm run recompute` to classify',
  })
} finally {
  await sql.end()
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function log(fields: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(fields) + '\n')
}
