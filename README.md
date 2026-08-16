# Ledger

Personal finance tracking for a Wellington contractor. Pulls transactions from
Akahu daily, classifies them from an editable rule set, and reports what was
actually spent as distinct from what merely moved.

Next.js (App Router, TypeScript), Postgres, self-hosted on Coolify. Four runtime
dependencies: `next`, `react`, `react-dom`, `postgres`.

## Status

| Step                                     | State                     |
| ---------------------------------------- | ------------------------- |
| 1. Schema, migrations, seeded rules      | done                      |
| 2. Akahu client and backfill             | done                      |
| 3. Categorisation engine + tests         | done (built out of order) |
| 4. Scheduled sync                        | done                      |
| 5. UI                                    | done                      |

> **The app has no authentication.** Anyone who can reach the URL sees every
> figure in it. This is a deliberate, deferred decision — put Basic Auth on the
> Coolify proxy, or keep it off the public internet, until it is addressed.

Running on real data: 1,289 transactions from eight Akahu accounts plus 375
imported from the Flight Centre Mastercard CSV.

## Two sources

Akahu has no integration for the Latitude/Gem Flight Centre Mastercard, so that
account is a manual CSV export. Everything downstream is source-agnostic —
`transactions_raw.source` is `akahu` or `csv`, and the natural key is
`(source, external_id)`.

This matters for correctness, not just tidiness. The Kiwibank side of a Gem card
payment is excluded as a `card_payment` because the purchases it settles are
counted on the card. If the CSV stops being imported, those purchases do not
exist, the payment is still excluded, and spending is silently understated. The
`account_health` view exists to make that visible: a CSV account is stale after
35 days, an Akahu account after 3.

```bash
npm run import:csv -- ~/Downloads/transactions.csv --dry-run
npm run import:csv -- ~/Downloads/transactions.csv
```

Safe to re-run on the whole file. Each row's key hashes the original CSV line,
so overlapping exports insert nothing.

## Local setup

```bash
npm install
cp .env.example .env
docker run -d --name finance-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=finance -p 54322:5432 postgres:17
npm run db:reset        # apply every migration from zero
npm run seed:rules      # categories, rules and aliases from the JSON
npm run seed:demo       # twelve months of synthetic transactions
npm run recompute       # classify them
npm run dev
```

