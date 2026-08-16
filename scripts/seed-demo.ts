/**
 * Generates twelve months of synthetic transactions so the UI can be built and
 * reviewed before Akahu is connected.
 *
 *   npm run seed:demo        (then: npm run recompute)
 *
 * Every row is written with external_id prefixed 'demo_' and raw.demo = true, so
 * it is trivially separable from real data:
 *
 *   delete from transactions_raw where external_id like 'demo_%';
 *
 * Shapes and magnitudes follow the brief: gross contracting pay passing through
 * to Hnry, card spend settled by card payments, loan repayments and investing
 * as non-consumption outflows, and a handful of large one-off decisions. It is
 * deliberately not perfectly categorisable — a few descriptors are left
 * unmatched, because a coverage number of exactly 100% would tell us nothing.
 */

import { connect } from '../src/lib/db.ts'

// Deterministic PRNG. Re-running the seed produces the same ledger, so a UI
// change can be compared against a stable baseline.
let seed = 20260816
function random(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
const between = (lo: number, hi: number) => lo + random() * (hi - lo)
const round2 = (n: number) => Math.round(n * 100) / 100

// Ends on the 15th so the demo contains twelve complete statement periods and
// no stub. Real data will always have a partial current period, because the
// period you are living in has not finished yet.
const END = new Date('2026-08-15T00:00:00Z')
const START = new Date('2025-08-16T00:00:00Z')
const DAY = 86_400_000

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY)
const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Calendar-month dates, not every-30-days. Direct debits fall on a day of the
 * month, and stepping by 30 instead drifts a day or two each time until two
 * charges land inside one statement period and the period reads as an anomaly
 * that never happened.
 */
function monthlyDates(dayOfMonth: number, from = START, to = END): Date[] {
  const dates: Date[] = []
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), Math.min(dayOfMonth, 28)))
  while (cursor <= to) {
    if (cursor >= from) dates.push(new Date(cursor))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return dates
}

type Txn = { account: string; date: Date; description: string; amount: number }
const txns: Txn[] = []
const add = (account: string, date: Date, description: string, amount: number) => {
  if (date < START || date > END) return
  txns.push({ account, date, description, amount: round2(amount) })
}

// Mirrors the real setup: four accounts Akahu can reach, and the Flight Centre
// Mastercard, which it cannot, arriving as a manual CSV with a month of slack
// before it is called stale.
const ACCOUNTS = [
  { key: 'kiwibank', external_id: 'acc_demo_kiwibank', source: 'akahu', stale: 3, name: 'Everyday', institution: 'Kiwibank', type: 'CHECKING', balance: 8421.55 },
  { key: 'loan', external_id: 'acc_demo_loan', source: 'akahu', stale: 3, name: 'Home Loan', institution: 'Kiwibank', type: 'LOAN', balance: -412_800.0 },
  { key: 'amex', external_id: 'acc_demo_amex', source: 'akahu', stale: 3, name: 'Amex Airpoints', institution: 'American Express', type: 'CREDITCARD', balance: -2144.3 },
  { key: 'gem', external_id: 'gem-flight-centre', source: 'csv', stale: 35, name: 'Flight Centre Mastercard', institution: 'Latitude', type: 'CREDITCARD', balance: -863.1 },
  { key: 'sharesies', external_id: 'acc_demo_sharesies', source: 'akahu', stale: 3, name: 'Sharesies', institution: 'Sharesies', type: 'INVESTMENT', balance: 31_204.9 },
] as const

// --- income and the passthrough it drags with it ---------------------------
// $140,296 gross in, $131,961 straight back out to Hnry for tax. Counting
// either side raw is a ~$132k error, which is the entire reason the
// passthrough rules sit at the top of the rule set.
for (let d = new Date('2025-08-21T00:00:00Z'); d <= END; d = addDays(d, 14)) {
  const gross = between(5200, 5600)
  add('kiwibank', d, 'SALARY CXC GLOBAL NZ LTD', gross)
  add('kiwibank', addDays(d, 1), 'PAY M MALLIYA WADU', -gross * between(0.93, 0.95))
  // What Hnry pays back after tax and expenses. Sized so a year of demo income
  // roughly covers a year of demo outgoings, rather than leaving every period
  // in deficit and making the net position look like a bug.
  add('kiwibank', addDays(d, 3), 'HNRY LIMITED PAYE PAYMENT', between(4350, 4950))
}

// Car park rent, and the annual tax refund.
for (const d of monthlyDates(1, new Date('2025-09-01T00:00:00Z'))) {
  add('kiwibank', d, 'BILL PAYMENT CAR PARK RENT', between(180, 195))
}
add('kiwibank', new Date('2026-06-12T00:00:00Z'), 'I.R.D. INCOME TAX REFUND', 2840.5)
add('kiwibank', new Date('2026-03-04T00:00:00Z'), 'GST REFUND 0512', 1204.15)

// --- money that is not consumption -----------------------------------------
for (const d of monthlyDates(20)) {
  add('kiwibank', d, 'LOAN PMT 38-9014-0271553-01', -between(3300, 3460))
  add('kiwibank', addDays(d, 2), 'SHARESIES LIMITED', -between(1750, 2100))
}

