-- Deleting a transaction by hand.
--
-- Some rows should not be in the ledger at all: a duplicate the provider sent
-- twice under two ids, a pending authorisation that never settled, a test
-- charge that was reversed off-statement. Excluding them is the wrong tool -
-- an exclusion says "this is money that moved but does not count", and these
-- are rows where no money moved.
--
-- Hard deletion does not work here for two reasons. The ledger is append-only
-- and only the sync role may write it, so the web role cannot delete a raw row
-- even if it wanted to. And every source re-sends what it already sent: the
-- Akahu sync upserts the same window each night, and every Gem CSV export
-- overlaps the last. A row deleted from transactions_raw would be quietly
-- reinserted the next morning, and the deletion would look like it never
-- happened.
--
-- So a deletion is a tombstone, exactly as a recategorisation is an override:
-- a separate table the UI writes, resolved at read time by the `transactions`
-- view, that no sync or recompute reads and therefore cannot undo. The raw row
-- stays, which keeps the ledger a truthful record of what the provider
-- returned, and makes the deletion reversible.

create table deleted_transactions (
  transaction_id uuid primary key references transactions_raw (id) on delete cascade,
  deleted_at     timestamptz not null default now(),
  note           text
);

comment on table deleted_transactions is
  'Rows a human removed from the ledger by hand. The raw row is kept; the transactions view hides it. Re-syncs and re-imports upsert on the natural key and so cannot resurrect a deleted row.';

-- ---------------------------------------------------------------------------
-- transactions: hide deleted rows from everything the app reads
-- ---------------------------------------------------------------------------

-- Same columns in the same order, so `reconciliation` on top of it stays valid
-- and this can be `create or replace` rather than a drop-and-rebuild.
create or replace view transactions with (security_invoker = on) as
select
  r.id,
  r.external_id,
  r.source,
  r.account_id,
  a.name                     as account_name,
  a.institution,
  r.date,
  r.description,
  r.amount,
  statement_period_start(r.date, s.statement_start_day)                        as period_start,
  statement_period_end(statement_period_start(r.date, s.statement_start_day))  as period_end,
  eff.category_id,
  c.name                     as category,
  c.kind                     as category_kind,
  coalesce(c.is_consumption, false) as is_consumption,
  e.merchant_display_name,
  eff.exclusion_reason,
  e.is_recurring,
  e.is_payg,
  e.is_one_off,
  e.recurrence_days,
  e.rule_id,
  eff.classified_by,
  (o.transaction_id is not null) as is_overridden,
  (eff.exclusion_reason is null and c.kind = 'expense' and c.is_consumption) as counts_as_spend,
  (eff.exclusion_reason is null and c.kind = 'income')                       as counts_as_income
from transactions_raw r
join accounts a               on a.id = r.account_id
cross join settings s
left join transactions_enriched e on e.transaction_id = r.id
left join overrides o             on o.transaction_id = r.id
cross join lateral (
  select
    case
      when o.category_id is not null      then o.category_id
      when o.exclusion_reason is not null then null
      else e.category_id
    end as category_id,
    case
      when o.category_id is not null      then null
      when o.exclusion_reason is not null then o.exclusion_reason
      when o.force_included               then null
      else e.exclusion_reason
    end as exclusion_reason,
    case
      when o.transaction_id is not null then 'override'::classified_by
      else coalesce(e.classified_by, 'unmatched'::classified_by)
    end as classified_by
) eff
left join categories c            on c.id = eff.category_id
where not exists (select 1 from deleted_transactions d where d.transaction_id = r.id);

-- `reconciliation` reads only through `transactions`, so a deleted row leaves
-- every bucket and net cash together and the identity keeps holding.

-- ---------------------------------------------------------------------------
-- account_health: a deleted row is not evidence the account is up to date
-- ---------------------------------------------------------------------------

-- Unchanged from 0009 apart from the join condition. Without it a CSV account
-- whose newest row had been deleted would still look current, and the count
-- would include rows the app no longer shows.
create or replace view account_health with (security_invoker = on) as
select
  a.id,
  a.name,
  a.institution,
  a.source,
  a.current_balance,
  a.oldest_transaction_date,
  a.stale_after_days,
  a.last_synced_at,
  max(r.date)                                  as latest_transaction,
  (app_today() - max(r.date))                  as days_since_transaction,
  extract(day from now() - a.last_synced_at)::integer as days_since_sync,
  count(r.id)                                  as transaction_count,
  case
    when a.source = 'csv' then
      coalesce(app_today() - max(r.date), 9999) > a.stale_after_days
    else
      a.last_synced_at is null
      or now() - a.last_synced_at > make_interval(days => a.stale_after_days)
  end as is_stale
from accounts a
left join transactions_raw r
  on r.account_id = a.id
  and not exists (select 1 from deleted_transactions d where d.transaction_id = r.id)
where a.is_active
group by a.id, a.name, a.institution, a.source, a.current_balance,
         a.oldest_transaction_date, a.stale_after_days, a.last_synced_at;

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------

-- The UI writes and unwrites tombstones; nothing else does. The sync role can
-- read them (0004's default privileges) but never write, so a sync cannot
-- undelete any more than it can un-override.
grant select on deleted_transactions to finance_web, finance_sync;
grant insert, delete on deleted_transactions to finance_web;