With that `.env`:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/finance
```

## Scripts

| Command              | Does                                                                |
| -------------------- | ------------------------------------------------------------------- |
| `npm run db:migrate` | applies outstanding migrations                                       |
| `npm run db:reset`   | drops the schema and rebuilds from zero                              |
| `npm run seed:rules` | loads categories, rules and aliases; idempotent                      |
| `npm run seed:demo`  | twelve months of synthetic transactions, all prefixed `demo_`        |
| `npm run backfill`   | pulls every Akahu account; `--years N`, `--dry-run`                  |
| `npm run sync`       | the daily job: fetch, classify, report; `--days N`, `--refresh`      |
| `npm run import:csv` | imports a Latitude/Gem statement; `--dry-run`                        |
| `npm run recompute`  | rebuilds `transactions_enriched` from raw + rules. Fetches nothing.  |
| `npm run typecheck`  | `tsc --noEmit`                                                       |
| `npm test`           | engine, cadence, budget and reconciliation tests. Needs `DATABASE_URL`. |

`npm test` deliberately fails rather than skips when `DATABASE_URL` is unset:
the reconciliation assertions are meant to break CI, and a skipped test that
should have failed is worse than no test. CI needs a Postgres service, the
migrations applied, and `npm run seed:rules` run against it.

Demo data is trivially separable from real data:

```sql
delete from transactions_raw where external_id like 'demo_%';
```

## Layout

```
data/categorisation-rules.json   the rule set, source of truth for the seed
db/migrations/                   schema, checked in, applied in filename order
scripts/migrate.ts               ~60-line migration runner, no dependency
scripts/seed-rules.ts            idempotent loader for categories/rules/aliases
scripts/seed-demo.ts             synthetic transactions for development
scripts/recompute.ts             rebuilds the derived layer
src/lib/categorise.ts            the engine: rules in, verdict out. Pure.
src/lib/recurring.ts             cadence detection from the gaps between charges
src/lib/queries.ts               every SQL query the pages use
src/lib/budget.ts                budget verdicts: on track, ahead of pace, over
src/app/                         the six pages
docs/schema.md                   the schema and why it is shaped that way
```

## The rule set

`data/categorisation-rules.json` is the source of truth. Edit it and re-run
`npm run seed:rules`; the seed is idempotent and keyed on
`(rule_type, pattern, applies_to)`, so rule ids stay stable and existing
`rule_id` references survive. Patterns removed from the file are disabled rather
than deleted.

Rules can also be edited directly in the database. Those carry `source =
'manual'` and the seed leaves them alone.

Array order in the file is the evaluation order and is load-bearing: pharmacy is
tested before groceries, exclusions before every category. See
[docs/schema.md](docs/schema.md).

## Budgets

A budget is a limit per category, set on the Budget page and stored in
`budget_lines` as an amount plus the period it takes effect from. The figure in
force for a period is the newest line at or before it, so setting rent once
carries it forward and changing it in August leaves July judged against what was
actually in force at the time. Clearing a category leaves a null line, which is
a decision ("stop budgeting this") rather than an absence.

Nothing has to be filled in by hand to start: each box is pre-loaded with what
that category has actually cost per period over the last six, rounded to the
nearest ten, and one button fills every blank with it.

While a period is still running, each category is measured against what it has
historically spent by this day rather than against a straight-line pro-rate of
the limit. Rent lands on day one, so a linear budget line would call every fixed
cost a blowout for the first half of the month. Categories with no limit set are
listed separately rather than left out, since a budget covering most of the
spending and none of the surprises is the usual way one turns out to be wrong.

See [docs/schema.md](docs/schema.md) for why the table is versioned rather than
written per period.

## The daily sync

`scripts/sync.ts` is a CLI, not an HTTP endpoint. Nothing public triggers it,
there is no shared secret to leak, and a failure surfaces as a failed scheduled
task rather than a 500 nobody reads. It exits non-zero when any account fails.

It re-fetches a **14-day overlapping window** rather than resuming from the last
transaction seen. Akahu's `start` parameter is exclusive, banks post
transactions days late, and cards revise pending amounts after the fact — so
resuming exactly where the last run stopped silently drops rows. The upsert is
keyed on `(source, external_id)`, so the overlap costs nothing.

It always recomputes afterwards. New transactions sitting unclassified would
understate every figure on the dashboard until someone happened to notice.

Each run writes a `sync_runs` row with counts and the uncategorised total, and
logs one JSON object per line. A sync that silently stops returning transactions
shows up as a run with `new: 0`, not as silence.

## Deploying to Coolify

Two resources from this repo.

**1. Postgres.** Coolify's managed Postgres. Migrations apply themselves: the
container runs `scripts/migrate.ts` before it serves, so a deploy carrying a new
migration cannot come up against the old schema, and a migration that fails
stops the container rather than shipping pages that 500. Everything else is a
one-off, from the app container:

```bash
npm run seed:rules && npm run backfill && npm run recompute
```

Import the Flight Centre CSV separately — it is the one source nothing fetches.

**2. The app.** Dockerfile build, port 3000. Set `DATABASE_URL`,
`AKAHU_USER_TOKEN` and `AKAHU_APP_ID_TOKEN`.

Leave `PGSSLMODE` empty when Postgres shares a private network with the app,
which is the normal Coolify setup. Set `require` only when the connection leaves
the host — the default is off precisely so the common case works, and the
uncommon case has to be stated.

The **build** needs network access, because `next/font` downloads and self-hosts
the three fonts. The runtime does not.

**Scheduled task**, daily, in the app container:

```bash
node scripts/sync.ts
```

Optionally split the database credentials.
`db/migrations/0004_roles_and_grants.sql` creates `finance_web` and
`finance_sync` with different privileges — the web role cannot write the ledger,
the sync role cannot write rules or overrides. Grant them login and point
`DATABASE_URL_WEB` and `DATABASE_URL_SYNC` at them. Both fall back to
`DATABASE_URL` when unset.

### Things that broke when this was first built

Kept here because none of them were visible without actually building and
running the image, and CI now builds it on every push:

- The pool was constructed at module scope, so `next build` — which imports
  every route to collect page data, in an image with no database — failed.
- TLS defaulted to on for any non-localhost host, which 500s against Postgres on
  a private Docker network.
- Next's standalone output bundles `postgres` into the server chunks rather than
  leaving it in `node_modules`, so every script in the image failed to resolve
  it. The Dockerfile copies that one package back in.

## Secrets

`.env.example` is committed. `.env` is not, and neither is anything else
matching `.env.*`. No database credential is ever exposed to the browser: the
Next.js server is the only thing that opens a socket to Postgres.
