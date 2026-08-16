# Schema and the reasoning behind it

## The shape

```mermaid
erDiagram
    accounts            ||--o{ transactions_raw      : holds
    transactions_raw    ||--o| transactions_enriched : "derived, 1:1"
    transactions_raw    ||--o| overrides             : "manual verdict, 0:1"
    categories          ||--o{ rules                 : "a category rule assigns"
    categories          ||--o{ transactions_enriched : classifies
    categories          ||--o{ overrides             : classifies
    categories          ||--o{ budget_lines          : "is limited by"
    rules               ||--o{ transactions_enriched : "matched by"
    merchant_aliases    ||--o{ transactions_enriched : "named by"

    accounts {
        uuid   id PK
        text   akahu_id UK
        text   name
        text   institution
        numeric current_balance
        date   oldest_transaction_date "how far back Akahu actually went"
        timestamptz last_synced_at
    }
    transactions_raw {
        uuid   id PK
        text   akahu_id UK "natural key for idempotent upsert"
        uuid   account_id FK
        date   date
        text   description
        numeric amount "Akahu sign: negative = money out"
        jsonb  raw
        timestamptz revised_at "set only on a genuine upstream change"
    }
    transactions_enriched {
        uuid   transaction_id PK_FK
        uuid   category_id FK "null when excluded"
        text   merchant_display_name
        enum   exclusion_reason "null when categorised"
        bool   is_recurring
        bool   is_payg
        bool   is_one_off
        int    recurrence_days
        uuid   rule_id FK
        uuid   alias_id FK
        enum   classified_by "rule | override | unmatched"
    }
    rules {
        uuid   id PK
        int    priority "evaluation order, gaps of 10"
        enum   rule_type "passthrough_in|passthrough_out|exclusion|unidentified|category"
        text   pattern "case-insensitive regex"
        enum   applies_to "any | inflow | outflow"
        uuid   category_id FK
        enum   exclusion_reason
        bool   enabled
        text   source
    }
    categories {
        uuid   id PK
        text   name
        enum   kind "expense | income"
        bool   is_consumption "false = debt principal, investing, transfers"
    }
    merchant_aliases {
        uuid   id PK
        int    priority
        text   pattern UK
        text   display_name
        bool   is_payg
    }
    overrides {
        uuid   transaction_id PK_FK
        uuid   category_id FK
        enum   exclusion_reason
        bool   force_included
        text   note
    }
    budget_lines {
        uuid    id PK
        uuid    category_id FK
        date    effective_from "the period this figure starts applying to"
        numeric amount "null = deliberately not budgeted from here on"
        text    note
    }
    settings {
        bool   id PK "singleton"
        int    statement_start_day "16"
        numeric large_purchase_threshold
        text   timezone
    }
    sync_runs {
        uuid   id PK
        text   trigger
        enum   status
        int    accounts_synced
        int    transactions_new
        int    uncategorised_count
        jsonb  details
    }
    passkeys {
        text   credential_id PK "as the authenticator issued it, base64url"
        bytea  public_key "verification only; signs nothing"
        bigint counter "clone check, written back after each assertion"
        text   label "typed by a human, not sniffed from the user agent"
        text   device_type
        bool   backed_up
    }
```

