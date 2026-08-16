// Server-only. Imported exclusively from server components and server actions;
// nothing here may be pulled into a client bundle.
import { db } from './db.ts'
import type { ExclusionReason } from './rules-file.ts'

const num = (value: unknown): number => Number(value ?? 0)

export type Settings = {
  statementStartDay: number
  largePurchaseThreshold: number
  timezone: string
}

export async function getSettings(): Promise<Settings> {
  const [row] = await db<
    { statement_start_day: number; large_purchase_threshold: string; timezone: string }[]
  >`select statement_start_day, large_purchase_threshold, timezone from settings limit 1`

  return {
    statementStartDay: row?.statement_start_day ?? 16,
    largePurchaseThreshold: num(row?.large_purchase_threshold ?? 500),
    timezone: row?.timezone ?? 'Pacific/Auckland',
  }
}

export type Period = { start: string; end: string; isCurrent: boolean }

/** Every period that has transactions, newest first. */
export async function getPeriods(): Promise<Period[]> {
  const rows = await db<{ period_start: Date; period_end: Date }[]>`
    select distinct period_start, period_end from transactions order by period_start desc
  `
  return rows.map((row, i) => ({
    start: row.period_start.toISOString().slice(0, 10),
    end: row.period_end.toISOString().slice(0, 10),
    isCurrent: i === 0,
  }))
}

// ---------------------------------------------------------------------------
// The sieve
// ---------------------------------------------------------------------------

export type SieveBand = {
  key: 'passthrough' | 'card_payment' | 'internal_transfer' | 'unidentified' | 'non_consumption' | 'living'
  label: string
  because: string
  amount: number
}

export type Sieve = {
  bands: SieveBand[]
  totalOut: number
  living: number
  income: number
  passthroughRetained: number
  unclassified: number
}

/**
 * Decomposes everything that left the account in a period. The bands are a true
 * partition — they sum to totalOut exactly — so the headline living-costs
 * figure is always visibly the remainder of a subtraction rather than a number
 * that arrived from somewhere unexplained.
 */
