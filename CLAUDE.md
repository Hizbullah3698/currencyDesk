# Currency Desk

## Project Overview

Currency Desk runs a currency-exchange counter: buying and selling foreign currency against a
customer, tracking customer receivables/payables, managing inward/outward cheques through their
full lifecycle, running payroll, posting manual journal entries, and closing the books with a
balance sheet and income statement.

It is a real three-tier application: a React SPA, an Express/Postgres API, and a shared pure
accounting-math package. **Postgres is the ledger of record.** Login is real (bcrypt +
server-side sessions), business data lives in the database, and the accounting math is shared
verbatim between client and server rather than duplicated.

It began as a browser-only demo that kept everything in `localStorage` with a fake login. None
of that remains: `localStorage` now holds exactly one key, the theme preference. If you find a
document, comment, or README claiming otherwise, that document is stale — the README at the repo
root is, as of this writing (see "Known stale documentation").

## Repo layout: npm workspaces, three packages

The repository root is an **npm workspaces** root (`"workspaces": ["frontend", "backend", "packages/*"]`)
containing three packages:

| Package | Name | Role |
|---|---|---|
| `/frontend` | `currency-desk` | The React/Vite SPA |
| `/backend` | `currency-desk-server` | The Express/Postgres API |
| `/packages/engine` | `@currencydesk/engine` | Shared pure accounting math + domain types |

`frontend` and `backend` are independently buildable and runnable; `packages/engine` exists
purely to be depended on and is never run directly. **`npm install` must run at the repo root** —
installing inside `frontend/` or `backend/` alone will not set up the `@currencydesk/engine`
workspace link. The root `package.json` also holds `dev:all` (`concurrently`, runs both dev
servers) and a fan-out `test` script.

Paths below are relative to `frontend/`, `backend/`, or `packages/engine/` as indicated.

### `@currencydesk/engine` resolves differently in dev vs. production

Its `package.json` uses a conditional `exports` map (`"development"` → `src/index.ts`,
`"default"` → `dist/index.js`).

- **Vite** applies the `development` condition automatically, so the frontend dev server always
  sees live source with no build step.
- **`tsx` does not** apply it by default. Every `backend` script therefore sets
  `NODE_OPTIONS=--conditions=development` via `cross-env` (a devDependency, needed so this works
  identically in PowerShell and POSIX shells).
- Backend's production path (`npm run build` → `npm start` → `node dist/index.js`) has neither,
  so it correctly resolves the compiled `dist/` — which is why `backend`'s `build` script runs
  `npm run build --workspace=@currencydesk/engine` first, and why both `vercel.json` build
  commands do the same.

**If you add any script that imports `@currencydesk/engine` and runs under `tsx` or plain `node`
against TypeScript source, it needs the same `cross-env` treatment**, or it will silently resolve
stale/missing compiled output instead of live source.

## Current Architecture

- **Three tiers, all real.** The SPA calls the API; the API owns Postgres; both sides import the
  same engine package for the accounting math.
- **`GET /api/state` is the whole read model.** `frontend/src/lib/store.tsx` fetches one full
  snapshot on load and replaces it wholesale after every mutation. There are no per-resource
  GET endpoints.
- **Every mutating endpoint returns that same snapshot** — see "Response contract" below.
- **Sync strategy is refetch-on-navigation.** No websockets, no polling. Data is at most one
  client-side route change stale, by design.
- **Sessions persist across reload.** `AuthProvider` calls `GET /api/auth/me` once on boot; the
  browser sends the httpOnly cookie automatically.
- **The backend is deployed**, to Vercel, as a serverless function — see "Deployment". It also
  runs as a normal long-lived process locally and on any persistent host.
- Network calls at runtime: the auth endpoints, the business-data API, and a Google Fonts
  `@import` in `frontend/src/index.css`. Nothing else.

## Development

```bash
npm install                    # FROM THE REPO ROOT — links all three workspaces
```

Backend (from inside `backend/`):

```bash
docker compose up -d           # local Postgres 16 (backend/docker-compose.yml)
cp .env.example .env           # first time only
npm run migrate                # idempotent; skips already-applied migrations
npm run seed:demo              # creates two local login accounts, prints credentials
npm run dev                    # Express on http://localhost:3001
```

Frontend (from inside `frontend/`):

```bash
npm run dev                    # Vite on http://localhost:5173
npm run build                  # tsc -b && vite build
npm run preview
npm run lint                   # oxlint, scoped to this package's src/
```

Or from the repo root, `npm run dev:all` runs both at once (Postgres must already be up,
migrated, and seeded).

`frontend/vite.config.ts` proxies `/api/*` to `http://localhost:3001` in dev only, so the browser
sees everything as same-origin — no CORS, no cross-origin cookie subtlety locally. This affects
`vite dev` only, never `vite build`.

If you change `packages/engine/src/`, rebuild it before relying on the change in backend's
*production* path; dev picks it up live in both packages:

```bash
npm run build --workspace=@currencydesk/engine    # from the repo root
```

### Backend CLI scripts

All run from inside `backend/`. There is no signup flow — accounts are created by CLI.

| Script | What it does |
|---|---|
| `npm run seed:demo` | Creates `admin`/`admin@currencydesk.local` and `user1`/`user@currencydesk.local` with fixed passwords, printed to the console. Never overwrites an existing account's username. |
| `npm run create-user -- --email … --password … --role admin --name "…"` | Creates one account (8-character password minimum). |
| `npm run set-username` | Assigns a username to an existing account. |
| `npm run set-password` | Resets an existing account's password. |
| `npm run migrate` | Runs pending migrations. |

## Deployment

**Both tiers are deployed to Vercel as two separate projects, on two different origins.** This is
the real production topology and it drives several settings that would otherwise look arbitrary.

