-- "Today" means today in New Zealand.
--
-- `current_date` is the date in the *session's* time zone, and every session
-- this app opens is UTC: the container, the Postgres image, and the deployed
-- database all default to it. So from midnight until noon New Zealand time -
-- half of every waking day - `current_date` is yesterday, and three things go
-- wrong at once:
--
--   * On the 16th, the day a statement period opens, the dashboard spends the
--     whole morning showing the period that closed the night before.
--   * `elapsed_days` is short by one, so pace and forecast divide this period's
--     spending by the wrong number of days and report it running low.
--   * Staleness and "days since last charge" are each a day out, which is
--     enough to flip a subscription in and out of "possibly cancelled".
--
-- settings.timezone has been sitting in the schema since 0003 without a single
-- reader. This is that reader.

create or replace function app_today()
returns date
language sql
stable
as $$
  select (now() at time zone (select timezone from settings limit 1))::date;
$$;

comment on function app_today() is
  'Today''s date in settings.timezone. Use this instead of current_date, which is the date in the connecting session''s time zone and is therefore UTC.';

grant execute on function app_today() to finance_web, finance_sync;

-- ---------------------------------------------------------------------------
-- account_health, rebuilt on the New Zealand day
-- ---------------------------------------------------------------------------

-- Unchanged from 0006 apart from current_date becoming app_today(). The
-- interval arithmetic on last_synced_at is left alone: it subtracts one
-- timestamptz from another, which is a duration and has no time zone in it.

drop view account_health;

create view account_health with (security_invoker = on) as
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
left join transactions_raw r on r.account_id = a.id
where a.is_active
group by a.id, a.name, a.institution, a.source, a.current_balance,
         a.oldest_transaction_date, a.stale_after_days, a.last_synced_at;

comment on view account_health is
  'is_stale means the source is not being kept current, not that the account is idle. Akahu accounts are judged on last_synced_at, CSV accounts on the newest transaction imported.';

grant select on account_health to finance_web, finance_sync;

-- ---------------------------------------------------------------------------
-- Re-dating the Akahu history that was ingested in UTC
-- ---------------------------------------------------------------------------

-- Every Akahu row was dated by taking the first ten characters of a UTC
-- instant, so anything that happened before noon New Zealand time is recorded a
-- day early. The instant itself was kept verbatim in `raw`, so the correct date
-- can be recovered rather than guessed.
--
-- This rewrites the ledger, which is not something to do lightly - but the rows
-- it touches are the ones already carrying the wrong day, and leaving them
-- would mean history and anything synced from here on disagree about what a
-- date means. Rows whose date is already right are not touched.
--
-- revised_at is deliberately not stamped. It records that Akahu corrected the
-- payload, and Akahu did not: the payload is byte-for-byte what it always was,
-- and this is the app correcting how it reads it.
--
-- CSV rows are left alone: those dates were read from a printed statement that
-- was already in New Zealand terms and never went near a time zone.

update transactions_raw r
set date = ((r.raw ->> 'date')::timestamptz at time zone
              (select timezone from settings limit 1))::date
where r.source = 'akahu'
  and r.raw ? 'date'
  and ((r.raw ->> 'date')::timestamptz at time zone
         (select timezone from settings limit 1))::date is distinct from r.date;

-- Backfill provenance is a restatement of the same dates, so it moves with them.
update accounts a
set oldest_transaction_date = m.oldest
from (
  select account_id, min(date) as oldest from transactions_raw group by account_id
) m
where m.account_id = a.id
  and a.source = 'akahu'
  and a.oldest_transaction_date is distinct from m.oldest;

-- Period membership is derived from `date` by the transactions view, so moved
-- rows re-file themselves. The enrichment layer is keyed on transaction id and
-- is unaffected, except for cadence detection, which reads dates - run
-- `npm run recompute` after this migration to settle it.