export async function getSieve(periodStart: string): Promise<Sieve> {
  const [row] = await db<Record<string, string>[]>`
    select
      coalesce(sum(-amount) filter (where exclusion_reason = 'passthrough'        and amount < 0), 0) as passthrough,
      coalesce(sum(-amount) filter (where exclusion_reason = 'card_payment'       and amount < 0), 0) as card_payment,
      coalesce(sum(-amount) filter (where exclusion_reason = 'internal_transfer'  and amount < 0), 0) as internal_transfer,
      coalesce(sum(-amount) filter (where exclusion_reason = 'unidentified'       and amount < 0), 0) as unidentified,
      coalesce(sum(-amount) filter (where exclusion_reason is null
                                     and category_kind = 'expense'
                                     and not is_consumption), 0)                                     as non_consumption,
      coalesce(sum(-amount) filter (where counts_as_spend), 0)                                       as living,
      coalesce(sum(amount)  filter (where counts_as_income), 0)                                      as income,
      coalesce(sum(amount)  filter (where exclusion_reason = 'passthrough'), 0)                      as passthrough_retained,
      coalesce(sum(-amount) filter (where classified_by = 'unmatched' and amount < 0), 0)            as unclassified
    from transactions where period_start = ${periodStart}
  `

  const bands: SieveBand[] = [
    {
      key: 'passthrough',
      label: 'Passed through to Hnry',
      because: 'Gross pay that was never mine. Only the retained difference counts as income.',
      amount: num(row?.passthrough),
    },
    {
      key: 'card_payment',
      label: 'Card and mortgage payments',
      because:
        'Settlements, not costs. The purchases and the mortgage interest they pay off are already counted below.',
      amount: num(row?.card_payment),
    },
    {
      key: 'internal_transfer',
      label: 'Between my own accounts',
      because: 'Moved, not spent.',
      amount: num(row?.internal_transfer),
    },
    {
      key: 'unidentified',
      label: 'Unidentified',
      because: 'The descriptor carries nothing to categorise on.',
      amount: num(row?.unidentified),
    },
    {
      key: 'non_consumption',
      label: 'Investing and transfers',
      because: 'Real outflows, but saving rather than spending. Counted separately, never hidden.',
      amount: num(row?.non_consumption),
    },
    {
      key: 'living',
      label: 'Living costs',
      because: 'What I actually spent.',
      amount: num(row?.living),
    },
  ]

  return {
    bands,
    totalOut: bands.reduce((sum, band) => sum + band.amount, 0),
    living: num(row?.living),
    income: num(row?.income),
    passthroughRetained: num(row?.passthrough_retained),
    unclassified: num(row?.unclassified),
  }
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export type TrendPoint = {
  periodStart: string
  periodEnd: string
  living: number
  nonConsumption: number
  income: number
}

export async function getTrend(limit = 13): Promise<TrendPoint[]> {
  const rows = await db<
    { period_start: Date; period_end: Date; living: string; non_consumption: string; income: string }[]
  >`
    select period_start, period_end,
      coalesce(sum(-amount) filter (where counts_as_spend), 0) as living,
      coalesce(sum(-amount) filter (where exclusion_reason is null
                                     and category_kind = 'expense'
                                     and not is_consumption), 0) as non_consumption,
      coalesce(sum(amount)  filter (where counts_as_income), 0) as income
    from transactions
    group by period_start, period_end
    order by period_start desc
    limit ${limit}
  `

  return rows
    .map((row) => ({
      periodStart: row.period_start.toISOString().slice(0, 10),
      periodEnd: row.period_end.toISOString().slice(0, 10),
      living: num(row.living),
      nonConsumption: num(row.non_consumption),
      income: num(row.income),
    }))
    .reverse()
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type CategoryTotal = {
  categoryId: string | null
  category: string
  kind: 'expense' | 'income'
  isConsumption: boolean
  amount: number
  count: number
  averagePerPeriod: number
}

export async function getCategoryTotals(periodStart: string | null): Promise<CategoryTotal[]> {
  const rows = await db<
    {
      category_id: string | null
      category: string | null
      category_kind: 'expense' | 'income' | null
      is_consumption: boolean
      amount: string
      count: string
      average_per_period: string
    }[]
  >`
    with periods as (
      select count(distinct period_start)::numeric as n from transactions
    ),
    totals as (
      select category_id, category, category_kind, is_consumption,
             sum(-amount) as amount, count(*) as count
      from transactions
      where exclusion_reason is null and category_kind = 'expense'
        ${periodStart ? db`and period_start = ${periodStart}` : db``}
      group by 1, 2, 3, 4
    ),
    lifetime as (
      select category_id, sum(-amount) / nullif((select n from periods), 0) as average_per_period
      from transactions
      where exclusion_reason is null and category_kind = 'expense'
      group by 1
    )
    select t.*, coalesce(l.average_per_period, 0) as average_per_period
    from totals t left join lifetime l on l.category_id = t.category_id
    order by t.amount desc
  `

  return rows.map((row) => ({
    categoryId: row.category_id,
    category: row.category ?? 'Uncategorised',
    kind: row.category_kind ?? 'expense',
    isConsumption: row.is_consumption,
    amount: num(row.amount),
    count: Number(row.count),
    averagePerPeriod: num(row.average_per_period),
  }))
}

export async function getCategories(): Promise<
  { id: string; name: string; kind: 'expense' | 'income'; isConsumption: boolean }[]
> {
  const rows = await db<
    { id: string; name: string; kind: 'expense' | 'income'; is_consumption: boolean }[]
  >`select id, name, kind, is_consumption from categories order by kind, sort_order`

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    isConsumption: row.is_consumption,
  }))
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export type TransactionRow = {
  id: string
  date: string
  description: string
  merchant: string | null
  amount: number
  account: string
  category: string | null
  categoryId: string | null
  exclusionReason: ExclusionReason | null
  classifiedBy: 'rule' | 'override' | 'unmatched'
  isRecurring: boolean
  countsAsSpend: boolean
}

export type TransactionFilters = {
  periodStart?: string | null
  categoryId?: string | null
  search?: string | null
  minAmount?: number | null
  onlyUnmatched?: boolean
  limit?: number
}

export async function getTransactions(filters: TransactionFilters = {}): Promise<TransactionRow[]> {
  const { periodStart, categoryId, search, minAmount, onlyUnmatched, limit = 300 } = filters

  const rows = await db<
    {
      id: string
      date: Date
      description: string
      merchant_display_name: string | null
      amount: string
      account_name: string
      category: string | null
      category_id: string | null
      exclusion_reason: ExclusionReason | null
      classified_by: 'rule' | 'override' | 'unmatched'
      is_recurring: boolean
      counts_as_spend: boolean
    }[]
  >`
    select id, date, description, merchant_display_name, amount, account_name,
           category, category_id, exclusion_reason, classified_by, is_recurring, counts_as_spend
    from transactions
    where true
      ${periodStart ? db`and period_start = ${periodStart}` : db``}
      ${categoryId ? db`and category_id = ${categoryId}` : db``}
      ${search ? db`and (description ilike ${'%' + search + '%'} or merchant_display_name ilike ${'%' + search + '%'})` : db``}
      ${minAmount ? db`and abs(amount) >= ${minAmount}` : db``}
      ${onlyUnmatched ? db`and classified_by = 'unmatched'` : db``}
    order by date desc, id
    limit ${limit}
  `

  return rows.map((row) => ({
    id: row.id,
    date: row.date.toISOString().slice(0, 10),
    description: row.description,
    merchant: row.merchant_display_name,
    amount: num(row.amount),
    account: row.account_name,
    category: row.category,
    categoryId: row.category_id,
    exclusionReason: row.exclusion_reason,
    classifiedBy: row.classified_by,
    isRecurring: row.is_recurring,
    countsAsSpend: row.counts_as_spend,
  }))
}

// ---------------------------------------------------------------------------
// Recurring
// ---------------------------------------------------------------------------

