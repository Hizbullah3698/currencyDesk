# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Currency Desk runs a currency-exchange counter: buying and selling foreign currency against a
customer, tracking receivables/payables, moving cheques through their lifecycle, payroll, manual
journal entries, and closing the books with a balance sheet and income statement.

Three tiers, all real: a React SPA, an Express/PostgreSQL API, and a shared pure accounting-math
package both sides compute with. Postgres is the ledger of record. `localStorage` holds no business
data and must not start: only `currencydesk.theme.v1` (a display preference) and, on the fallback
path of the cross-tab idle transport where `BroadcastChannel` is unavailable,
`currencydesk.activity.v1` (a single timestamp, never read as state — see `lib/activity.ts`).
Anything that must persist belongs on the server; treat a third key as a defect.

## Commands

**`npm install` must run from the repo root.** This is an npm workspaces monorepo; installing
inside `frontend/` or `backend/` alone will not link `@currencydesk/engine`.

```bash
# Root
npm install
npm run dev:all                 # frontend + backend together (Postgres must already be up)
npm run test                    # fans out to all three workspaces

# backend/  — needs local Postgres first: docker compose up -d, cp .env.example .env
npm run migrate                 # idempotent; skips applied migrations
npm run seed:demo               # creates two local logins, prints their credentials
npm run dev                     # Express on :3001
npm run build && npm start      # production path
npm run create-user -- --email … --password … --role admin --name "…"
npm run set-username            # give an existing account a login username
npm run set-password            # reset an existing account's password
npm run csrf:gate               # is it safe to switch on CSRF_ENFORCE? (local dev DB)
npm run csrf:gate:prod          # same check against production (reads .env.production)
npm run snapshot:dump           # full admin-view snapshot -> backend/snapshot.json (gitignored)
npm run snapshot:dump:prod      # same, against production (reads .env.production)
npm run backfill:vouchers       # requirement 7 phase 4; DRY RUN unless given -- --apply
npm run backfill:vouchers:prod  # same, against production
npm run reset:business          # clear the desk to blank books; DRY RUN unless given
                                # -- --apply --confirm=<database name>. Destructive.

# frontend/
npm run dev                     # Vite on :5173
npm run build                   # tsc -b && vite build
npm run lint                    # oxlint (not ESLint), scoped to this package's src/
npm run test
npm run reconcile               # requirement 7 harness; needs a snapshot:dump first. Exits 1
                                # until requirement 7 is done — that is the expected state.
```

There is no signup flow; accounts are created by CLI. Login accepts a username **or** an email.

### Running a single test

```bash
# backend — MUST go through npm run test, which points DATABASE_URL at currencydesk_test.
# A bare `vitest` picks up backend/.env's DEV url and is refused by src/test/guardTestDatabase.ts.
npm run test -- src/test/integration/trades.concurrency.test.ts
npm run test -- -t "oversell"

# frontend / packages/engine — no database, so plain vitest is fine
npx vitest run src/lib/reports.test.ts
npx vitest run -t "opening equity"
```

`backend`'s `pretest` creates and migrates a **separate `currencydesk_test` database** and each
test file truncates + reseeds it (`src/test/dbFixtures.ts`). `vitest.config.ts` sets
`fileParallelism: false` because every file shares that one database. If `pretest` fails with
"permission denied to create database", the role needs `ALTER ROLE currencydesk CREATEDB`.

## Architecture

### Three packages, and one non-obvious resolution rule

`frontend/` (React SPA), `backend/` (Express API), `packages/engine/` (`@currencydesk/engine` —
the accounting math and domain types, imported by both so client and server can never disagree
about how a number is computed).

The engine's `package.json` uses a conditional `exports` map: `"development"` → `src/index.ts`,
`"default"` → `dist/index.js`. Vite applies the `development` condition automatically. **`tsx`
does not**, so every `backend` script sets `NODE_OPTIONS=--conditions=development` via `cross-env`.
Backend's production path (`node dist/index.js`) has neither, so it resolves compiled output —
which is why `backend`'s `build` runs the engine's build first, as do both `vercel.json` build
commands. **Any new script that imports the engine and runs under `tsx` or plain `node` needs the
same `cross-env` treatment**, or it silently resolves stale/missing `dist/` instead of live source.