- **Frontend project** — Root Directory must be `frontend`. `frontend/vercel.json` builds from
  the repo root (`cd .. && npm install --include=dev && …`) so the engine workspace is built
  first, and rewrites all paths to `index.html` for the SPA.
- **Backend project** — Root Directory must be `backend`. `backend/vercel.json` builds the engine
  and rewrites every path to `/api/index`. `backend/api/index.ts` re-exports `src/app.ts`'s
  default export; `src/app.ts` has **both** a named `createApp()` factory (used by
  `src/index.ts` and by every test file) **and** a default export, because Vercel's convention-based
  detection specifically requires a default export from a file named `app.js`.

Settings that exist only because of this topology:

- **`app.set('trust proxy', 1)`** in `app.ts`. Without it `req.ip` resolves to the proxy, and
  `express-rate-limit` v7 *throws* rather than keying on the wrong IP — this crashed every
  request through `loginLimiter` on Vercel.
- **`FRONTEND_ORIGIN`** (comma-separated list) enables `cors({ origin, credentials: true })`.
  Unset in local dev, where the Vite proxy makes CORS unnecessary. Never a wildcard — a wildcard
  can't be combined with `credentials: true` anyway. **Note: `FRONTEND_ORIGIN` is not listed in
  `backend/.env.example`** even though `env.ts` reads it.
- **Cookie flags flip on `NODE_ENV=production`**: `secure: true` and `sameSite: 'none'` together,
  because a cross-origin fetch only carries the cookie when it's `SameSite=None`, and browsers
  refuse `SameSite=None` without `secure`. Local dev is plain `http://localhost`, where
  `secure: true` would silently stop the cookie from ever being sent back.
- **`VITE_API_BASE_URL`** on the frontend points fetches at the deployed backend
  (`frontend/src/lib/apiBase.ts`). Unset locally, so relative paths keep going through the dev
  proxy.
- **Every env var is `.trim()`ed** in `config/env.ts`. A stray pasted space in a dashboard field
  produced an invalid cookie *name* and a `NODE_ENV` that failed `=== 'production'` — both bit
  this project for real, with no error, just a session cookie that silently never got set.
- **The login rate limiter is Postgres-backed**, not in-memory (`services/rateLimitStore.ts`,
  table `rate_limit_hits`, migration `010`). Concurrent serverless instances each get their own
  process memory, which would silently weaken the limiter rather than erroring.

Nothing runs migrations automatically on deploy — `backend/vercel.json` only builds the engine.
`npm run migrate` against the production `DATABASE_URL` is a manual step, and code must tolerate
landing before its migration does (see the `hasUsernameColumn` fallback in `userService.ts`).

`PROJECT_BRIEFING.md` is gitignored — it holds real deployment credentials and is meant to be
handed to a session as context, never committed.

## Backend

Express + `pg` (a plain pool, no ORM) + `express-session`/`connect-pg-simple` + `bcryptjs`.
TypeScript, ESM, `tsx` in dev and `tsc` for the build.

### API surface

Every route is under `/api`. Guards are real server-side enforcement, not a mirror of the UI.

| Method | Path | Guard |
|---|---|---|
| `GET` | `/api/health` | none |
| `POST` | `/api/auth/login` | none (rate-limited: 20 / 15 min / IP) |
| `POST` | `/api/auth/logout` | none (always `204`) |
| `GET` | `/api/auth/me` | `requireAuth` |
| `GET` | `/api/state` | `requireAuth` |
| `POST` | `/api/trades/purchase`, `/api/trades/sale` | `requireAuth` |
| `POST` | `/api/settlements/receive`, `/api/settlements/pay` | `requireAuth` |
| `POST` | `/api/cheques/:id/deposit` | `requireAuth` |
| `POST` | `/api/cheques/:id/clear`, `/api/cheques/:id/return` | `requireAdmin` |
| `POST` | `/api/journal` | `requireAdmin` |
| `POST` | `/api/salary/accrue`, `/accrue-all`, `/pay`, `/pay-all` | `requireAdmin` |
| `POST` | `/api/accounts` | `requireAdmin` |
| `PATCH`, `DELETE` | `/api/accounts/:id` | `requireAdmin` |
| `POST` | `/api/accounts/:id/archive`, `/unarchive` | `requireAdmin` |

Each of these has a 1:1 counterpart in `frontend/src/lib/store.tsx` (`confirmPurchase` →
`/api/trades/purchase`, `postJournal` → `POST /api/journal`, and so on).

`routes/txnDate.ts` is **not a router** despite living in `routes/` — it exports `parseTxnDate()`,
the shared transaction-date validator used by `trades.ts` and `settlements.ts`.

### Response contract

Every mutating endpoint, and `GET /api/state`, returns the identical shape:

```
{ accounts, activity, cheques, journalEntries, stocks }
```

a full, freshly-queried snapshot read with the **same** database client that performed the
mutation, inside the still-open transaction, immediately before `COMMIT`
(`services/stateService.ts`'s `getSnapshot()`, invoked by `services/transact.ts`'s
`runMutation()`/`handleMutation()`). This is deliberate: the mutation response *is* the refetch,
so "the server response is the source of truth" and "refetch after every mutation" collapse into
one mechanism with no extra round-trip.

### Transaction discipline

- **Every mutating route runs through `handleMutation()`** on a single checked-out client, one
  transaction. Never a bare `pool.query()` — `BEGIN`, a `FOR UPDATE` lock, and `COMMIT` landing
  on different pooled connections would break transaction semantics entirely.
- Every service function's signature leads with `client: PoolClient`, and every service file's
  only `pg` import is `import type { PoolClient }`. No service creates its own `Pool`/`Client`.
  (`userService.ts` is the exception, used only by `auth.ts` and the CLI scripts, which are
  outside the business-data transaction model.)
