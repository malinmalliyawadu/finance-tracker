-- Reconciliation counted the rules layer, not the answer the app displays.
--
-- The `transactions` view resolves a manual override against the rule output in
-- a lateral called `eff`, and everything the UI reads comes from that resolved
-- answer. The `reconciliation` view did not. It mixed the two layers in one
-- expression list: the income and spend buckets filtered on `t.counts_as_*`,
-- which is override-aware, while the excluded, non-consumption and unclassified
-- buckets filtered on `e.exclusion_reason` and `e.classified_by`, which are the
-- raw rule output with the override still unapplied.
--
-- So the five buckets stopped being a partition the moment an override changed
-- whether a transaction was excluded, which is the single most common thing an
-- override does:
--
--   * Exclude by hand something the rules had categorised. Effective exclusion
--     is set, so it is no longer income or spend; enriched exclusion is still
--     null, so it is not in `excluded` either. The row lands in no bucket and
--     its whole amount goes missing from the identity.
--   * Force-include, or recategorise, something the rules had excluded. It is
--     income or spend by the effective answer and excluded by the enriched one,
--     so it lands in two buckets and is counted twice.
--
-- Neither is a data problem. `npm run recompute` cannot fix it and no amount of
-- rule editing makes it go away, because the drift is created by the view at
-- read time. It is proportional to the overrides a human has written, so it
-- grows exactly as the ledger gets more hand-corrected.
--
-- The rewrite below reads the effective layer and only the effective layer, and
-- assigns the bucket in one `case` rather than in five independent filters.
-- That is the part that matters: five filters have to be checked against each
-- other to know they are disjoint and exhaustive, and this pair drifted apart
-- silently when the override layer was added. A `case` has exactly one arm per
-- row and an `else`, so "every transaction lands in exactly one bucket" is a
-- property of the expression instead of a claim in a comment.
--
-- `unmatched_count` moves to the effective layer with everything else, so it
-- now counts a row as unmatched only if no rule matched it *and* no human
-- classified it. It also picks up rows with no enriched row at all, which the
-- old `e.classified_by = 'unmatched'` silently read as null and skipped, so
-- coverage on the dashboard was overstated whenever a recompute was outstanding.

drop view reconciliation;

create view reconciliation with (security_invoker = on) as
select
  count(*)                                                as raw_count,
  count(*) filter (where e.transaction_id is null)        as unenriched_count,
  count(*) filter (where t.classified_by = 'unmatched')   as unmatched_count,
  coalesce(sum(t.amount), 0)                              as net_cash,
  coalesce(sum(t.amount) filter (where b.bucket = 'income'), 0)          as income_signed,
  coalesce(sum(t.amount) filter (where b.bucket = 'spend'), 0)           as spend_signed,
  coalesce(sum(t.amount) filter (where b.bucket = 'non_consumption'), 0) as non_consumption_signed,
  coalesce(sum(t.amount) filter (where b.bucket = 'excluded'), 0)        as excluded_signed,
  coalesce(sum(t.amount) filter (where b.bucket = 'unclassified'), 0)    as unclassified_signed,
  coalesce(sum(t.amount) filter (where t.exclusion_reason = 'passthrough' and t.amount > 0), 0) as passthrough_in,
  coalesce(sum(t.amount) filter (where t.exclusion_reason = 'passthrough' and t.amount < 0), 0) as passthrough_out
from transactions t
left join transactions_enriched e on e.transaction_id = t.id
cross join lateral (
  -- Order is the definition. Exclusion wins over everything, because an
  -- excluded row keeps no category; then no category at all is unclassified;
  -- then the three ways a classified row can count.
  select case
    when t.exclusion_reason is not null then 'excluded'
    when t.category_id is null          then 'unclassified'
    when t.category_kind = 'income'     then 'income'
    when t.is_consumption               then 'spend'
    else                                     'non_consumption'
  end as bucket
) b;

comment on view reconciliation is
  'net_cash must equal income_signed + spend_signed + non_consumption_signed + excluded_signed + unclassified_signed. All figures keep the Akahu sign convention, so spend_signed is negative, and all of them read the effective classification - rules with overrides applied - so a hand-written override cannot move a transaction out of one bucket without moving it into another.';

grant select on reconciliation to finance_web, finance_sync;