### One snapshot is the entire read model

`GET /api/state` returns `{ accounts, activity, cheques, journalEntries, stocks }`. There are no
per-resource GET endpoints. **Every mutating endpoint returns that same shape** — a fresh snapshot
read with the *same* client that performed the mutation, inside the still-open transaction, right
before `COMMIT` (`services/stateService.ts`'s `getSnapshot()`, called by `services/transact.ts`).
The mutation response *is* the refetch, so "server is the source of truth" and "refetch after every
mutation" collapse into one mechanism.

`frontend/src/lib/store.tsx` is therefore a thin API client, not a reducer: every mutating action
is async, calls its endpoint, and replaces `state` wholesale with the response. Nothing computes a
guessed result locally first; a failed call leaves `state` untouched. Sync across tabs/users is
refetch-on-navigation (`App.tsx`'s `Gate()` on `location.pathname` change) — no websockets, no
polling, data is at most one navigation stale by design.

### The snapshot is role-filtered

`getSnapshot()` takes a **required** `SnapshotView`; `viewForRole(role)` sets `includeMargin` only
for `'admin'`. Non-admins get every activity row with `cost`/`margin` **omitted** — absent keys,
not zeros, since a zero would assert "this sale made nothing". This matches the UI, which gates
`/income-statement` as Admin-only and, on the Stock page's movements table, drops the **Margin** and
**Running avg cost** columns for non-admins — the rest of the table (what moved, when, how much, at
what rate) is theirs. Rendering those two columns for a non-admin would print `margin || 0`, a
confident zero on every sale, which is the exact claim the API declines to make.

Because a mutation response *is* a snapshot, `handleMutation(res, req, fn)` takes the request and
reads the role itself — filtering only the `GET` would leak the same figures back out of every
Operator trade, and taking `req` means a route cannot forget to pass it (an un-updated call site
fails to compile). `SnapshotView` is required rather than defaulted on purpose.

This is not a cryptographic boundary and does not claim to be: rates are still served to every role
(the trade screens need them) and current average cost is still on `stocks` (an Operator cannot
price a sale without it), so profit remains approximable.

**Journal entries are filtered on the same flag.** `mapJournalRow` omits any entry with a leg
against an **Income** account when `includeMargin` is false — the whole row, never a zeroed amount,
for the same reason activity omits rather than zeroes. The Income account ids are derived from the
accounts already read in `getSnapshot`, not hardcoded to `'margin'`, because an admin can create
more Income accounts and a hardcoded filter would leak through every one added later. This landed
*before* anything posts an Income leg, deliberately: requirement 7 makes a sale credit `margin`, and
journal entries were previously served to every role unfiltered, so the first voucher would have
re-opened the exact hole closed on 2026-08-31. Note the visible consequence — `/transactions` is not
admin-gated and lists journal entries, so an Operator no longer sees manual entries posted to Income.

### Transaction and concurrency discipline

- Every mutating route goes through `handleMutation()` on a single checked-out client, one
  transaction. Never a bare `pool.query()` — `BEGIN`, a `FOR UPDATE`, and `COMMIT` landing on
  different pooled connections breaks transaction semantics entirely.
- Every service function's signature leads with `client: PoolClient`; every service file's only
  `pg` import is `import type { PoolClient }`. (`userService.ts` is the exception — auth and CLI
  only, outside this model.)
- **Never `Promise.all()` several `client.query()` calls on one client.** A single client runs one
  query at a time; `pg` only warns today but it becomes a hard error. `getSnapshot()` is
  deliberately sequential even when handed a plain `Pool`.
- Throw `appError(status, message)` for a clean 4xx. For validation *before* a transaction opens
  (body parsing, `parseTxnDate`), catch and use `sendIfAppError(res, err)` — that path is outside
  `handleMutation`'s catch.

Guards that are load-bearing and regression-tested: `lockStock()` `SELECT … FOR UPDATE` (creating a
missing row first — a `FOR UPDATE` matching no row locks *nothing*); settlements use a guarded
`UPDATE … WHERE receivable/payable >= $amount`, not a relative delta; cheque transitions use
`UPDATE … WHERE status = '…'` with `rowCount === 0` → `409`; cheque auto-numbering retries once on
`23505` **inside a `SAVEPOINT`** (without it the conflict aborts the enclosing transaction and the
retry's own next `SELECT` fails); salary accrual dedup is a partial unique index, not an app check;
`accrueAllSalaries` uses per-row `ON CONFLICT DO NOTHING` so one bad row doesn't abort the batch;
`payAllSalaries` locks the whole employee set in a fixed `ORDER BY id` (a regression there surfaces
as a raw Postgres `40P01`, not a clean `appError`).

### Currency quote conventions — easy to break silently

The desk trades **EUR, USD, AED, AFN, JPY, IRR** against PKR (that order is strongest-to-weakest,
which is also the picker's order — the trade screen's starting currency is `DEFAULT_CURRENCY`, not
the first list entry, so reordering the list cannot move the default).
`packages/engine/src/currencies.ts` is the single
source of truth; `CURRENCIES` derives from `CURRENCY_LIST`.

They are not quoted alike. AED/AFN are worth more than a rupee and are quoted "PKR per 1 unit" and
**multiplied**. IRR is worth far less (1 PKR ≈ 4,952 IRR) and is quoted "IRR per 1 PKR" and
**divided** — no dealer types `0.000202` into a rate box. So `CurrencyMeta.quote` is not a display
preference; it is what the number in the rate box *means*.

Everything downstream works in one canonical unit, **`pkrPerUnit`** (the PKR value of one unit), so
cost, margin and valuation never need to know which convention was typed. **Only `pkrPerUnit()` on
entry and `quoteRate()` on display sit on that boundary — never let a raw typed rate reach cost
math, storage, or valuation.** Getting this wrong returns a cheerful `200` while booking a position
at millions of times its real cost. An unknown code falls back to plain PKR-per-unit rather than
throwing, so old rows keep reading as they always did.

### Transaction dates

`activity.txn_date` is the day the deal was struck; `created_at` is when it was keyed in. Reports
cut on `txn_date`. **Read it through the engine's `activityDate()`**, which pins a bare
`YYYY-MM-DD` to *local noon* so no timezone offset slides it a day, and falls back to `createdAt`
for older rows. `routes/txnDate.ts`'s `parseTxnDate()` validates format strictly rather than
handing the string to `new Date()`, whose parser accepts far more than the contract allows and
resolves a bare date as UTC.

`txnDate` is **required** on all four `confirm*` actions in `store.tsx` so TypeScript refuses a
caller that omits it — the failure mode is otherwise silent, since the column just defaults to
`CURRENT_DATE`.

Note the deliberate split: the stock ledger replay orders on `createdAt` (the stored weighted-
average cost was built up in that order and `openingStock()` unwinds it the same way), while
reporting periods cut on `activityDate()`. Backdating moves a deal between periods without
rewriting cost history — the same document-date/posting-date split any real ledger runs.

### Balance sheet reconciliation

`computeBalanceSheet()` in `frontend/src/lib/reports.ts` returns `balanced`, `openingStockEquity`
and `unexplained`. The distinction is easy to collapse back into a bug:

- `totalDr`/`totalCr` **include a presentation-only equity plug**, so they always agree. Never
  derive "do the books balance?" from them.
- `openingStockEquity` is the *one* legitimately unjournalled figure: currency stock predating the
  ledger, recovered by unwinding activity via `openingStock()`. Customer/bank/cash/payable opening
  balances are **not** in this category — `createAccount` journals each against Capital
  (`opening_for`), so they carry their own credit.
- `unexplained = (pre-plug difference) − openingStockEquity`, and **`balanced` is judged on that
  alone.** Anything non-zero is a real imbalance.

Currency stock is valued with `stockAsOf(...)`, not the live `stk()` position — every other row is
cut at `asOfT`, so valuing stock at today mixes two dates on any historical sheet.

### Requirement 7 — paired postings, and what keeps them inert

Every trade, settlement and cheque clearing writes **journal vouchers** as well as everything it
already did. This is live. The reports do **not** read them yet.

- **`services/voucherPostings.ts` is the single description of what legs each movement produces.**
  Pure — no database, no lookups. Callers resolve accounts and figures; it decides the shape and the
  narration. The live posting path and the phase 4 backfill both read from it, which is the whole
  point: a backfill that described the shapes a second time would produce historical vouchers
  differing from live ones in some case nobody thought to check, and that difference would not
  surface as an error, just as wrong books. **Add a new movement type here, not at a call site.**
- **`buildVoucherLegs` allocates one side across the other, greedily, in the order given.** On a
  part-paid sale there is no fact of the matter about which rupees covered cost and which covered
  profit, so something has to decide; consuming debits in order against credits in order settles the
  cost of goods before recognising profit and keeps every figure a whole number carried from
  `buyCalc`/`sellCalc`. It returns `null` when a side with money on it has no account — the caller's
  policy is then to post no voucher and let the trade succeed anyway.
- **A voucher cannot be unbalanced**, because each row is one debit against one credit for one
  amount. There is no balance check in `postVoucher` because there is no way to express an
  imbalance.
- **A sale's margin leg switches sides on a loss.** `sellCalc` does not clamp margin and nothing
  rejects selling below weighted-average cost, so a loss is ordinary. It posts as a **debit** to
  Income; a negative credit would make `postVoucher` refuse and fail the trade.
- **Zero-amount legs are dropped, not posted** — a breakeven sale has a margin of exactly 0, and
  `journal_entries` carries `CHECK (amount > 0)`.

**`isVoucherLeg()` in the engine is what keeps all of this invisible to the reports**, and it is
load-bearing. `ledgerBalance()` and `marginLedger()` have always read `journal_entries`
indiscriminately, because until vouchers existed every row there was standalone — so the moment a
trade also posted a voucher its cash was counted twice, once from the activity row and once from the
journal row. Measured before the fix: cash reported PKR 60,000 against an actual 30,000. Four
readers exclude voucher legs — `ledgerBalance`, `marginLedger`, the Transactions page and the
Journal page. **Phase 5 removes the callers, not the function**: the reports stop excluding vouchers
and start excluding the activity rows and stored columns instead.

**Opening currency stock is journalled too** (`services/openingStockService.ts`), Dr Currency Stock /
Cr Capital, matching what `createAccount` does for customer and bank opening balances. It carries a
`voucher_id` **specifically so `isVoucherLeg` excludes it** — `openingStockEquity` is computed from
`openingStock()` independently of the journal and `unexplained = rawDiff − openingStockEquity`, so a
visible entry would credit Capital, drive `rawDiff` to zero, and make a balanced sheet report an
imbalance that is not there. Idempotent via `opening_for`.

**`npm run reconcile` is the acceptance test.** It asks whether a journal-only balance sheet matches
what the app reports, per account, at five dates. It cuts journal entries on `txnDate` falling back
to `createdAt` — *not* `createdAt` alone, because backfilled vouchers are written today for deals
struck months ago and would otherwise all pile onto the backfill date. `ledgerBalance()` still cuts
on `createdAt`; the two only disagree for voucher legs, which `ledgerBalance` already excludes.

### Whoever writes a customer's journal entry moves that balance exactly once

A customer carries **two** stored columns at the same time — `receivable` (they owe the desk) and
`payable` (the desk owes them) — not one signed figure.

`postJournal` moves them, using an allocation rule, because a bare `Dr customer X` says only which
way the net shifts and not which column should change: **settle whatever is outstanding in the
opposite direction first, then let the remainder cross over.** Each direction is one atomic
`UPDATE` with no read-modify-write — SQL evaluates every `SET` expression against the pre-update row
— so there is no race window and no `SELECT ... FOR UPDATE`, which is stronger than the
lock-then-update the settlement paths use. Neither column can go negative under it, so no
`AND receivable >= $1` guard is needed.

**`postVoucher` must NOT do this, and deliberately does not.** Trades, settlements and cheque
clearing update the balance themselves *before* the voucher is written — the voucher is the journal
side of an operation whose balance move is already handled. Adding it there would double-count every
trade. The question to ask at a new call site is not "is this a customer journal entry" but **"has
anything else already moved this balance"**.

This existed as a live fault until 2026-09-03: `postJournal` wrote the entry and nothing else, so
the books and the on-screen figure diverged permanently the moment anyone used the Journal page
against a customer.

### Clearing the desk

`npm run reset:business` removes business data and leaves blank books — for go-live, not a feature
of the app, and not reachable from it.

**Never TRUNCATE `accounts` to do this.** Migration 009's `protect_core_accounts` trigger is
`BEFORE UPDATE OR DELETE ... FOR EACH ROW`, and TRUNCATE does not fire row-level DELETE triggers, so
it walks straight past the guard and takes the structural chart of accounts with it. The test
fixture's TRUNCATE+reseed is right for a disposable database and exactly the wrong instinct here.
Targeted DELETEs in FK order leave the guard armed as a backstop. Stock positions are **zeroed, not
deleted** — `lockStock()` needs a row per traded currency.

Two gates, because it is destructive rather than additive: `--apply` **and**
`--confirm=<database name>` matching the connected database. Nine assertions run inside the
transaction before commit. `users` and `session` are never written — only read, twice, to prove they
were not touched.

### Auth

Sessions, not JWT (`express-session` + `connect-pg-simple`, table `session`, httpOnly cookie,
`rolling: true`, 30-day idle window). `req.session.regenerate()` runs *before* identity is written,
preventing fixation. One error message for unknown email, unknown username and wrong password
alike, plus a dummy `bcrypt.compare` on a miss so timing doesn't leak which accounts exist — never
split that into more specific text. `findUserByIdentifier()` is a single query across both columns
deliberately (two sequential lookups would leak timing); migration `011` forbids `@` in usernames so
an identifier is never ambiguous.

**`requireAdmin` trusts the role cached in the session at login time** and never re-queries — a role
change or deactivation takes effect on that user's *next* login.

`config/env.ts` throws on startup if `DATABASE_URL` or `SESSION_SECRET` is missing. Keep it failing
fast; do not add a silent fallback.

### CSRF — mid-rollout, do not collapse the stages

A session-bound synchroniser token exists (`backend/src/middleware/csrf.ts`): minted at login and
lazily on `/me`, returned in the **response body** (not a cookie — double-submit would need a
readable cross-site cookie, which this two-origin deployment makes awkward), echoed as
`X-CSRF-Token`, compared with `crypto.timingSafeEqual` against `req.session.csrfToken`.

| Stage | Change | Status |
|---|---|---|
| 1 | Backend issues the token and validates it *when sent*; a missing token is allowed and logged | **Shipped** |
| 2 | Frontend sends `X-CSRF-Token` on every mutating request | **Shipped and live since 2026-08-31** — `lib/csrf.ts` `requestHeaders()`, used by `store.tsx` and `settings.ts`. Re-confirmed 2026-09-06 by grepping the bundle actually served in production |
| 3 | Backend rejects mutating requests with no token (`CSRF_ENFORCE=true`) | Not started |

Each stage must be confirmed live in production before the next begins. Running 3 before 2 has
fully propagated locks out every user still holding a cached pre-stage-2 bundle. Stage 3 is an env
flag rather than a code change specifically so the lockout-capable step is revertible by flipping a
variable; only the exact string `"true"` enables it, so a typo fails open. **The gate on starting
stage 3** is `npm run csrf:gate:prod` reporting SAFE: zero rows in `csrf_missing_token` over a
window in which `activity`/`journal_entries` show real traffic. Both halves are load-bearing — an
empty table on an idle desk is `INCONCLUSIVE`, not a green light, which is why the check cannot be
settled until the client has traded for a normal day. The stage-1 log line `[csrf] mutating request
with no token: METHOD /path` is the convenient live view while tailing and **cannot** be the gate:
Vercel's runtime logs are deployment-scoped and briefly retained (measured — a warning logged at
13:40 was unretrievable by 16:05, and every push to main rotates the deployment), so a quiet log is
indistinguishable between "no untokened requests", "this deployment is new" and "the entry aged
out". See migration `013`'s header.

`/me` returning the token (not just `/login`) is load-bearing: it is the only call a returning user
makes without re-authenticating, so it is how a pre-middleware session acquires one. Already strict
even at stage 1: a *wrong* or wrong-length or other-session token is `403`. `/api/auth/login` is
exempt (no session to bind to), which leaves login CSRF open — noted, not solved.

Why it is needed despite CORS: production runs `SameSite=None; Secure` (two origins), so the
browser *does* attach the session cookie cross-site. What has been holding the line is incidental —
a JSON `Content-Type` forces a preflight the origin allowlist then rejects. That breaks if anyone
adds a form-encoded or `text/plain` route, relaxes `express.json()`, adds a mutating `GET`, or
widens `FRONTEND_ORIGIN`.

### Database and migrations

`backend/src/db/migrations/`, applied by a small idempotent runner tracking `schema_migrations`,
each in its own transaction. **A migration is `.ts` rather than `.sql` only when its content must
be *derived* from TypeScript source.** `009_lock_core_accounts.ts` qualifies — its trigger body is
generated from the engine's `CORE_ACCOUNT_IDS`, so that list is written down once.
`012_add_txn_date_and_currencies.sql` deliberately does not, despite `CURRENCY_LIST` living in TS:
it records a one-time historical fact, and deriving it would buy no ongoing sync while costing
reproducibility. Read `012`'s header before adding a fourth currency.

- **`accounts.id` is `text`, not `uuid`**, because `CORE_ACCOUNT_IDS` hardcodes literal ids
  (`'capital'`, `'salaryExpense'`) that other code resolves by id. Every other table uses `uuid`.
- **Core-account protection is a database trigger**, not just an API check — it rejects a type
  change or delete of any core account regardless of code path. `accountsService.ts` has a matching
  app check purely so the user sees a clean `400`. The trigger is the enforcement; the check is UX.
- **`pg` type parsers are overridden in `db/pool.ts`**: `NUMERIC` returns a real number (default is
  a string) and `DATE` returns literal `'YYYY-MM-DD'` text (default is a `Date` that timezone-shifts
  on stringification). `activity.txn_date` and `cheques.due_date` both depend on that.
- `stock_positions.avg_cost` is `numeric(24,12)` — `18,6` rounds an IRR unit cost enough to
  compound error on every re-weighting.
- **`journal_entries.txn_date`** (migration `017`) is the journal's counterpart to
  `activity.txn_date` — the day the entry belongs to, vs. `created_at` when it was keyed in. Its own
  stored column rather than a join through `activity_id`, because manual entries, opening balances,
  salary postings and future reversal vouchers have no activity row to join to. A voucher written
  from a trade must **copy** the date from that activity row at write time, never join to it at
  read time. Reports do **not** cut on it yet — `ledgerBalance()` still uses `created_at`, and
  switching that moves reported figures, which requirement 7's acceptance test forbids.
- **`journal_entries.voucher_id` / `activity_id` / `cheque_id`** (migrations `016`, `018`). The
  table is strictly two-legged and a sale needs four legs, so a deal is several balanced rows
  sharing a `voucher_id`. `activity_id` links a leg to the deal that produced it; `cheque_id` to the
  cheque whose clearing produced it — a leg carries one or the other, never both, and manual
  entries, opening balances and salary postings carry neither. `voucher_id` is intentionally **not**
  a foreign key (there is no voucher table, and adding one would be the header/lines restructure
  that was explicitly not chosen); `cheque_id` **is** one, because cheques are a real table and a
  leg pointing at a missing one is a bug worth failing on. All three are written today — see the
  requirement 7 section.
- A Currency Stock account's `code` must be a traded currency and must not already be taken; two
  accounts sharing a code both value the same position and double-count it as an asset.

### Two-origin deployment

Frontend and backend deploy as **two separate Vercel projects on different origins** (Root
Directory `frontend` and `backend` respectively). Settings that exist only because of that:
`app.set('trust proxy', 1)` (without it `express-rate-limit` v7 *throws*); `FRONTEND_ORIGIN` as an
explicit CORS allowlist, never a wildcard; `secure: true` + `sameSite: 'none'` together on the
cookie when `NODE_ENV=production`; `VITE_API_BASE_URL` on the frontend (`lib/apiBase.ts`); a
Postgres-backed rate-limit store, since concurrent serverless instances each have their own memory;
and `.trim()` on every env var in `config/env.ts` (a pasted space produced an invalid cookie *name*
and a `NODE_ENV` that failed `=== 'production'`, with no error).

`src/app.ts` exports both `createApp()` (used by `src/index.ts` and every test) **and** a default
export, because Vercel's convention-based detection requires the latter. Migrations do **not** run
on deploy; `userService.ts`'s `hasUsernameColumn` fallback exists to survive code landing before its
migration.

Local dev sidesteps all of this: `vite.config.ts` proxies `/api` to `:3001`, so the browser sees
same-origin and `FRONTEND_ORIGIN` stays unset.

### Preview deployments are off, and there were two paths to the live books — not one

Both Vercel projects have **Ignored Build Step → "Only build production"**. A branch push still
registers a deployment, but it is `CANCELED` before any build runs and its URL serves nothing.
Verified 2026-09-03 with a throwaway branch.

This closed **two** independent routes from a preview to the live database. The second one had gone
unrecorded for weeks, and was the likelier accident:

1. **Preview backend → live database.** `DATABASE_URL` was one Vercel variable scoped
   `Production, Preview` — a single value covering both — so a preview backend booted against
   production Neon with write access. (How to tell scoping apart at a glance: one row spanning two
   environments is *one shared value*; genuinely separate values appear as separate rows, which is
   what `VITE_API_BASE_URL` looks like on the frontend project.)
2. **Preview frontend → live backend.** `VITE_API_BASE_URL` is set for Preview *and* Production and
   both point at `currency-desk-backend-jf1x.vercel.app`. So opening a preview URL to review a UI
   change was not previewing anything — it was driving the live system on live data through
   unreviewed code. No preview backend needed to exist for this.

**`config/guardPreviewDatabase.ts` is the backstop**, imported from `config/env.ts` so every entry
path hits it — serverless function, local server, and every CLI script alike. It refuses to boot
when `VERCEL_ENV === 'preview'` unless `PREVIEW_DB_ISOLATED === 'true'`. It exists because the build
setting above is a dashboard toggle, one click from returning, with nothing in the repo to notice.

It is a **tripwire, not a verification** — nothing in a preview can tell a Neon branch from
production by looking at a URL, so the flag is a human assertion. What it guarantees is that
re-adding `DATABASE_URL` to Preview is no longer enough on its own. Note the flag fails **closed**
on a typo, the opposite of `csrfEnforce`, because the cost of guessing wrong is writing to real
customer records.

**If previews are ever wanted again**, both paths must be fixed together: give Preview its own Neon
branch *and* repoint Preview's `VITE_API_BASE_URL` at a preview backend. Fixing only the first
produces a preview that looks isolated and is not, which is worse than having none.

## Theming

All color is CSS custom properties in `frontend/src/index.css` under `@theme`, overridden in
`@media (prefers-color-scheme: dark)`, `:root[data-theme="dark"]`, and a `@media print` block that
forces fixed light values with `!important`. **Never hardcode a hex color in a component** — use the
token utility (`bg-surface`, `text-ink`) or `var(--color-*)`.

**Cascade-layer trap, which has caused real bugs twice:** Tailwind v4 emits utilities into a
`utilities` layer, and a bare *unlayered* rule sits outside all layers and therefore beats every
layered rule unconditionally. `a { color }` silently defeated every text-color utility on the
Sidebar's `NavLink`; `:focus-visible { outline }` made `outline-none` unsuppressable on Radix items.
Both are now wrapped in `@layer base`. **Wrap any new bare element rule in `@layer base`.**

Other rules that are structural, not stylistic:

- **Soft-tint vs solid-fill.** Tint (`bg-X-bg` + `text-X`) never flips contrast direction. Solid
  fill (light text on a colored background) does — which is why `-solid` variants exist and diverge
  in dark mode. `accent`, `negative`, `positive`, `inflow`, `outflow` have one; **`pending` does
  not**. Add `--color-pending-solid` and check dark-mode contrast before using it as a solid fill.
- **Radius scale**: `--radius-data` (3px) for figures/records, `--radius-control` (6px) for things
  you click or type into, `--radius-panel` (10px) for containers. Pick the tier, don't eyeball a px.
- Category tints (`--color-cat-*`, `--color-sidebar-cat-*`) are for icon-badge backgrounds only.
  The positive/negative/pending state colors are the only state signal in the app.
- The sidebar has its own fixed dark-navy palette that does not flip with theme.
- Print visibility is per-element `print:hidden`, not in the `@media print` block.

## Testing and verification

259 tests: 46 engine unit, 137 backend integration (real HTTP against real Postgres, no supertest —
each file boots `http.createServer(createApp())` on an ephemeral port), 76 frontend unit (8 files
under `src/lib/`, node environment, **no jsdom** — so a frontend test can cover pure logic but
never a component, and anything touching `window` must be guarded at module load or it breaks the
suite). No CI — `npm run test` is manual.

**`npm run reconcile` is deliberately not part of `npm run test`.** Same reasoning as `csrf:gate`:
it asks a question about live data, and a knowingly-red check inside the suite trains everyone to
ignore a red suite.

It exits 1 while requirement 7 is unfinished, but **that is no longer a blanket "expected" —
attribute every difference before accepting it.** One known cause remains, logged 2026-09-02 and
left to phase 5: `computeBalanceSheet`'s Customer branch reads the stored `receivable`/`payable`
columns with **no `asOfT`**, so it reports the current balance at every historical date. Its
signature is a Customer row whose *Reported* figure is identical at every date while *Journal only*
moves — there the journal is right and the report is wrong. Anything not matching that signature is
unexplained and is a finding.

### The settings cache outlives a database reset — a solved flake worth not re-creating

`settingsService` caches `idle_timeout_minutes` for **30 seconds per process**, and vitest runs every
test file in one worker. So the cache outlives the `TRUNCATE` that is supposed to give each file a
clean slate, and `applySessionIdleTimeout` reads it on *every authenticated request* — meaning every
file that logs in warms it for the next one.

That made the suite intermittently red on 2026-09-03: `idleTimeout.test.ts` asserts the stored
value, but whether a previous file's cached entry was still inside its 30-second window depended on
how long the preceding files took. Two different tests in that one file failed on two separate runs,
neither reproducible in isolation — there is no preceding file to leave a warm cache. It surfaced
that day only because five new test files landed ahead of it and shifted the timing.

`resetBusinessData` now calls `invalidateSettingsCache()`. **Any future per-process cache needs the
same treatment** — a database reset cannot reach process memory, and the failure it produces looks
like a defect in whichever test happens to read the stale value.

Recorded also because the first hypothesis was wrong: `app_settings` was the one table the fixture
never reset, which looked like an obvious culprit and was not — corrupting the row does not fail the
suite. The fixture resets it now as hygiene, not as the fix.

Most of the app has no automated coverage: every React component and page, cheque lifecycle
end-to-end, the auth routes, `deleteAccount`'s success path. Correctness there rests on `tsc`,
`oxlint`, and manual verification in the running app.

- **Color/dark-mode/contrast changes: run the app and take actual screenshots in both themes.**
  There is no visual test harness; reasoning about hex values is not verification.
- **Auth changes**: verify against real Postgres + Express, not just a type-check.
- **Concurrency**: two shelled-out `curl` processes do *not* reliably collide (spawn jitter exceeds
  100ms). Fire both from one Node process via `fetch()` + `Promise.all` with no `await` between
  dispatch. Also note a shared `FOR UPDATE` elsewhere in the path will serialize requests you meant
  to race — route around it with different customers or currencies.
- **When fixing a bug, write the test, revert the fix, and confirm the test actually fails.** A
  regression test never seen to fail is not known to test anything.
- **Verifying a claim against a live database**: do it inside a transaction and roll back, with a
  `SAVEPOINT` per attempt when an attempt is expected to error. Don't mutate live data and fix it up
  afterward. **Never point a test suite's resets at the dev database** — see `guardTestDatabase.ts`.

## Conventions

- Don't rewrite the accounting math in `packages/engine/` or `reports.ts` without reason — it is
  load-bearing for the reports, and auth/theming/UI work never needs to touch it.
- New mutating store actions follow the existing pattern: call the endpoint, replace `state` with
  the response on success, leave it untouched on failure. There is no client-side persistence.
- Identity lives in `useAuth()`. Don't reintroduce a client-side "declare yourself admin"
  affordance — that is exactly what was removed when auth became real.
- Preserve the `key="buy"`/`key="sell"` remount props on the `Trade`/`Settle` routes.
- The two tiers deploy separately and can be briefly out of step on any release — keep API changes
  backward-compatible for one deploy cycle (the `identifier`/`email` login fallback is the worked
  example).
- Be precise about what a claim asserts, and verify it rather than describing intent. "Moved
  verbatim" and "I didn't intend to change it" are different claims; "this constraint exists" and
  "this constraint is designed for" are different claims. Say which one is true.