- **Never `Promise.all()` several `client.query()` calls on one checked-out client.** A single
  client can only run one query at a time; `pg` currently only warns, but it will be a hard
  error in a future major version. `stateService.ts` and `journalService.ts` both had this bug
  and are deliberately sequential now — the comment in `getSnapshot()` explains why it stays
  sequential even when handed a plain `Pool`.
- Throw `appError(status, message)` for a clean 4xx. Anything else rolls back and reaches the
  global handler as a `500`. For validation that happens *before* a transaction opens (body
  parsing, `parseTxnDate`), catch and use `sendIfAppError(res, err)` — that path is outside
  `handleMutation`'s own catch.

### Concurrency guards

These are load-bearing and regression-tested; don't relax them.

- **Trades** — `lockStock()` does `SELECT … FOR UPDATE` on the `stock_positions` row, creating a
  missing row first (a `FOR UPDATE` that matches no row locks *nothing*).
- **Settlements** — guarded `UPDATE … WHERE receivable/payable >= $amount`, not a bare relative
  delta, so two concurrent settlements can't jointly drive a balance negative.
- **Cheque transitions** — guarded `UPDATE … WHERE status = '…'`; `rowCount === 0` → `409`.
- **Cheque auto-numbering** — `chequeHelpers.ts`'s `insertCheque()` seeds from `cheque_number_seq`,
  scans forward past taken numbers, and retries once on a `23505`. **The retry is wrapped in a
  `SAVEPOINT`/`ROLLBACK TO SAVEPOINT`** — without it the conflict aborts the whole enclosing
  transaction and the retry's own next `SELECT` fails with "current transaction is aborted,"
  silently defeating the retry the first time it is ever needed.
- **Salary accrual** — a partial unique index (`journal_entries_salary_accrual_uniq`) makes
  "already accrued for this period" a race-proof database constraint, not an app-level check.
- **`accrueAllSalaries`** uses per-row `INSERT … ON CONFLICT DO NOTHING`, so one already-accrued
  employee doesn't abort the batch for everyone else.
- **`payAllSalaries`** locks every target employee row in a fixed `ORDER BY id` up front, which
  makes two concurrent bulk-pay runs serialize cleanly instead of deadlocking. If that fixed
  order ever regresses, the symptom is a raw Postgres `40P01`, not a clean `appError`.

### Authentication

- **Sessions, not JWT.** `express-session` + `connect-pg-simple` (table `session`), httpOnly
  cookie (`cd.sid` by default, `COOKIE_NAME`), `rolling: true`, 30-day `maxAge` — so "persistent
  login" means "until genuinely idle for 30 days or explicit sign-out," not a hard cliff.
- **Login accepts a username *or* an email address**, in one field. `POST /api/auth/login` reads
  `identifier` and falls back to `email` (an older cached frontend bundle keeps working against a
  newer backend — the two deploy separately and are briefly out of step on every release). The
  frontend sends both.
- **`findUserByIdentifier()` is a single query across both columns**, deliberately not "try email,
  then try username" — two sequential lookups would take measurably longer on a miss, which is
  exactly the timing signal the dummy-hash comparison exists to suppress. Migration `011` forbids
  `@` in a username, so an identifier can never be ambiguous between the two columns.
- **Anti-enumeration**: one message (`"Invalid username or password."`) for unknown email,
  unknown username, and wrong password alike, plus a real `bcrypt.compare` against a precomputed
  dummy hash on a miss so response timing doesn't leak which accounts exist. Never split this
  into more specific text — it matters more for short guessable usernames than it ever did for
  email addresses.
- `403` (not `401`) for `is_active = false`.
- **Session fixation is handled**: `req.session.regenerate()` runs *before* any identity is
  written into the session.
- **`requireAdmin` trusts the role cached in the session at login time** and never re-queries
  `users`. A role change or deactivation takes effect on that user's *next* login.
- **CSRF is deliberately not implemented.** The justification was: state-changing routes are
  POST-only and `SameSite=Lax` blocks the cookie on cross-site POSTs. **That justification is now
  weaker than it was** — production runs `SameSite=None` (see "Deployment"), which does *not*
  block cross-site sends. The remaining protection is the strict CORS origin allowlist. Treat
  this as an open item, not a settled decision.
- `config/env.ts` throws on startup if `DATABASE_URL` or `SESSION_SECRET` is missing. Keep it
  failing fast; don't add a silent fallback for either.

### Database schema

Migrations live in `backend/src/db/migrations/` and are applied by `db/migrate.ts`, a small
idempotent runner tracking applied files in `schema_migrations`. Each migration runs in its own
transaction.

| Migration | Contents |
|---|---|
| `001`–`002` | `users`, `session` |
| `003`–`007` | `accounts`, `stock_positions`, `cheques`, `activity`, `journal_entries` |
| `008` | Seeds 8 system accounts |
| `009` | `.ts` — the `protect_core_accounts` trigger |
| `010` | `rate_limit_hits` |
| `011` | `users.username` + case-insensitive unique index + format CHECK |
| `012` | `activity.txn_date`, widened `avg_cost`, AFN/IRR stock positions and stock accounts |