// --- fixed household -------------------------------------------------------
const MONTHLY: [string, string, number, number][] = [
  ['kiwibank', 'MERIDIAN ENERGY LTD', 145, 265],
  ['kiwibank', 'WELLINGTON CITY COUNCIL RATES', 268, 268],
  ['kiwibank', 'TIAKI WAI WATER', 61, 74],
  ['kiwibank', 'BODY CORPORATE 41288', 412, 412],
  ['kiwibank', 'COVI INSURANCE NZ', 188, 196],
  ['kiwibank', 'WIRELESS NATION', 89, 89],
  ['kiwibank', 'SKINNY FIXED WIRELESS', 46, 46],
  ['amex', 'NETFLIX.COM', 24.99, 26.99],
  ['amex', 'APPLE.COM/BILL', 12.99, 34.99],
  ['amex', 'YOUTUBE PREMIUM', 22.9, 22.9],
  ['amex', 'ANTHROPIC CLAUDE.AI SUBSCRIPTION', 32.5, 32.5],
  ['amex', 'VERCEL INC', 33.4, 33.4],
  ['amex', 'SUPABASE PTE LTD', 41.2, 41.2],
  ['amex', 'NOTION LABS INC', 16.8, 16.8],
  ['kiwibank', 'SNAPNATION WELLINGTON', 79, 79],
  ['kiwibank', 'EZI*HEALTH AND FITNESS', 88, 88],
]
for (const [account, description, lo, hi] of MONTHLY) {
  const dayOfMonth = 1 + Math.floor(random() * 27)
  for (const d of monthlyDates(dayOfMonth)) {
    add(account, d, description, -between(lo, hi))
  }
}

// A subscription cancelled in March, so the recurring page has something
// genuinely overdue to flag rather than only healthy series.
for (const d of monthlyDates(19, START, new Date('2026-03-19T00:00:00Z'))) {
  add('amex', d, 'NEON AUCKLAND NZ', -19.99)
}

// --- discretionary ---------------------------------------------------------
const GROCERS = ['NEW WORLD THORNDON', 'PAK N SAVE PETONE', 'NEW WORLD WILLIS ST', 'MOORE WILSONS FRESH', 'WOOLWORTHS NZ 9032']
const EATING = [
  'MOJO AIRPORT', 'SCOPA CAFFE', 'PITA PIT WELLINGTON', 'FERGBURGER', 'LITTLE PENANG',
  'UBER *EATS', 'SUBWAY LAMBTON QUAY', 'THE HANGAR CAFE', 'PUKUPIES', 'GELATO ON PARADE',
  'KHAO SOI RESTAURANT', 'SKETCHBOOK COFFEE', 'BURGERFUEL COURTENAY', 'DOMINOS PIZZA NZ',
]
const TRANSPORT = ['BP CONNECT NGAURANGA', 'SNAPPER SERVICES', 'UBER *TRIP', 'MOBIL PETONE', 'PAYMYPARK WELLINGTON', 'WAITOMO GROUP']
const HOME = ['BUNNINGS LOWER HUTT', 'MIGHTY APE NZ', 'THE WAREHOUSE PETONE', 'BRISCOES HOMEWARES', 'NOEL LEEMING 41']
const HEALTH = ['UNICHEM THORNDON', 'CHEMIST WAREHOUSE NZ', 'WELLINGTON MEDICAL CENTRE']
const CLOTHING = ['UNIQLO WELLINGTON', 'HALLENSTEIN BROS', 'ALI BARBERS', 'KATHMANDU LTD']

for (let d = new Date(START); d <= END; d = addDays(d, 1)) {
  const dow = d.getUTCDay()

  if (dow === 6 || dow === 3) add(pick(['kiwibank', 'amex']), d, pick(GROCERS), -between(38, 210))
  if (random() < 0.55) add(pick(['amex', 'kiwibank', 'gem']), d, pick(EATING), -between(6.5, 68))
  if (random() < 0.22) add(pick(['kiwibank', 'amex']), d, pick(TRANSPORT), -between(3.2, 128))
  if (random() < 0.09) add(pick(['amex', 'gem']), d, pick(HOME), -between(14, 240))
  if (random() < 0.05) add('kiwibank', d, pick(HEALTH), -between(9, 96))
  if (random() < 0.04) add(pick(['amex', 'gem']), d, pick(CLOTHING), -between(28, 260))
  if (random() < 0.03) add('kiwibank', d, 'ATMS - NZ WELLINGTON', -between(20, 200))

  // Descriptors that no rule covers. Real ledgers have these; a coverage
  // number that cannot fall is not measuring anything.
  if (random() < 0.012) add('kiwibank', d, pick(['SQ *MARKET STALL', 'PAYWAVE 4471', 'ZIP CO NZ LTD', 'ONLINE PURCHASE 88213']), -between(8, 140))
  if (random() < 0.008) add('kiwibank', d, 'TRF ***** 4471', -between(20, 400))
}