export type RecurringRow = {
  merchant: string
  category: string | null
  isConsumption: boolean
  cadenceDays: number
  chargeCount: number
  averageAmount: number
  lastCharged: string
  daysSinceLast: number
  possiblyCancelled: boolean
  isPayg: boolean
  monthlyEquivalent: number
}

export async function getRecurring(): Promise<RecurringRow[]> {
  const rows = await db<
    {
      merchant: string
      category: string | null
      is_consumption: boolean
      cadence_days: number
      charge_count: string
      average_amount: string
      last_charged: Date
      days_since_last: string
      is_payg: boolean
    }[]
  >`
    select
      merchant_display_name as merchant,
      max(category)         as category,
      bool_and(is_consumption) as is_consumption,
      max(recurrence_days)  as cadence_days,
      count(*)              as charge_count,
      avg(-amount)          as average_amount,
      max(date)             as last_charged,
      (current_date - max(date)) as days_since_last,
      bool_or(is_payg)      as is_payg
    from transactions
    where is_recurring
    group by merchant_display_name
    order by avg(-amount) * (30.0 / nullif(max(recurrence_days), 0)) desc
  `

  return rows.map((row) => {
    const cadenceDays = Number(row.cadence_days) || 30
    const daysSinceLast = Number(row.days_since_last)
    const averageAmount = num(row.average_amount)

    return {
      merchant: row.merchant,
      category: row.category,
      isConsumption: row.is_consumption,
      cadenceDays,
      chargeCount: Number(row.charge_count),
      averageAmount,
      lastCharged: row.last_charged.toISOString().slice(0, 10),
      daysSinceLast,
      // Overdue by more than twice its own rhythm. PAYG merchants are exempt:
      // they charge on a cycle-ish rhythm but stopping is not a cancellation.
      possiblyCancelled: !row.is_payg && daysSinceLast > cadenceDays * 2,
      isPayg: row.is_payg,
      monthlyEquivalent: (averageAmount * 30) / cadenceDays,
    }
  })
}

// ---------------------------------------------------------------------------
// Large purchases
// ---------------------------------------------------------------------------

export type LargePurchaseSummary = {
  rows: TransactionRow[]
  total: number
  shareOfLiving: number
}

export async function getLargePurchases(
  threshold: number,
  periodStart: string | null,
): Promise<LargePurchaseSummary> {
  const rows = await getTransactions({ periodStart, minAmount: threshold, limit: 500 })
  const purchases = rows.filter((row) => row.countsAsSpend && row.amount < 0)
  const total = purchases.reduce((sum, row) => sum + Math.abs(row.amount), 0)

  const [totals] = await db<{ living: string }[]>`
    select coalesce(sum(-amount) filter (where counts_as_spend), 0) as living
    from transactions
    where true ${periodStart ? db`and period_start = ${periodStart}` : db``}
  `

  const living = num(totals?.living)

  return { rows: purchases, total, shareOfLiving: living > 0 ? total / living : 0 }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type StaleAccount = {
  name: string
  source: 'akahu' | 'csv'
  daysSinceTransaction: number | null
  daysSinceSync: number | null
}

export type Health = {
  transactions: number
  unmatched: number
  coverage: number
  drift: number
  lastSynced: string | null
  stale: StaleAccount[]
  accounts: { name: string; institution: string | null; balance: number; oldest: string | null }[]
}

export async function getHealth(): Promise<Health> {
  const [recon] = await db<Record<string, string>[]>`
    select raw_count, unmatched_count,
           net_cash - (income_signed + spend_signed + non_consumption_signed
                       + excluded_signed + unclassified_signed) as drift
    from reconciliation
  `

  const accounts = await db<
    { name: string; institution: string | null; current_balance: string; oldest_transaction_date: Date | null; last_synced_at: Date | null }[]
  >`select name, institution, current_balance, oldest_transaction_date, last_synced_at from accounts order by name`

  const staleRows = await db<
    {
      name: string
      source: 'akahu' | 'csv'
      days_since_transaction: number | null
      days_since_sync: number | null
    }[]
  >`
    select name, source, days_since_transaction, days_since_sync
    from account_health where is_stale order by source, name
  `

  const total = Number(recon?.raw_count ?? 0)
  const unmatched = Number(recon?.unmatched_count ?? 0)
  const lastSynced = accounts
    .map((a) => a.last_synced_at)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0]

  return {
    transactions: total,
    unmatched,
    coverage: total === 0 ? 1 : 1 - unmatched / total,
    drift: num(recon?.drift),
    lastSynced: lastSynced?.toISOString() ?? null,
    stale: staleRows.map((row) => ({
      name: row.name,
      source: row.source,
      daysSinceTransaction: row.days_since_transaction,
      daysSinceSync: row.days_since_sync,
    })),
    accounts: accounts.map((a) => ({
      name: a.name,
      institution: a.institution,
      balance: num(a.current_balance),
      oldest: a.oldest_transaction_date?.toISOString().slice(0, 10) ?? null,
    })),
  }
}