`passkeys` joins to nothing on purpose — there is no users table. See
[below](#passkeys-hangs-off-nothing-because-there-is-nobody-to-hang-it-off).

## Why it is split this way

### One line separates everything: fetched vs derived

`transactions_raw` is the only table that costs an API call to produce. Every
other classification table is an input to, or an output of, a pure function over
it. That is what makes "change a rule, replay history" a local operation rather
than a re-sync.

The boundary is enforced, not just documented:

- A trigger on `transactions_raw` rejects any change to `id`, `akahu_id` or
  `account_id`, and rejects a change to the payload that does not stamp
  `revised_at`. Bugs that would quietly rewrite history fail loudly instead.
- `transactions_enriched` holds no fact that is not recomputable. It can be
  truncated and rebuilt; nothing is lost.
- `overrides` is a separate table, and — more importantly — it is resolved by
  the `transactions` view at read time rather than baked into the derived layer.
  `scripts/recompute.ts` does not read the overrides table at all. It therefore
  cannot clobber a manual verdict even in principle, rather than merely being
  careful not to. There is also exactly one implementation of override
  precedence, in the view, instead of one in SQL and a second in TypeScript
  drifting apart.

  Verified: override a transaction from Groceries to Eating out, run a full
  recompute, and the derived row still says Groceries while the effective
  category stays Eating out.

### `categories` exists as a table, not a text column

The brief listed `category` as a string on the enriched row. It is a table here
because two facts have to live somewhere: whether a category is `expense` or
`income`, and whether it is consumption.

Loan repayments and Sharesies investments are the reason. They are real
outflows, but the headline "what I spend" number is meaningless if it includes
$40,583 of loan principal and $23,000 of investing. That is a property of the
category, not of each transaction, so `categories.is_consumption` carries it and
every page reads the same flag. The alternative is the same list of category
names hardcoded in five different queries, drifting apart.

### One ordered rules table, not five

The rules file separates passthroughs, exclusions, unidentified patterns and
categories into different arrays, but they are all doing the same job: first
pattern that matches the description wins. Splitting them across tables would
mean the evaluation order lived in application code, where it is invisible and
easy to get backwards. One table with an integer `priority` makes the order
data, inspectable with a query.

The bands, and why the order between them matters:

| Band   | Rule type      | Why it sits there                                                                                                    |
| ------ | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1000   | passthrough    | `salary cxc global` would otherwise read as ordinary income and inflate it by $140k                                    |
| 2000   | exclusions     | must beat every category, or paying off the Amex is counted on top of the purchases it settles                         |
| 3000   | unidentified   | named explicitly so the uncategorised count means "a rule is missing" and nothing else                                 |
| 4000   | income         | inflow only                                                                                                            |
| 5000   | expense        | the file's own order, preserved exactly: pharmacy (5230) before groceries (5290)                                       |

### `applies_to`: the column the rules file implies but cannot express

Three patterns in the file appear on both sides of the ledger:

| Pattern     | As an outflow           | As an inflow             |
| ----------- | ----------------------- | ------------------------ |
| `sharesies` | Investing & round-ups   | Sharesies withdrawal     |
| `car park`  | Transport & fuel        | Car park rent received   |
| `mecca`     | Clothing & grooming     | —                        |

Priority alone cannot separate the first two: whichever rule sits higher would
claim both directions. So rules carry a direction. Income rules are
`inflow`-only and sit above the expense band; expense rules are direction
agnostic.

That last part is deliberate. An expense rule matching `any` direction means a
refund from a shop lands back in that shop's category as a positive amount,
reducing the category total, instead of being booked as income or falling out of
the rule set entirely.

`mecca` is a plain duplicate — it appears in both Clothing & grooming and Home &
shopping with the same direction, so the second can never fire. The seeder drops
it and says so rather than letting it overwrite the winner.

### The exclusion enum is the totals bug, made structural

`exclusion_reason` is `internal_transfer | card_payment | passthrough |
unidentified`, nullable. A check constraint says a row may carry an exclusion
reason or a category, never both:

```sql
constraint enriched_single_classification check (
  exclusion_reason is null or category_id is null
)
```

That constraint is what makes "classified exactly once" a property of the
database rather than a hope the reconciliation test checks after the fact. The
`reconciliation` view then reduces to arithmetic:

```
net_cash = income_signed + spend_signed + non_consumption_signed
         + excluded_signed + unclassified_signed
```

All five terms keep the Akahu sign convention, so `spend_signed` is negative.
This is the brief's `expenses − income + excluded` identity with the signs left
alone instead of flipped, which means the test can compare against
`sum(amount)` directly with no place for a sign error to hide.

Note that non-consumption sits in its own term rather than inside `spend`. It is
neither excluded nor living costs, and giving it a name in the identity is what
keeps it visible while out of the headline.

### A mortgage is modelled as a credit card

The three Kiwibank mortgages are liability accounts, and the app already knows
how to handle one of those: count the purchases, exclude the payment that
settles them. Mortgages get the identical treatment.

| Transaction | Treatment | Year |
| --- | --- | --- |
| `LOAN INTEREST` charged to a mortgage | the cost — a living cost | $24,018 |
| `AP#…` from Everyday to a mortgage | the settlement — excluded as `card_payment` | $40,583 |
| Difference, i.e. principal | never appears as spending, because it is saving | $16,565 |

The tempting alternative — treat the $40,583 payment as the outflow and suppress
the interest — was the original plan and is wrong in a specific way: it books
$16,565 of net-worth increase as though it were an expense, and it drops the
single largest genuine cost of housing out of the spending figure. Between the
two models the headline "what I actually spend" moves by about $24k a year, so
this is the highest-leverage modelling decision in the app.

Ordering matters here: `Mortgage interest` must be tested before
`Fees & interest`, which carries a bare `interest` pattern that would otherwise
swallow every mortgage charge into the same bucket as a $4 bank fee. There is a
test for exactly that.

The AP numbers are load-bearing and are one-to-one with destinations —
12594087 → Mortgage, 22647266 → Campervan, 23258687 → Offset, and 22093831 →
Rainy day savings. The last is an ordinary internal transfer, not a settlement,
and lumping all four together hides $40,583 of mortgage payments inside
"moved, not spent".

### Passthroughs net at read time, not at write time

The gross pay in ($140,296) and the payment out to Hnry ($131,961) are both
stored, both flagged `passthrough`, and both excluded from spending and income.
The retained difference is computed by the dashboard from those excluded rows.

Netting the pair into a single synthetic transaction at write time was the
alternative and it is worse: it invents a row that Akahu never sent, breaks the
one-to-one relationship between raw and enriched, and makes the reconciliation
identity unverifiable against the bank.

### Statement periods are a function, not a stored column

`statement_period_start(date, start_day)` is immutable SQL. Storing the period
on each row would mean rewriting every row to change the start day. As a
function it is a settings change. Verified over a two-year run of dates: 730
days map onto 25 periods with every day inside exactly one, and `start_day` is
capped at 28 so no month can produce a partial period.

### A budget is versioned, not stored per period

`budget_lines` records an amount and the date it takes effect. The budget in
force for a period is the newest line at or before that period's start, resolved
by `budget_for_period(date)` and nowhere else.

The obvious alternative is a row per category per period, and it fails the same
way a stored period column would: a budget is a standing intention that changes
two or three times a year, so materialising it against every period means
writing twenty rows a month forever, and "what was I aiming for in March"
becomes a question about whether those rows happened to be written. Versioning
makes the answer structural. Set rent once and every later period inherits it;
change it in August and July keeps the figure it was actually judged against.

Two details carry weight:

- **`amount` is nullable, and null means "stop budgeting this".** Without it,
  clearing a limit would have to delete the line, and the older line underneath
  would resurface as though the decision had never been made.
- **`effective_from` is a plain date, not a key onto a period.** Periods are
  computed from `settings.statement_start_day` and move when that setting
  changes. "Newest line at or before the period start" keeps resolving sensibly
  across such a change; a stored period key would silently orphan every line.

Expected-to-date is deliberately not a straight-line pro-rate of the limit.
Rent lands on day one and the power bill on day twenty, so a linear budget line
reports every fixed cost as a blowout for the first half of the period and then
quietly recovers. Each category is shaped by its own history instead — the share
of a typical period's spend that has landed by this day — falling back to
straight-line only where there is no history to shape it with. It is the same
argument as the pace comparison on the dashboard, applied per category.

### `passkeys` hangs off nothing, because there is nobody to hang it off

There is no users table and there is not going to be one. This is a single
household with one shared password; a `users` row would invent an identity the
app cannot check and cannot use, and every query would then carry a join whose
answer is always the same.

So a row in `passkeys` is a **device**, not a person. The primary key is the
credential id the authenticator generated, because that is what an assertion
names and it is unique by construction — no surrogate key adds anything.

The table stores public keys only. Its whole contents leaking would let someone
verify a signature and nothing else. What is worth protecting is the ability to
*add* a row, which is why registration requires an existing session: the
password is the root of trust and every credential here descends from someone
who knew it.

`counter` is persisted after each accepted assertion rather than left at its
initial value. Authenticators that keep a counter increment it every time; one
that goes backwards means two things are answering for one credential. Written
back, that is a clone check. Not written back, every assertion is compared
against zero and the column is decoration.

`label` is required and typed by a human. Deriving it from the user agent
produces three rows called "Chrome on macOS" sitting on one desk, and the only
moment the name matters is a year later, choosing which row to delete.

### `sync_runs`

A daily sync that silently stops returning transactions looks exactly like a
quiet month. One row per attempt with `transactions_new` and
`uncategorised_count` turns that silence into a queryable fact.

## Sign convention

Akahu's, preserved end to end and never flipped:

- `amount < 0` — money left the account
- `amount > 0` — money entered the account

Credit cards follow the same rule: a purchase is negative, a payment to the card
is positive. Presentation is the UI's problem.

## Database roles

The original design used Supabase Row Level Security. On self-hosted Postgres
there is no PostgREST and no browser-facing database connection, so the question
is no longer "which rows may a client see" — the browser never sees any — but
"which tables may each part of the app write".

| Role            | Reads      | Writes                                                   |
| --------------- | ---------- | -------------------------------------------------------- |
| `finance_owner` | everything | everything. Migrations only.                             |
| `finance_web`   | everything | `overrides`, `rules`, `merchant_aliases`, `categories`, `budget_lines`, `settings`, `passkeys` |
| `finance_sync`  | everything except `passkeys` | `accounts`, `transactions_raw`, `transactions_enriched`, `sync_runs` |

The split is what makes the read-time override design safe: `finance_web` has no
write access to the derived layer at all, so the UI's only way to recategorise a
transaction is to write an override — which is exactly the behaviour we want,
enforced by privileges rather than by convention. Symmetrically, `finance_sync`
cannot touch rules or overrides.

Both views are `security_invoker`, so they cannot become a hole around the
privileges on the tables underneath them.

`passkeys` is the one table that breaks the "everyone reads everything" rule.
`0004` sets default privileges so a new table is never invisible to the app,
which is the right default and the wrong answer here: the sync job fetches
transactions and has no business reading credentials, however inert a public key
is. `0008` revokes it explicitly rather than relying on the default not to
apply.

Roles are created `NOLOGIN` with no password, so nothing secret is committed.
Grant them login separately and point `DATABASE_URL_WEB` and `DATABASE_URL_SYNC`
at them; both fall back to `DATABASE_URL`, which is what local development uses.

Sign-in is a separate boundary from all of this and sits in front of it: see
**Signing in** in the README. `APP_PASSWORD` gates every route, and the database
roles decide what a request that got through may write.
