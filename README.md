# Ledger

Personal finance tracking for a Wellington contractor. Pulls transactions from
Akahu daily, classifies them from an editable rule set, and reports what was
actually spent as distinct from what merely moved.

Next.js (App Router, TypeScript), Postgres, self-hosted on Coolify. Six runtime
dependencies: `next`, `react`, `react-dom`, `postgres`, and the two halves of
`@simplewebauthn` for passkeys.

## Status

| Step                                     | State                     |
| ---------------------------------------- | ------------------------- |
| 1. Schema, migrations, seeded rules      | done                      |
| 2. Akahu client and backfill             | done                      |
| 3. Categorisation engine + tests         | done (built out of order) |
| 4. Scheduled sync                        | done                      |
| 5. UI                                    | done                      |
| 6. Sign-in                               | done                      |

Running on real data: 1,289 transactions from eight Akahu accounts plus 375
imported from the Flight Centre Mastercard CSV.

## Signing in

`APP_PASSWORD` is the whole configuration. Set it and every route is gated;
leave it unset and the app is open, which is what running locally against a
throwaway database wants. It is read on every request rather than at module
load, so an image built without secrets and run with them behaves the way its
environment says it should.

There are no accounts, no email, no registration and no user table. One
household, one password.

**The session cookie carries no secret and needs no second environment
variable.** It is a signed ticket — a payload, an expiry, and an HMAC over both,
keyed by `APP_PASSWORD` itself. Three things follow, and they are the reason
there is no `SESSION_SECRET`:

- a stolen cookie is a stolen session, not a stolen password;
- there is nothing extra to distribute, or to forget to set;
- changing the password signs every device out, for free.

Signed with Web Crypto rather than `node:crypto`, because the same code runs in
middleware and in server actions and only one of those has Node's crypto.
`tests/auth.test.ts` covers every way a ticket can be wrong.

### Passkeys

A passkey is a faster way to present the same fact, so the password stays the
root of trust: **registration is only allowed to someone already signed in**,
checked inside the registration action itself and not merely by the route guard.
Every registered credential therefore descends from someone who knew the
password. Manage them on the Accounts page.

Only public keys are stored — `db/migrations/0008_passkeys.sql`. Sign-in uses
discoverable credentials, so the browser is asked for whatever it holds rather
than being handed a list of registered credential ids. The relying party is
derived from the request host (honouring `x-forwarded-*`), which is what makes
localhost, a LAN address and the real domain all work without configuration.
`WEBAUTHN_RP_ID` overrides it for a deployment answering on several hostnames.

Passkeys need a **secure context**. Over plain http on a LAN address the browser
will not offer them at all, and the add-passkey button says so rather than
failing mysteriously.

The same caveat has a sharper edge for the password: the session cookie is
`Secure` in production, so a production build served over plain http on a LAN
address cannot store it, and signing in bounces silently back to the login page.
Serve it over https, or over `localhost`, which browsers treat as trustworthy.

### The gate

One middleware, so page loads, form posts, server actions and RSC payloads are
all covered and no page has to remember to check. Only `/login` and static
assets are exempt.

- Non-GET requests get a **401 rather than a redirect**. Redirecting a POST
  would replay it against the login page.
- Where you were going is preserved in `?next=` and returned to afterwards,
  accepted only as a path beginning with a single `/` so the login page cannot
  bounce anyone to a lookalike domain.
- Password attempts are rate limited to eight a minute, in memory, keyed on the
  **rightmost** `x-forwarded-for` entry — clients can send that header
  themselves and proxies append rather than replace, so the leftmost value is
  attacker-chosen. Passkey assertions are not limited; they cannot be guessed.

The login page renders outside the app shell. The nav rail reports transaction
counts and whether the ledger reconciles, and those must not appear on the one
page a stranger can reach — hence the `(app)` route group, which changes no URLs.

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

`APP_PASSWORD` is left unset there on purpose: locally the app is open. Set it
when you want to work on the login page, and reach the app on `localhost` rather
than a LAN address if you want to exercise passkeys — they need a secure
context, and `http://localhost` counts as one while `http://192.168.x.x` does
not.

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
| `npm run icons`      | redraws `public/icons` from `scripts/make-icons.ts`. Rarely.         |
| `npm test`           | engine, cadence, budget, dashboard, auth and reconciliation tests. Needs `DATABASE_URL`. |

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
scripts/make-icons.ts            draws public/icons; run by hand, output checked in
public/manifest.webmanifest      what makes the home-screen install a real app
src/lib/categorise.ts            the engine: rules in, verdict out. Pure.
src/lib/recurring.ts             cadence detection from the gaps between charges
src/lib/queries.ts               every SQL query the pages use
src/lib/budget.ts                budget verdicts: on track, ahead of pace, over
src/lib/dashboard.ts             the front page's headline figures and commentary
src/lib/auth/ticket.ts           signed tickets: the session and both challenges
src/lib/auth/session.ts          the APP_PASSWORD switch and the session cookie
src/lib/auth/webauthn.ts         the two passkey ceremonies
src/lib/auth/passkeys.ts         the passkeys table, and nothing else
src/middleware.ts                the gate every request passes through
src/app/(app)/                   the six pages, and the shell they render in
src/app/login/                   the one page that renders without the shell
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