**A migration is `.ts` rather than `.sql` only when its content must be *derived* from TypeScript
source rather than hand-duplicated.** `009_lock_core_accounts.ts` qualifies: its trigger body is a
machine-generated projection of `@currencydesk/engine`'s `CORE_ACCOUNT_IDS`, so that list is
written down exactly once. `012` deliberately does *not* qualify despite `CURRENCY_LIST` living in
TypeScript — it records a one-time historical fact ("on the day the desk added AFN and IRR, these
rows were created"), and deriving it would buy no ongoing sync while costing reproducibility. Read
`012`'s own header comment before adding a fourth currency.

Schema notes worth knowing:

- **`accounts.id` is `text`, not `uuid`**, because `CORE_ACCOUNT_IDS` hardcodes literal id strings
  (`'capital'`, `'salaryExpense'`) that other code resolves directly by id. Every other table uses
  native `uuid`.
- **`CORE_ACCOUNT_IDS` protection is enforced by a database trigger**, not just an API check.
  Migration `009`'s `BEFORE UPDATE OR DELETE` trigger rejects a type change or deletion of any core
  account regardless of code path — a route, an admin script, or a raw query. `accountsService.ts`
  has a matching app-level check on top, purely so the user sees a clean `400` instead of a raw
  constraint violation. The trigger is the enforcement; the check is UX.
- **`cheques.number` and `journal_entries.ref` have real database uniqueness** (a
  case-insensitive unique index, and a `journal_ref_seq`-backed default).
- **`stock_positions.avg_cost` is `numeric(24,12)`.** It was `numeric(18,6)`, which rounds one IRR
  unit (≈0.000201917 PKR) to 0.000202 — a 0.041% cost-basis error that *compounds*, because each
  purchase re-weights against the value read back from this column.
- **`pg` type parsers are overridden in `db/pool.ts`**: `NUMERIC` comes back as a real number
  (pg's default is a string) and `DATE` comes back as the literal `'YYYY-MM-DD'` text (pg's
  default is a `Date` object that timezone-shifts on stringification). `activity.txn_date` and
  `cheques.due_date` both depend on the `DATE` override — no `Date` object is ever constructed
  from them, so no timezone shift can occur.

**Current seed state** (verified by query against the live dev database): 10 accounts — `bank`,
`capital`, `cash`, `currency`, `currencyAFN`, `currencyIRR`, `expense`, `margin`, `salaryExpense`,
`salaryPayable` — and 3 `stock_positions` rows (`AED`, `AFN`, `IRR`), all at 0/0. The three
`currency*` accounts are ordinary `is_system` accounts and are deliberately **not** in
`CORE_ACCOUNT_IDS`: nothing resolves them by literal id the way salary posting resolves
`'salaryExpense'`.

## Currencies and the quote convention

**The desk trades three currencies against PKR: AED, AFN, IRR.** `CURRENCIES` in
`packages/engine/src/engine.ts` is derived from `CURRENCY_LIST` in
`packages/engine/src/currencies.ts` — that registry is the single source of truth.

The important subtlety, and the reason `currencies.ts` exists at all: **the three are not quoted
the same way**, because they are not the same order of magnitude as a rupee.

- AED is worth far *more* than a rupee (≈77 PKR). A dealer quotes "PKR per 1 AED" and
  **multiplies**.
- IRR is worth far *less* (1 PKR ≈ 4,952 IRR). Quoting "PKR per 1 IRR" would mean typing
  `0.000202` into a rate box, which no dealer does. It is quoted "IRR per 1 PKR" and **divided**.

So `CurrencyMeta.quote` (`'multiply' | 'divide'`) is not a formatting preference — it is what the
number in the rate box *means*.

Everything downstream works in one canonical unit, **`pkrPerUnit`** — the PKR value of a single
unit — so weighted-average cost, margin, and balance-sheet valuation never need to know which
convention was typed. Only two functions sit on that boundary: `pkrPerUnit()` on entry and
`quoteRate()` on display. **Do not push the raw typed rate any deeper than those.** An unknown
code falls back to plain PKR-per-unit rather than throwing, so old rows keep reading as they
always did.

Server-side, `tradesService.ts` validates `input.currency` against `CURRENCIES` and
`accountsService.ts` validates a Currency Stock account's code the same way — plus rejecting a
second account for an already-tracked currency, since two accounts sharing a code would both
value the same `stock_positions` row and double-count that stock as an asset. The frontend's
account modal is a picker over `CURRENCY_LIST`, not free text, so neither case is reachable by
hand either.

### Transaction dates

`activity.txn_date` is **the date the deal was struck**, distinct from `created_at` (when it was
keyed in). Reports — customer statements, balance-sheet "as of", income-statement periods — cut
on `txn_date`.

- Read it through the engine's **`activityDate()`**, never directly: that helper pins a bare
  `'YYYY-MM-DD'` to *local noon* so no timezone offset can slide it a day, and falls back to
  `createdAt` for rows posted before the column existed.
- `routes/txnDate.ts`'s `parseTxnDate()` is deliberately strict about format rather than handing
  the string to `new Date()` — `Date`'s parser accepts far more than the contract allows and
  resolves a bare `'YYYY-MM-DD'` as UTC, which in a negative-offset zone is the previous local
  day. It rejects malformed, roll-over (`2026-02-30`), future, and pre-2000 dates with a clean
  `400`.
- **The UI currently offers a date picker on trades only, not on settlements.** The
  `/api/settlements/*` endpoints accept and validate `txnDate` exactly as trades do, and there is
  an integration test proving it — but `store.tsx`'s `confirmReceive`/`confirmPay` signatures
  don't include the field, so `Settle.tsx` can't send one and receipts/payments always land on
  today. Wiring it up is frontend-only work.

## Frontend

React 19 + TypeScript 6 + Vite 8 + Tailwind CSS v4 + React Router 7.

### State and data

- **`frontend/src/lib/store.tsx` is a thin API client, not a reducer.** `StoreCtx.state` holds
  `{ accounts, activity, cheques, journalEntries, stocks }` — an in-memory mirror of the server
  snapshot, nothing more.
- **Every mutating action is `async`**, calls its matching endpoint, and on success replaces
  `state` wholesale with the response snapshot. **Nothing computes a guessed result locally and
  shows it before the server confirms.** A failed call leaves `state` untouched, so one failed
  action never blanks out already-loaded data. Two helpers (`mutateString`/`mutateResult`) enforce
  this shape; any new action should use them.
- **`status: 'loading' | 'ready' | 'error'`** plus `loadError`, mirroring `auth.tsx`'s
  `AuthStatus` convention one level down. There is no `'unreachable'` distinction here — every
  failure mode has the same recovery (retry).
- **`refetch()`** re-issues `GET /api/state` and does *not* flip `status` back to `'loading'` —
  only the very first load shows a full-page splash.
- **Identity comes from `useAuth()`, not from store state.** `isAdmin = user?.role !== 'user'`
  and `actor = user?.displayName || user?.email || 'Unknown user'`. **`isAdmin` fails open
  (`true`) while `user` is `null`**; that is harmless only because `Gate()` never renders a
  protected route while `user` is null. It is incidental, not a second layer of defense — don't
  rely on it as one.
- **One `localStorage` key exists app-wide**: `currencydesk.theme.v1` (display preference).
  Business data has no client-side persistence.
- The API fetch helper treats a response with no parseable `error` field as **"Could not reach
  the server."** — the backend's global error handler always emits real `{error: string}` JSON, so
  a missing field means the request never reached Express at all (in dev, that's exactly Vite's
  empty-bodied `502` when the backend is down).

### Routing

Entirely in `frontend/src/App.tsx`; there is no routes-config file. Provider nesting is
`ThemeProvider` → `AuthProvider` → `StoreProvider` → `TooltipProvider` → `BrowserRouter` → `Gate`.

`Gate()` reads `useAuth()`'s 4-way `status` **directly**, not a derived boolean — collapsing
`'checking'` and `'anonymous'` into one value would flash the login screen for a returning user
while their session is still being verified. It then branches on the store's status, and calls
`refetch()` on every `location.pathname` change after the first (a `useRef` skips the first run,
which would duplicate `StoreProvider`'s own initial load).

| Path | Element | Guard |
|---|---|---|
| `/` | redirect → `/dashboard` | — |
| `/dashboard` | `Dashboard` | — |
| `/customers`, `/customers/:id` | `Customers`, `CustomerDetail` | — |
| `/accounts` | `Accounts` | — |
| `/purchase`, `/sale` | `Trade mode="buy"` / `mode="sell"` | — |
| `/receive`, `/pay` | `Settle mode="receive"` / `mode="pay"` | — |
| `/stock` | `Stock` (sidebar labels it "Ledgers") | — |
| `/payments` | `Payments` | — |
| `/cheques` | `Cheques` | — |
| `/transactions` | `Transactions` | — |
| `/journal` | `Journal` | `RequireAdmin` |
| `/salary` | `Salary` | `RequireAdmin` |
| `/balance-sheet` | `BalanceSheet` | `RequireAdmin` |
| `/income-statement` | `IncomeStatement` | `RequireAdmin` |
| `*` | redirect → `/dashboard` | — |

The explicit `key="buy"`/`key="sell"` (and `key="receive"`/`key="pay"`) props force a full remount
when switching modes at different URLs rather than reusing the mounted instance. **Preserve this
pattern** if you touch these routes.

`RequireAdmin` is a render-time guard, not a redirect — it renders `<Denied/>` in place of the
element and the URL doesn't change.

### Roles

`Role = 'admin' | 'user'`, from the authenticated session user.

UI gating (`RequireAdmin`, Sidebar dimming, disabled buttons in `Accounts`/`Cheques`/`Stock`/
`Salary`/`CustomerDetail`, the admin-gated currency ledger on `Stock`) matches the server's
`requireAdmin`/`requireAuth` split on the corresponding routes. **Treat the server check as the
actual boundary**; the UI is the presentation of it.

There is no client-side role switch. To view the other role, sign out and sign in as the other
account. Don't reintroduce a "declare yourself admin" affordance — that is exactly what was
removed when auth became real.

### Key frontend modules

| File | Role |
|---|---|
| `lib/store.tsx` | Business-data API client + `StoreCtx` |
| `lib/auth.tsx` / `lib/authClient.ts` | Session status + login/logout; the client is plain `fetch`, no React |
| `lib/apiBase.ts` | `VITE_API_BASE_URL` prefixing for the cross-origin production topology |
| `lib/engine.ts` / `lib/types.ts` | Re-export shims over `@currencydesk/engine`. `types.ts` additionally defines the four UI-only form-state interfaces (`AcctFormState`, `TradeFormState`, `SettleFormState`, `JournalFormState`) |
| `lib/reports.ts` | Report aggregation on top of the engine (balance sheet, ledger balances) |
| `lib/format.ts` | `fmt`, `fmtNum`, `fmtRate`, `fmtQuote`, `fmtAmount`, `fmtSigned`, `todayISO`, `fmtShortDate`, `fmtLongDate` |
| `lib/theme.tsx` | Theme context; owns `currencydesk.theme.v1` |
| `lib/useBootReady.ts` | Tracks web-font loading (a separate, older boot step from the store's load) |
| `lib/useCountUp.ts` | Numeric count-up animation for KPI tiles |
| `components/charts/StockTrendChart.tsx` | The one real Recharts chart, backed by the engine's `stockTrend()` |
| `components/ui/*` | Radix + `class-variance-authority` primitives, including `kpi-card`, `signed-amount`, `date-picker` |

## Theming and Design System

All color is driven by CSS custom properties defined once in `frontend/src/index.css` under
`@theme`, then overridden in **four** places: `@media (prefers-color-scheme: dark)`,
`:root[data-theme="dark"]` (explicit choice always wins), and a `@media print` block that
force-overrides every token back to fixed light values with `!important`. **Never hardcode a hex
color in a component** — use the Tailwind token utility (`bg-surface`, `text-ink`,
`border-border-strong`) or `var(--color-*)`.

`frontend/index.html` carries an inline pre-paint script that reads `currencydesk.theme.v1` and
sets `data-theme` before any JS module loads, mirroring `ThemeProvider`'s logic exactly, to avoid
a flash of the wrong theme.

### Two cascade-layer traps that have both bitten this project

Tailwind v4 emits utilities into its own `utilities` cascade layer. **A bare, unlayered rule sits
outside all layers and therefore beats every layered rule unconditionally, regardless of
specificity.** Two base rules in `index.css` are wrapped in `@layer base` precisely because they
were silently winning when unlayered:

- `a { color: … }` — this defeated *every* text-color utility on the Sidebar's `NavLink` (the only
  real `<a>` in the app). A "brighten the nav text" utility could never take effect, and two
  commits chased the symptom before the cause was found.
- `:focus-visible { outline: … }` — Radix menu items, Select items, Popover content, and the
  TopBar search deliberately set `outline-none`; unlayered, they could never actually suppress it.

**If you add a bare element-level rule to `index.css`, wrap it in `@layer base`** or it will
silently override utilities somewhere you aren't looking.

### Solid-fill vs. soft-tint

This is a real distinction, not a style choice.

- **Soft-tint** (`bg-X-bg` + `text-X`/`text-X-text` + `border-X-border`) — badges, banners, chips.
  Text and background share a hue family, so contrast direction never flips between themes.
- **Solid-fill** (a colored background with light text on top) — the dangerous case. A hue that
  reads fine as *text on the page* in dark mode often fails 4.5:1 for *white text on top of it*.
  That is why `-solid` variants exist as separate tokens that are identical in light mode and
  diverge in dark: **`accent`, `negative`, `positive`, `inflow`, and `outflow` all have one.**
- **`--color-pending` has no `-solid` variant** — it is currently only ever a tinted badge, chip
  icon, status dot, or thin bar. If you add a solid pending fill with light text, add
  `--color-pending-solid` following the same pattern and verify contrast in dark mode first.
- **Category tints (`--color-cat-*`, `--color-sidebar-cat-*`) are for icon-badge backgrounds
  only** — never card backgrounds or numeric values. The positive/negative/pending state colors
  are the only state signal in the app.

The sidebar has its own fixed dark-navy palette (`--color-sidebar-*`) that does **not** flip with
theme — it is a constant identity surface in both modes, with its contrast ratios documented
inline.

### Radius scale

Three deliberate tiers; the rule is *the denser and more data-like a thing is, the sharper its
corners*. Pick the tier a new element genuinely belongs to rather than choosing a px value by eye
— that is exactly how the old uniform-6px-everywhere look crept in.

| Token | Value | For |
|---|---|---|
| `--radius-data` | 3px | Figures and records: status badges, in-row icon chips, signed-amount chips, ledger cells, progress bars |
| `--radius-control` | 6px | Things people click or type into: buttons, inputs, selects, nav items, menu items |
| `--radius-panel` | 10px | Containers: cards, modals, popovers, KPI tiles |

### Type scale and fonts

A real named scale in `@theme`: `--text-meta` (12), `--text-body` (14), `--text-heading` (22),
`--text-report` (27), `--text-hero` (30), `--text-hero-lg` (36), each with its own line-height.
Fonts are Instrument Sans (body), IBM Plex Mono (numeric, via the `.tabular` utility), and
Instrument Serif (`--font-serif`) — the last used only for report-document titles, which is why
`--text-report` is larger than `--text-heading` (serif at weight 400 carries less optical weight).

### Print

Balance Sheet, Income Statement, customer statements, and the currency ledger get filed as paper,
so the printed page must not depend on the screen's theme. The `@media print` block force-overrides
every token to fixed light values with `!important` (needed to beat both the system-dark media
block *and* the explicit `[data-theme="dark"]` block regardless of cascade order), drops every
shadow, forces `color-scheme: light`, tightens body copy to 12px, forces `.tabular` on numeric
columns belt-and-braces, sets `break-inside`/`break-after` rules so a group header is never
stranded and a total never splits from its table, and sets `@page` margins with extra room at the
foot for the browser's own page-number footer.

Component-level print *visibility* (hiding the sidebar, TopBar, period pills, buttons) is handled
per element with Tailwind's `print:hidden`, not in this block.

When adding any new state color, re-derive its dark-mode hue rather than mechanically darkening
the light one, and check it against the dark page (`--color-app`), the dark card
(`--color-surface`), and its own tint — and add it to the print block too if it can appear on a
printable report.

## Testing and Verification

`npm run test` from the repo root fans out to both suites. **54 tests currently pass: 33 engine
unit tests + 21 backend integration tests across 6 files.** There are **no frontend tests** and
no CI — `npm run test` is a manual step.

### `packages/engine` — 33 unit tests, pure functions, no I/O

`src/engine.test.ts` covers `buyCalc`/`sellCalc` (Credit vs. Cash/Bank `paidNow` capping, negative
margin, explicit currency codes), `openingStock`/`stockAsOf` (weighted-average recompute, replay
as of an earlier date, a mixed AED+IRR book unwinding independently), `marginLedger`,
`chequeNoError`/`nextChequeNumber`, `custEffects`/`customerBalanceAsOf`, the quote conventions
(`pkrPerUnit`/`quoteRate`/`pkrValueOf`, including the unknown-code fallback and zero-rate
handling), `activityDate` (the `createdAt` fallback, local-noon pinning, backdating into an
earlier period), and a **pinned `CORE_ACCOUNT_IDS` regression guard** — that array is what
migration `009`'s trigger is generated from, so a silent change here silently changes what the
database protects.

### `backend` — 21 integration tests, real HTTP against real Postgres

Each file boots a real `http.createServer(createApp())` on an ephemeral port and uses plain
`fetch` (no supertest).

| File | Covers |
|---|---|
| `trades.concurrency.test.ts` | Two concurrent sales that together oversell: exactly one `200`, one `400` with the true remaining balance, stock lands at exactly `0`, one activity row |
| `cheques.concurrency.test.ts` | A deterministically forced `23505` on the shared auto-number, proving the `SAVEPOINT`-protected retry actually recovers with a distinct number |
| `salary.concurrency.test.ts` | Concurrent same-period accrual: one `200`, one `409`, verified by counting rows rather than trusting the responses |
| `salaryBulk.concurrency.test.ts` | 6 tests — `accrue-all` batch tolerance, clean `400` when nothing is left, no double-accrual under concurrency, `pay-all` skipping zero balances, and the deterministic serialization the fixed lock order guarantees |
| `trades.currency.test.ts` | 8 tests — divide-quote valuation and costing, re-weighting against stored PKR-per-unit rather than the typed rate, `txnDate` storage/defaulting/validation on both trades and settlements, unknown-currency rejection, and AED behaving exactly as before the multi-currency change |
| `accountsAndCheque.regression.test.ts` | 4 tests — blank `bankId` on a Cheque-method purchase resolving the default bank, and the three Currency Stock account validations (duplicate code, untraded currency, case normalization) |

### Test database safety

- Backend tests run against a **separate `currencydesk_test` database**, never the dev one.
  `pretest` creates and migrates it, both with `DATABASE_URL` overridden via `cross-env`.
- Each file's `beforeAll` does a full `TRUNCATE … RESTART IDENTITY CASCADE` + reseed
  (`src/test/dbFixtures.ts`). `vitest.config.ts` sets `fileParallelism: false` specifically
  because every file shares that one database.
- **`src/test/guardTestDatabase.ts` throws unless `DATABASE_URL` contains `"_test"`.** This exists
  because a bare `npx vitest run` — bypassing the npm scripts — once truncated the real dev
  database (dotenv only fills in *missing* env vars, so `backend/.env`'s dev URL was used).
  Verified still working: `npx vitest run` inside `backend/` today fails all 6 files immediately
  rather than touching anything. **Always run tests via `npm run test`, never bare `vitest`.**
- Both `packages/engine/tsconfig.json` and `backend/tsconfig.json` `exclude` test files (and
  backend's `src/test/` and `src/scripts/setupTestDb.ts`) — without it, `npm run build` compiles
  test files straight into production `dist/`. Verified clean: a fresh backend build produces no
  test-related output.

### What automated tests do *not* cover

Every React component, every report page, cheque lifecycle transitions end-to-end, the auth
routes, and `deleteAccount`'s success path (only the blocked-by-activity path is exercised).

Correctness there is verified by `tsc -b` (frontend) / `tsc -p tsconfig.json` (backend), `oxlint`,
and **manual verification in the running app against a real local Postgres**:

- **Color/dark-mode/contrast changes**: run the app and take actual screenshots in *both* themes.
  There is no visual test harness. Reasoning about hex values is not verification; when asked to
  confirm a contrast fix, provide screenshots, not descriptions of what should be true.
- **Auth changes**: verify against the real Postgres + Express setup. Session behavior (fixation,
  cookie flags, rate limiting, persistence across reload) cannot be confirmed by reading code.
- **Concurrency**: shelling out two `curl` processes via `&`/`wait` is **not** a reliable way to
  force simultaneity — process-spawn jitter can exceed 100 ms and silently defeats the test. Fire
  both requests from one Node process via `fetch()` + `Promise.all` with no `await` between
  dispatch. Also note that a shared `FOR UPDATE` lock elsewhere in the call path (two purchases of
  the same currency both taking `lockStock()`) will fully serialize requests you meant to race —
  route around it with different customers or currencies.

### Current lint/build status

Verified in this pass: frontend `npm run build` clean, backend `npm run build` clean, `npm run
test` 54/54 passing. `npm run lint` reports **6 warnings, 0 errors** — four
`react(only-export-components)` (files exporting both a component and a hook or constant:
`auth.tsx`, `theme.tsx`, `store.tsx`, `ui/kpi-card.tsx`) and two `react(set-state-in-effect)`
(`useCountUp.ts`, `store.tsx`). These are pre-existing and accepted, not regressions.

## Known Limitations and Open Issues

Two of these are known bugs with a real accounting/security consequence, not just missing polish.

### 1. The balance sheet's "balanced" indicator is self-verifying (open)

`frontend/src/lib/reports.ts` computes a residual (`totalDr - totalCr`), plugs it into the Capital
row, adds it to the running totals, **and only then** returns
`balanced: Math.abs(totalDr - totalCr) < 0.5`. Because the plug is applied to the same totals the
check reads, `balanced` is a tautology — it can essentially never be `false`, so the "Debits and
credits agree across the full dataset" line on `BalanceSheet.tsx` attests to nothing.

The plug itself is legitimate in intent (seeded opening currency stock genuinely predates the
ledger and carries no originating journal entry), and the page *does* surface what was absorbed in
its "Reconciliation — what the equity plug absorbed" panel. The bug is that a real imbalance from
an actual posting error is indistinguishable from the expected opening-stock residual, and the
headline indicator reports success either way. A fix needs to compare against the *pre-plug*
totals, or bound the plug to the known opening-stock figure and report anything beyond it as a
genuine imbalance.

### 2. `GET /api/state` leaks trading margin to the Operator role (open)

`services/stateService.ts`'s `getSnapshot()` takes no role parameter, `mapActivityRow()` emits
`cost` and `margin` on every activity row unconditionally, and `routes/state.ts` guards the
endpoint with `requireAuth` only.

Meanwhile the UI treats exactly that data as Admin-only: `/income-statement` is behind
`RequireAdmin`, and `Stock.tsx` replaces the per-movement currency ledger with a "Movement-by-
movement cost history is restricted to Admin" card for non-admins. So an Operator is shown a
permission boundary that their own `GET /api/state` response already carries straight past — the
desk's per-trade cost and realised margin are in the JSON payload the browser has in hand.

Verified in this pass: an Operator login gets `403` from `/api/journal`, `/api/salary/accrue`, and
`/api/accounts`, but `200` from `/api/state`. (The dev database currently holds zero activity
rows, so there were no live margin values to display — the exposure is established from the route
guard and the unconditional mapper, both unambiguous.)

A fix means either filtering the snapshot by role server-side or accepting and documenting that
the role split is about *actions*, not data — but the current UI actively claims the latter isn't
true.

### 3. Everything else

- **CSRF protection is absent**, and its original justification (`SameSite=Lax`) no longer holds
  in production, which runs `SameSite=None`. The CORS origin allowlist is the only remaining
  protection. See "Authentication".
- **`requireAdmin` trusts a session-cached role** — a role change or deactivation takes effect on
  that user's next login, not immediately.
- **Fixed two-role split** (`admin`/`user`) with no finer-grained permissions and no per-resource
  scoping.
- **Single-tenant schema.** `role` lives directly on `users`; there is no desk/org concept. A
  genuinely multi-desk future needs more than new tables.
- **`FRONTEND_ORIGIN` is missing from `backend/.env.example`** despite being read by `env.ts`.
- **Migrations are not run automatically on deploy.** `userService.ts` carries a
  `hasUsernameColumn` fallback specifically to survive the window where code lands before its
  migration; that fallback is meant to be deleted once production is known to be migrated.
- **Settlements can't be backdated from the UI** even though the API supports it — see
  "Transaction dates".
- **No frontend tests, no CI**, and `deleteAccount`'s success path has no automated coverage.
- **The production build emits a single ~869 kB JS chunk** (253 kB gzipped) with no code
  splitting; Vite warns about it on every build.

### Known stale documentation

**`README.md` is substantially wrong** and was not updated as part of this pass. It still claims
the repo is "the UI only," that it "currently runs entirely in the browser (no server, no database
yet)," that data lives in `localStorage`, that you can "sign in with anything," that there are
"Continue as Admin / Continue as User" buttons, and it documents a `src/lib/seed.ts` that no longer
exists and a flat single-package layout that no longer matches the workspaces structure. Do not
use it as a source of truth; treat this file as canonical until the README is rewritten.

## Important Rules for Coding Agents

- **Don't rewrite working accounting math.** The weighted-average cost, margin, balance-replay,
  and quote-conversion logic in `packages/engine/` and `frontend/src/lib/reports.ts` is real and
  load-bearing for the reports. Changes there ripple into Balance Sheet and Income Statement
  correctness. Auth, theming, and UI work should never need to touch it.
- **Keep the quote convention on its boundary.** Only `pkrPerUnit()` and `quoteRate()` convert
  between the typed rate and canonical PKR-per-unit. Don't let a raw typed rate reach cost math,
  storage, or valuation.
- **New mutating store actions follow the existing pattern**: call the endpoint, replace `state`
  with the response snapshot on success, leave `state` untouched on failure. There is no
  client-side persistence to preserve.
- **New backend mutations go through `handleMutation()`** on one client, one transaction, and
  throw `appError()` for 4xx. Never a bare `pool.query()`, never `Promise.all` over one client.
- **Don't hardcode hex colors in components.** Use the token utility or `var(--color-*)`, respect
  the soft-tint vs. solid-fill distinction, and wrap any new bare element rule in `@layer base`.
- **Identity lives in `useAuth()`.** Don't reintroduce a client-side "declare yourself admin"
  affordance.
- **Keep `config/env.ts` failing fast** on a missing `SESSION_SECRET`/`DATABASE_URL`.
- **Preserve the `key=` remount props** on the `Trade`/`Settle` routes.
- **When verifying a claim against a live database** (proving a constraint holds, reproducing a
  race), do it inside a transaction and roll back — with a `SAVEPOINT` per attempt when an attempt
  is expected to error, since a raised error aborts the transaction until a rollback. Don't mutate
  live data and fix it up afterward; a rollback is a guarantee, a manual fix-up is a mistake
  waiting to happen. The automated suite takes the other valid approach — a wholly separate
  `currencydesk_test` database that gets truncated between files — because it asserts on real
  committed HTTP responses. **Never point a test suite's resets at the dev database**; see
  `guardTestDatabase.ts`.
- **Be precise about what a claim asserts, and verify it rather than describing intent.** "Moved
  verbatim" and "I didn't intend to change it" are different claims — if you aren't going to diff
  it, don't say "verbatim." "This constraint exists" and "this constraint is designed for" are
  different too: a schema decision *motivated* by a rule (`accounts.id` staying `text` because of
  `CORE_ACCOUNT_IDS`) doesn't mean the rule is enforced anywhere. Say which one is true.
- **Avoid new dependencies.** Check whether an existing one already covers the need — Recharts,
  Radix, `lucide-react`, `class-variance-authority`, `tailwind-merge`, and `date`-adjacent helpers
  in `format.ts` are already present.
- The frontend and backend are **separately deployed**. Assume they can be briefly out of step on
  any release, and keep API changes backward-compatible for one deploy cycle (the
  `identifier`/`email` login fallback is the worked example).