// --- large one-off decisions ------------------------------------------------
// A quarter of a year's living costs arriving in about a dozen choices, which
// is exactly what the large purchases page exists to surface.
const ONE_OFFS: [string, string, string, number][] = [
  ['amex', '2025-09-12', 'AIR NEW ZEALAND 0864412', 1284.0],
  ['gem', '2025-10-02', 'AGODA.COM SINGAPORE', 2140.5],
  ['amex', '2025-11-21', 'APPLE.COM/BILL MACBOOK PRO', 4299.0],
  ['kiwibank', '2025-12-03', 'BUNNINGS LOWER HUTT', 1874.2],
  ['amex', '2025-12-19', 'OUTRIGGER FIJI BEACH RESORT', 3210.75],
  ['gem', '2026-01-08', 'JETSTAR AIRWAYS', 968.4],
  ['kiwibank', '2026-02-14', 'HEATHCOTE APPLIANCES', 2489.0],
  ['amex', '2026-03-22', 'IRONMAN NEW ZEALAND ENTRY', 895.0],
  ['kiwibank', '2026-04-09', 'NZ TRANSPORT AGENCY REGO', 612.3],
  ['amex', '2026-05-16', 'BOOKING.COM QUEENSTOWN', 1740.0],
  ['gem', '2026-06-27', 'NOEL LEEMING 41 WELLINGTON', 1329.99],
  ['amex', '2026-07-30', 'PATAGONIA NEW ZEALAND', 806.5],
]
for (const [account, date, description, amount] of ONE_OFFS) {
  add(account, new Date(`${date}T00:00:00Z`), description, -amount)
}

// --- card payments ----------------------------------------------------------
// Both legs, every month: the debit from Kiwibank and the credit on the card.
// The purchases they settle are already above, so counting either leg would
// double the spend. Both are excluded as card_payment.
for (const d of monthlyDates(5, new Date('2025-09-05T00:00:00Z'))) {
  const amex = between(1400, 3900)
  add('kiwibank', d, 'AMEX PAYMENT', -amex)
  add('amex', d, 'PAYMENT RECEIVED - THANK YOU', amex)

  const gem = between(300, 1400)
  add('kiwibank', addDays(d, 4), 'FLIGHT CENTRE MASTERCARD', -gem)
  add('gem', addDays(d, 4), 'DIRECT DEBIT PAYMENT RECEIVED', gem)
}

// Transfers between my own accounts.
for (let d = new Date('2025-08-25T00:00:00Z'); d <= END; d = addDays(d, 21)) {
  const amount = between(200, 1500)
  add('kiwibank', d, 'TRANSFER TO M S MALLIYAWADU - 02', -amount)
  add('kiwibank', addDays(d, 45), 'TRANSFER FROM M S MALLIYAWADU - 02', amount * 0.4)
}

// --- write ------------------------------------------------------------------
txns.sort((a, b) => a.date.getTime() - b.date.getTime())

const sql = connect()
try {
  await sql.begin(async (tx) => {
    for (const account of ACCOUNTS) {
      await tx`
        insert into accounts (external_id, source, stale_after_days, name, institution, type,
                              current_balance, balance_as_at, last_synced_at, first_connected_at,
                              oldest_transaction_date, backfill_completed_at, backfill_notes)
        values (${account.external_id}, ${account.source}, ${account.stale}, ${account.name},
                ${account.institution}, ${account.type},
                ${account.balance}, ${END}, ${END}, ${START}, ${iso(START)}, ${END},
                'demo data, not from Akahu')
        on conflict (source, external_id) do update set
          current_balance  = excluded.current_balance,
          stale_after_days = excluded.stale_after_days,
          last_synced_at   = excluded.last_synced_at
      `
    }

    const accountIds = new Map(
      (
        await tx<{ id: string; external_id: string }[]>`
          select id, external_id from accounts
          where external_id = any(${ACCOUNTS.map((a) => a.external_id)})
        `
      ).map((row) => [row.external_id, row.id]),
    )

    await tx`delete from transactions_raw where external_id like 'demo_%'`

    const rows = txns.map((txn, i) => {
      const account = ACCOUNTS.find((a) => a.key === txn.account)!
      const akahuId = `demo_${String(i).padStart(5, '0')}`
      return {
        external_id: akahuId,
        account_id: accountIds.get(account.external_id)!,
        date: iso(txn.date),
        description: txn.description,
        amount: txn.amount,
        raw: {
          _id: akahuId,
          _account: account.external_id,
          date: iso(txn.date),
          description: txn.description,
          amount: txn.amount,
          demo: true,
        },
      }
    })

    for (let i = 0; i < rows.length; i += 500) {
      await tx`insert into transactions_raw ${tx(rows.slice(i, i + 500))}`
    }
  })

  const inflow = txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const outflow = txns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)

  process.stdout.write(
    JSON.stringify({
      event: 'seed_demo.complete',
      accounts: ACCOUNTS.length,
      transactions: txns.length,
      from: iso(START),
      to: iso(END),
      gross_inflow: round2(inflow),
      gross_outflow: round2(outflow),
      note: 'run `npm run recompute` to classify',
    }) + '\n',
  )
} finally {
  await sql.end()
}