## The dashboard

The front page opens on one figure - what the budget has left - and the sentence
that reads it, beside the period drawn as its days. Then what came in, what was
spent and what was put away, each measured against the same point in previous
periods. Then a short list of what is worth saying about the period, and only
then the detail: the budgets running past their pace, what has come through in
the last few days, and every period as what went out against what came in.

The day tape is deliberate. A running total answers "how much" and hides "when",
and thirty even days and one expensive Saturday are not the same month. Days
that have happened are solid columns of what they cost; days still to come are
hollow ones at whatever the budget leaves per remaining day, drawn at the same
scale, so "can I keep doing what I have been doing" is answered by looking
rather than by dividing.

Comparing against the same day of prior periods matters most for income, not
least. Pay arrives in one or two lumps near the end of a period, so on day
twenty "earned" is not a small number - it is a number that has not happened
yet, and only the same day of previous periods can tell the two apart.

The forecast is not a straight-line pro-rate. It scales what has been spent by
how much of a *normal* period is already behind us, taken from history: for the
budget, each category's own day-shaping weighted by its limit; for living costs,
the whole consumption total measured against itself. Early in a period, when
that share is under 15%, there is no forecast at all rather than a number
manufactured out of the first few days.

The commentary in `src/lib/dashboard.ts` is a set of rules, each with a
threshold under which it stays quiet, ranked and capped at four. A dashboard
that always has four things to tell you has nothing to tell you. Categories with
no limit set are included: they still have a history, and this is the only place
one gets measured against it.

Both the figures and the sentences are pure functions over data the page has
already fetched, so `tests/dashboard.test.ts` pins down what the app is willing
to assert about someone's money without needing a database.

## On a phone

The app is meant to be installed to a home screen, so it ships a manifest, a
set of icons and a `standalone` display mode: launched from the tile it opens
without browser chrome, under its own name, on its own theme colour.

Below 760px the nav rail stops being a rail. Its seven links used to become a
row that scrolled sideways, which hid the last two behind an edge with nothing
to say they were there — so the five links worth having under a thumb move to a
fixed tab bar at the bottom of the screen, and Large purchases, Accounts and
sign-out become icons in the top bar. Both navs read from one list in
`src/components/rail.tsx`; there is nothing to keep in sync.

The rest is the usual phone tax, and each piece is commented where it lives:
`dvh` instead of `vh`, `env(safe-area-inset-*)` under the tab bar and over the
top bar, 16px text fields so iOS does not zoom the page in on focus and leave
it there, and one column dropped from the transactions table — the account,
which is the least-asked question on that page — before it starts to scroll.

`public/icons` is checked in and drawn by `npm run icons`, for the same reason
`src/fonts` is checked in: a production build should not have to generate
anything it can be handed. The manifest and the icons are also excluded from
the gate in `src/middleware.ts`, because they are fetched to install the app —
sometimes by the OS, without the session cookie — and a gated manifest installs
the login page under the wrong name with a screenshot for an icon.

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
`AKAHU_USER_TOKEN`, `AKAHU_APP_ID_TOKEN` and — since this one is reachable from
the internet — `APP_PASSWORD`. Without it every page is open to anyone with the
URL. Set it as a runtime variable, not a build argument; it is read per request,
and the build has no business holding it.

`WEBAUTHN_RP_ID` only matters if the deployment answers on more than one
hostname; otherwise the relying party comes from the request.

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
- Standalone traces imports, and nothing imports `public/` — the manifest and
  the icons are only ever named in a `<link>`. The Dockerfile copies that
  directory in too. Left out, the app serves perfectly and the only symptom is
  that installing it to a home screen gets the wrong name and no icon.

## Secrets

`.env.example` is committed. `.env` is not, and neither is anything else
matching `.env.*`. No database credential is ever exposed to the browser: the
Next.js server is the only thing that opens a socket to Postgres.

`APP_PASSWORD` never leaves the server either. It is compared against what was
typed, and used as an HMAC key; nothing derived from it that reaches the browser
can be run backwards into it. Nothing in `src/lib/auth/` outside the ticket
module handles it at all.
