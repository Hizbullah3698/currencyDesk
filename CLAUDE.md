# Currency Desk

## Project Overview

Currency Desk is a front-end for running a currency-exchange counter: buying/selling foreign
currency against a customer, tracking customer receivables/payables, managing inward/outward
cheques through their full lifecycle, running payroll, posting manual journal entries, and
closing the books with a balance sheet and income statement.

It started as a **presentation/demo build** with no backend at all. It now has a real,
server-backed **authentication** layer (Node.js + Express + PostgreSQL, local dev only) —
every accounting screen and calculation is still exactly what it was: real business math,
persisted entirely to the browser's `localStorage`. Only *identity* (who's signed in, what
role they have) is server-authoritative now. See "Current Architecture" below for the precise
split.

## Repo layout: npm workspaces, three packages

The repository root is an **npm workspaces** root (`"workspaces": ["frontend", "backend", "packages/*"]`
in the root `package.json`) containing three packages: **`/frontend`** (the React app),
**`/backend`** (the Express/Postgres server), and **`/packages/engine`**
(`@currencydesk/engine`) — the shared, pure accounting-math module used by both. Each package
has its own `package.json`; `frontend`/`backend` remain independently buildable/runnable apps
(neither requires the other to build or run standalone), while `packages/engine` exists purely
to be depended on, never run directly. A single root-level `package.json`/`package-lock.json`
governs the workspace install (`npm install` from the repo root links all three); it also holds
the `dev:all` convenience script (`concurrently`, runs frontend + backend together) and a
root-level `npm test` that fans out to every workspace's own `test` script. Every `src/...` path
mentioned below is relative to **`frontend/`** unless stated otherwise; backend paths are
relative to **`backend/`**; engine paths are relative to **`packages/engine/`**.

**`@currencydesk/engine` resolution is intentionally different in dev vs. production** — worth
understanding before touching it: its `package.json` uses a conditional `exports` map
(`"development"` → `src/index.ts`, `"default"` → `dist/index.js`). Vite resolves the
`development` condition automatically, so `frontend`'s dev server always sees live source with
no build step. `tsx` (used for every `backend` script) does **not** apply that condition by
default — `backend/package.json`'s scripts explicitly set
`NODE_OPTIONS=--conditions=development` via `cross-env` (a devDependency, needed for this to
work identically on Windows and Unix shells) to get the same live-source behavior. Backend's
actual production path (`npm run build` then `npm start` → `node dist/index.js`) has neither
`tsx` nor that env var, so it correctly resolves to `packages/engine`'s compiled `dist/` —
which is why `backend`'s `build` script runs `npm run build --workspace=@currencydesk/engine`
first. If you add a new script anywhere that imports `@currencydesk/engine` and runs via `tsx`
or plain `node` against TypeScript source, it needs the same `cross-env` treatment or it will
silently resolve stale/missing compiled output instead of live source.

## Business-data migration: in progress (Phases 1-2 of 4 complete)

A migration is underway to move business data (accounts, trades, cheques, journal entries,
salary, currency stock) from frontend-only `localStorage` to Postgres, with the backend
becoming the ledger of record. **Phase 1 (schema + shared engine package) and Phase 2 (API
endpoints) are done; Phases 3 (frontend `store.tsx` rewiring) and 4 (Vitest) are not started.**
Concretely, as of this writing:

- `packages/engine` exists and both `frontend` and `backend` depend on it and build against it
  correctly (verified: `frontend`'s `tsc -b && vite build`, `backend`'s
  `npm run build`/`npm run dev`/`node dist/index.js` all resolve it correctly).
  `frontend/src/lib/engine.ts` and `frontend/src/lib/types.ts` are now thin re-export shims
  (`export * from '@currencydesk/engine'`) — the canonical accounting math lives in
  `packages/engine/src/engine.ts` (moved with exactly one line changed — the internal
  `from './types'` import gained a `.js` extension, required by this package's `NodeNext`
  module resolution; confirmed via an actual `diff` against the pre-move file, not just
  asserted), and canonical domain types live in `packages/engine/src/types.ts`.
  `frontend/src/lib/types.ts` still directly defines the four UI-only form-state interfaces
  (`AcctFormState`, `TradeFormState`, `SettleFormState`, `JournalFormState`) — those have no
  reason to exist in the shared package.
- New Postgres tables exist — `accounts`, `stock_positions`, `cheques`, `activity`,
  `journal_entries` (migrations `003`-`007`) plus a seed migration (`008`) that inserts the same
  eight system accounts `seed.ts` used to create client-side. Schema notes: `accounts.id` stays
  `text` (not uuid) because `CORE_ACCOUNT_IDS` in `engine.ts` hardcodes literal id strings like
  `'capital'`/`'salaryExpense'` that other code resolves directly by id; every other table uses
  native `uuid`. `cheques.number` and `journal_entries.ref` both have real uniqueness enforced
  by the database (a case-insensitive unique index and a `journal_ref_seq`-backed default,
  respectively) — not just an app-level check. A partial unique index
  (`journal_entries_salary_accrual_uniq`) makes "already accrued for this period" a real,
  race-proof DB constraint. All of this was verified directly against a running Postgres
  instance (constraint-violation tests, not just `CREATE TABLE` succeeding).
- **`CORE_ACCOUNT_IDS` protection is enforced at the database level, not just planned for a
  future API check.** Migration `009_lock_core_accounts.ts` installs a `BEFORE UPDATE OR DELETE`
  trigger (`protect_core_accounts`) on `accounts` that rejects a type change or deletion of any
  row whose id is in `CORE_ACCOUNT_IDS` — regardless of which code path touches the table (a
  future API route, an admin script, or a raw query). This trigger's body is **generated from
  the actual `CORE_ACCOUNT_IDS` export of `@currencydesk/engine`** at migration-run time (which
  is why this one migration is `.ts`, not `.sql` — `backend/src/db/migrate.ts` now supports both,
  see its own comments), so the id list is never hand-duplicated into SQL. Verified by actually
  attempting the rejected operations against a real Postgres connection (inside a transaction
  with savepoints per attempt, rolled back at the end so nothing was actually mutated) — both a
  type change and a deletion of the `capital` account were rejected with Postgres error code
  `23514`, while the identical operations against a non-core account succeeded, confirming the
  trigger doesn't over-restrict. A Phase 2 API-layer check should still exist on top of this for
  a clean 4xx response — the trigger is the actual enforcement, the API check is UX.
- **A full business-data API now exists in `backend/src/routes/`** — `trades.ts`
  (`POST /api/trades/purchase|sale`), `settlements.ts` (`POST /api/settlements/receive|pay`),
  `cheques.ts` (`POST /api/cheques/:id/deposit|clear|return`), `journal.ts`
  (`POST /api/journal`), `salary.ts` (`POST /api/salary/accrue|accrue-all|pay|pay-all`),
  `accounts.ts` (`POST /api/accounts`, `PATCH/DELETE /api/accounts/:id`,
  `POST /api/accounts/:id/archive|unarchive`), and `state.ts` (`GET /api/state`). Every one of
  these has a same-named counterpart it replaces in `frontend/src/lib/store.tsx` — the mapping
  is 1:1 (`confirmPurchase` → `/api/trades/purchase`, `postJournal` → `POST /api/journal`, etc.).
  **`frontend/src/lib/store.tsx` itself is still completely unchanged** — none of these routes
  are called from the frontend yet; that's Phase 3. Do not assume `store.tsx` is async, and do
  not assume the frontend actually talks to any of this yet — it doesn't, on purpose, until
  Phase 3 rewires it.
- **Response contract**: every mutating endpoint (and `GET /api/state`) returns the exact same
  shape, `{ accounts, activity, cheques, journalEntries, stocks }` — a full, freshly-queried
  snapshot, read with the SAME database client that just performed the mutation, inside the
  still-open transaction, immediately before `COMMIT` (`services/stateService.ts`'s
  `getSnapshot()`, called by `services/transact.ts`'s `runMutation()`/`handleMutation()` helpers
  every route uses). This is deliberate: the mutation response *is* the refetch, so "server
  response is the source of truth" and "refetch after every mutation" collapse into one
  mechanism, with no separate round-trip.
- **Concurrency guards, verified under genuine concurrent HTTP load, not just sequential
  logic**: two simultaneous `sale` requests that together exceed available stock — exactly one
  succeeds, the other gets a clean 400 with the *true* remaining balance (proving the loser's
  `FOR UPDATE`-guarded check ran against the winner's already-committed update, not a stale
  pre-transaction read); two simultaneous `salary/accrue` requests for the same employee/period
  — exactly one succeeds, confirmed by counting the actual rows afterward, not just trusting the
  two HTTP responses. `receive`/`pay` use a guarded `UPDATE ... WHERE receivable/payable >= $amount`
  (not a bare relative-delta update) so two concurrent settlements can't jointly drive a balance
  negative. Cheque deposit/clear/return use a guarded `UPDATE ... WHERE status = '...'`, `rowCount
  === 0` → `409`. `accrueAllSalaries` uses per-row `INSERT ... ON CONFLICT DO NOTHING` (a single
  violation must not abort accrual for every other employee in the same batch); `payAllSalaries`
  locks every target employee row in a fixed `ORDER BY id` to avoid a real deadlock between two
  concurrent bulk-pay runs.
- **Authorization**: `requireAdmin` is applied on `journal.ts`, `salary.ts` (all four routes),
  and every mutating route in `accounts.ts` — matching exactly what the frontend UI already
  treats as Admin-only (confirmed by checking `App.tsx`'s `RequireAdmin` route guards and
  `Accounts.tsx`'s own `isAdmin` check). `trades.ts`/`settlements.ts` and cheque *deposit* are
  `requireAuth` only; cheque *clear*/*return* are `requireAdmin` (matches the existing
  restricted-access banner text in `TopBar.tsx`). Verified by logging in as each seeded role and
  hitting every route group directly — the operator got a real `403` from every admin-only route
  and a normal business-logic response (not a `403`) from every requireAuth-only one.
- **Four real bugs were found and fixed during this verification, not caught by type-checking**
  (two on the first pass, two more once the cheque-number collision was actually forced — see
  below):
  1. `settlementIdFor()` returned `''` for a Credit trade, which violated
     `activity.settlement_account_id`'s foreign key (`''` is not `NULL`) — fixed to return `null`.
  2. `stateService.ts` and `journalService.ts` both fired multiple `client.query()` calls via
     `Promise.all()` on a single checked-out `PoolClient` inside a transaction — a single client
     can only run one query at a time; `pg` currently only warns about this (a deprecation
     notice) but it will be a hard error in a future major version. Both are now sequential.
     Watch for this pattern in new service code — it's easy to reach for `Promise.all` out of
     habit and not notice the deprecation warning in a busy log.
  3. `settlementsService.ts`'s `receive`/`pay` passed the raw, possibly-blank `input.bankId`
     straight through to `insertCheque` as `bankAccountId`, instead of the already-resolved
     `settlementAccountId` (which falls back to the default bank account when blank, exactly
     like `trades.ts` already did correctly). A blank `bankId` on a Cheque-method receive/pay
     violated `cheques.bank_account_id`'s foreign key. This is a real gap the old localStorage
     version silently tolerated (no FK to violate) that the new schema correctly caught — fixed
     by reusing the resolved `settlementAccountId` instead of the raw input.
  4. `insertCheque`'s retry-on-conflict had **no `SAVEPOINT`** around the risky `INSERT`. A
     `23505` there aborted the whole enclosing transaction, so the retry's own next `SELECT`
     would have failed with "current transaction is aborted" before it ever got to recompute
     anything — silently defeating the entire retry mechanism the very first time it was needed.
     Fixed with `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` around the insert attempt.
- **The cheque-number collision/retry mechanism (bug 4 above) was verified by forcing an actual
  collision, not just reasoning about the code**: pre-consuming `cheque_number_seq` to learn its
  position, pre-inserting a blocker cheque at the number the *lower* of the next two dispensed
  seeds would land on (forcing that request to skip forward onto the number the *other*
  request's seed would independently compute), then firing two requests from a single Node
  process in the same tick (via `Promise.all`, not two separate shelled-out `curl` processes —
  those turned out to arrive ~400ms apart purely from OS process-spawn jitter, not a code issue,
  which silently defeated the first several attempts at this test). Confirmed via a temporary
  timestamped trace that both requests' reads landed within 1ms of each other, both computed the
  identical number, the loser hit a genuine `23505` on `cheques_number_uniq`, and — critically —
  its retry (only possible because of the `SAVEPOINT` fix above) succeeded with a freshly
  computed, distinct number. Final state confirmed by query, not just trusting the two HTTP
  responses: both cheques exist, numbers are different, no duplicate numbers anywhere in the
  table. (Also note for future concurrency testing, including Phase 4: shelling out two `curl`
  processes via `&`/`wait` is not a reliable way to force simultaneity — process-spawn jitter
  can easily exceed 100ms. Firing both requests from one Node process via `fetch()` +
  `Promise.all`, with no `await` between dispatching them, is far more reliable. Separately, a
  shared `FOR UPDATE` lock elsewhere in the same call path — e.g. two `purchase` calls for the
  same currency both taking `lockStock()`'s lock — will fully serialize two requests that would
  otherwise race; a test that wants to isolate a *different* concurrency mechanism needs to
  route around any such shared lock, e.g. by using two different customers/currencies.)
- **`CORE_ACCOUNT_IDS` protection now has both layers described in the original plan**: the
  Phase 1 DB trigger is the real enforcement (see below), and Phase 2 added the matching
  app-level check in `accountsService.ts` for a clean `400` instead of a raw constraint-violation
  `500` — verified by hitting `PATCH`/`DELETE /api/accounts/capital` directly and getting the
  friendly message, not a stack trace.
- **Not yet exercised by this verification pass** (noted honestly, not assumed fine):
  `accrueAllSalaries`/`payAllSalaries` (bulk endpoints — logic mirrors the single-row versions
  closely but wasn't independently hit) and `deleteAccount`'s success path (only the
  blocked-by-activity path was exercised). Explicitly deferred by the user, not an oversight.
- **The local dev Postgres database has been wiped back to exactly the eight seed accounts**
  (zero activity/cheques/journal entries, `stock_positions` reset to `AED: 0/0`,
  `cheque_number_seq`/`journal_ref_seq` both reset) after this verification pass generated real
  test data — confirmed by query, not assumed: `TRUNCATE ... RESTART IDENTITY CASCADE` on the
  five business tables, sequences reset, then migration `008`'s exact seed rows re-inserted by
  hand (its `schema_migrations` record was left alone — `npm run migrate` still correctly
  reports every migration, including `008`, as already applied). `users`/`session` were **not**
  touched — the seeded `admin@currencydesk.local`/`user@currencydesk.local` accounts and any
  active login sessions are unaffected. This state is what Phase 3 will be built against.
- Confirmed still true and unaffected: everything in "Current Architecture" and "State and
  Data" below describing business data as frontend-only/localStorage-only — **that description
  is about what the frontend does, which Phase 2 did not touch.** The backend now has a real
  API; the frontend does not call it yet.
- Still pending, not yet decided: `resetDemoData` (today's single client-side "wipe to seed"
  action, called only from `BalanceSheet.tsx`) is planned for outright removal once Phase 3
  lands, since there's no honest server-authoritative equivalent — confirmed by the user, not
  yet implemented.

## Current Architecture

- **Hybrid: real auth backend, business data still frontend-only in practice.** `/backend`
  (Express + PostgreSQL) owns user accounts, password checks, and sessions. Everything else —
  accounts, trades, cheques, journal entries, salary, reports — has **no API and no connected
  database**; it lives entirely in the browser under `localStorage` key `currencydesk.state.v1`,
  exactly as before. **Precision matters here**: as of the in-progress business-data migration's
  Phase 1 (see that section above), Postgres tables for this data now exist, but nothing reads
  or writes them — there is no route, and `store.tsx` is unchanged. Don't assume a schema
  existing means an API exists too; check "Business-data migration" above for exactly how far
  that work has actually gotten.
- **All business state lives in `localStorage`**, hydrated synchronously on load
  (`frontend/src/lib/store.tsx`). There is no async data-fetch step for business data — the one
  asynchronous thing that happens at boot, besides the auth session check below, is web-font
  loading, tracked by `frontend/src/lib/useBootReady.ts` purely to avoid a layout flash.
- **Login is now real.** `frontend/src/pages/Login.tsx` submits `{ email, password }` to
  `POST /api/auth/login`; a wrong password or unknown email returns a real `401` and the UI
  shows it. There is no "any credentials sign in as Admin" behavior anymore.
- **Sessions persist across reload, by design — a deliberate change from the old demo build.**
  On boot, `frontend/src/lib/auth.tsx`'s `AuthProvider` calls `GET /api/auth/me` once; the
  browser sends the httpOnly session cookie automatically, so a returning user with a live
  session lands straight in the app with no re-login. Signing out is a real server round-trip
  (`POST /api/auth/logout`) that destroys the server-side session.
- **The auth backend is local-dev only.** No production deployment (Vercel serverless, a
  managed Postgres provider, HTTPS cookie settings) has been designed or built. Running it
  requires a local Postgres (`backend/docker-compose.yml`) and the Express server running
  alongside the Vite dev server (see "Development"). The frontend's own static-SPA Vercel
  deployment (`frontend/vercel.json`) is unaffected and unrelated to this backend.
- Business data still makes zero network requests — the only network calls anywhere in the app
  are the three auth endpoints (`/api/auth/login`, `/logout`, `/me`) and the Google Fonts
  `@import` in `frontend/src/index.css`.

**Do not assume more has changed than this.** There is still no business-data API, no
persistence layer for accounts/trades/cheques/journal/salary beyond `localStorage`, and no
production hosting story for the backend. If a future task migrates business data to Postgres
too, treat that as new, deliberate work — nothing here was built to make that migration free.

## Authentication

Backend: `/backend` (a separate npm package — own `package.json`/`tsconfig.json`/`node_modules`,
Node + Express + `pg`).

- **Sessions, not JWT.** `express-session` + `connect-pg-simple` (a Postgres-backed session
  store, table `session`) issue an httpOnly cookie (`cd.sid` by default, `COOKIE_NAME` env var).
  `secure: false` because local dev is plain `http://localhost` — this **must** become `true`
  before any real HTTPS deployment. `sameSite: 'lax'`, 30-day `maxAge`, `rolling: true` (any
  authenticated request refreshes the window, so "persistent login" means "until actually idle
  for 30 days or explicit sign-out," not a hard 30-day cliff from first login).
- **`users` table** (`backend/src/db/migrations/001_create_users.sql`): `id` (uuid),
  `email` (unique via a `lower(email)` index, not a raw unique constraint), `password_hash`
  (bcryptjs, cost 12 — chosen over native `bcrypt`/`argon2` specifically to avoid a native
  build step in this dev environment; revisit if this ever handles real financial data in
  production), `display_name`, `role` (`CHECK IN ('admin','user')`, mirrors
  `frontend/src/lib/types.ts`'s `Role` type exactly), `is_active`, timestamps. **Deliberately no
  business-data tables** — schema is shaped so a future migration could add one Postgres table
  per `types.ts` interface, but that is *not* done and the schema is implicitly single-tenant
  (role lives directly on `users`, no desk/org concept) — a true multi-desk future would need
  more than new tables.
- **Routes** (`backend/src/routes/auth.ts`), all under `/api/auth`:
  - `POST /login` — `{email,password}` → `200 {user}` + `Set-Cookie`, or `400` (missing
    fields) / `401` (bad credentials — **same message for unknown-email and wrong-password**,
    and a dummy `bcrypt.compare` runs even on an unknown email, so response timing doesn't leak
    which emails are registered) / `403` (`is_active = false`). Rate-limited
    (`express-rate-limit`, 20 attempts / 15 min per IP).
  - `POST /logout` — always `204`, destroys the session, clears the cookie.
  - `GET /me` — `200 {user}` for a live session, `401` otherwise. This is the one call
    `AuthProvider` makes on every app boot.
  - `GET /api/health` — unauthenticated liveness check.
- **Session mechanics**: on successful login, `req.session.regenerate()` runs *before* setting
  `req.session.userId`/`role`, preventing session fixation. `requireAuth`/`requireAdmin`
  middleware (`backend/src/middleware/`) check `req.session.userId`/`role` — **`requireAdmin`
  trusts the role cached in the session at login time and never re-queries `users` per
  request**, so a role change or deactivation takes effect on that user's *next* login, not
  instantly. Neither middleware is currently applied to any business-data route, because none
  exists.
- **CSRF is deliberately not implemented.** Justification: the only state-changing routes are
  POST-only, and `SameSite=Lax` blocks the session cookie on cross-site POSTs. This reasoning
  breaks if a future business-data mutation is ever exposed as a GET, or if a future production
  hosting setup breaks the same-origin-via-proxy assumption below — re-examine then.
- **Local dev networking**: `frontend/vite.config.ts` proxies `/api/*` to
  `http://localhost:3001` (Express), so the browser sees everything as same-origin — no CORS
  configuration, no cross-origin cookie subtlety. This only affects `vite dev`, never
  `vite build` or `vercel.json`.
- **Env config fails fast**: `backend/src/config/env.ts` throws on startup if `SESSION_SECRET`
  (or `DATABASE_URL`) is missing, rather than silently falling back to an insecure default.
- **Bootstrapping users**: there is no signup flow. `npm run create-user -- --email ... --password ... --role admin --name "..."` (`backend/src/scripts/createUser.ts`, enforces an
  8-character minimum) creates one account; `npm run seed:demo` (`backend/src/scripts/seedDemo.ts`)
  creates two fixed local-dev accounts and prints their credentials to the console — the direct
  replacement for the old build's "any password works."

### Frontend integration

- `frontend/src/lib/authClient.ts` — plain `fetch` wrapper (`login`/`logout`/`me`), no React,
  same "pure" philosophy as `engine.ts`.
- `frontend/src/lib/auth.tsx` — `AuthProvider`/`useAuth()`. Holds `user` and a **4-way
  `status`**: `'checking'` (initial `/me` call in flight) → `'authenticated'` or `'anonymous'`,
  or `'unreachable'` if the backend can't be reached at all (distinct from "logged out," since
  `npm run dev` inside `frontend/` alone does **not** start the Express server — see
  "Development"). `AuthProvider` sits above `StoreProvider` in `frontend/src/App.tsx` —
  `StoreProvider` reads `useAuth()` for identity.
- `frontend/src/App.tsx`'s `Gate()` reads `useAuth()`'s `status` **directly**, not through
  `useStore()` — branching on a derived boolean there would collapse `'checking'` and
  `'anonymous'` into the same value and flash the login screen for a returning user while their
  session is still being verified. `'checking'` renders a boot splash, `'unreachable'` renders a
  "can't reach the server" message, `'anonymous'` renders `<Login/>`, `'authenticated'` renders
  the routed app. `RequireAdmin` is unchanged — still just reads `isAdmin` off `useStore()`.
- `frontend/src/lib/store.tsx`: `role` and `userName` are **gone** from the persisted
  `localStorage` shape (old saved blobs that still have those keys just carry them over as
  harmless unused extra JSON properties — no migration needed). `isAdmin = user?.role !== 'user'`
  and `actor = user?.displayName || user?.email || 'Unknown user'` now derive from the session
  user. **`isAdmin` fails open (`true`) while `user` is `null`** (during `'checking'`, or once
  signed out) — this mirrors the app's pre-existing loose `role !== 'user'` pattern and is
  harmless only because `Gate()` never renders any protected route while `user` is null; that's
  incidental, not a deliberate second layer of defense — don't rely on it as one. `login`,
  `logout`, and `setRole` no longer exist on `StoreCtx` — use `useAuth()` for those.
- **What was removed as a direct consequence** (not touched arbitrarily): the TopBar's
  "Viewing as Admin/User" one-click role-switch pill (there's no server-side equivalent to
  "declare yourself admin" — `TopBar.tsx` now shows a read-only "`{actor}` · Admin/Operator"
  chip instead) and `Denied.tsx`'s "Switch to Admin" bypass button (`setRole` no longer exists).
  To see the other role's view now, sign out and sign in as the other seeded account.

## Technology Stack

Verified against `frontend/package.json` / `frontend/package-lock.json` and
`backend/package.json` / `backend/package-lock.json`:

**Frontend (`/frontend`)**
- **React 19** (`19.2.8`) + **TypeScript** (`~6.0.2` range in `package.json`, locked to `6.0.3`,
  i.e. TypeScript 6, not 5)
- **Vite 8** (`^8.2.0` range in `package.json`, locked to `8.2.1`) via `@vitejs/plugin-react` —
  dev server and build; now also proxies `/api` to the local Express server (`vite.config.ts`)
- **React Router 7** (`react-router-dom@7.18.2`) — `BrowserRouter`/`Routes`/`Route`
- **Tailwind CSS v4** (`4.3.3`) via the `@tailwindcss/vite` plugin — CSS-first config, **no**
  `tailwind.config.js`/`.ts`/`.cjs` and no PostCSS config file. All theming lives in the
  `@theme` block in `src/index.css`.
- **Radix UI primitives** (`checkbox`, `dialog`, `dropdown-menu`, `label`, `popover`, `select`,
  `slot`, `tabs`, `tooltip`) + **`class-variance-authority`** (`0.7.1`) + **`clsx`** +
  **`tailwind-merge`** for `src/components/ui/*`
- **`lucide-react`** (`1.32.0`) for icons
- **`recharts`** (`3.10.1`) is listed as a dependency but is **not currently imported or used
  anywhere in `src/`** (verified: no `from 'recharts'` import exists in the codebase, and
  `Dashboard.tsx`'s "chart" prop only drives a loading-skeleton placeholder). The README
  currently claims Recharts powers the dashboard charts — that claim is stale/aspirational;
  don't rely on it.
- **`oxlint`** is the linter, run as `oxlint src` (`npm run lint`, from inside `frontend/`) —
  scoped to the frontend's own `src/`, **not ESLint** — configured via `.oxlintrc.json`
  (`react`, `typescript`, `oxc` plugins; `react/rules-of-hooks: error`).
- No frontend test framework is installed.

**Backend (`/backend`)**
- **Express** — HTTP server and routing.
- **`express-session` + `connect-pg-simple`** — server-side sessions backed by PostgreSQL.
- **`pg`** — Postgres driver (a plain connection pool, no ORM).
- **`bcryptjs`** — pure-JS password hashing (no native compilation step).
- **`express-rate-limit`** — brute-force throttling on `/api/auth/login`.
- **`dotenv`** — loads `backend/.env` (see `backend/.env.example`).
- **`tsx`** — runs the TypeScript backend directly in dev (`npm run dev` from inside `backend/`)
  without a separate build step; `tsc` still compiles it for `npm run build`.
- **PostgreSQL 16** (`backend/docker-compose.yml`, `postgres:16-alpine`) — local dev only, no
  managed/production Postgres has been configured.
- No backend test framework is installed either.

**Shared (`/packages/engine`)**
- `@currencydesk/engine` — the pure accounting-math module (weighted-average cost, buy/sell
  calc, balance-as-of-date replay, margin ledger, cheque numbering, `CORE_ACCOUNT_IDS`) plus the
  domain types it depends on, shared verbatim between `frontend` and `backend` via npm
  workspaces rather than ported/duplicated. See "Repo layout" above for its dev-vs-production
  resolution mechanics — this matters if you ever add a script that imports it.
- No test framework installed yet (Vitest is planned for a later migration phase, not yet added).

**Root-level dev convenience (`/`)**
- The repo root is the npm workspaces root (see "Repo layout") and holds `concurrently`
  (`dev:all` script, runs the frontend and backend dev servers together in one terminal) plus a
  fan-out `test` script (`npm run test --workspaces --if-present`).

## Repository Structure

```text
F:\currencyDesk\
├── package.json             npm workspaces root (frontend, backend, packages/*) + dev:all/test
│                            fan-out scripts — not a dependency of any workspace package
├── README.md                 User-facing project description (see stale-recharts-claim note)
├── CLAUDE.md                 This file
├── packages/
│   └── engine/                @currencydesk/engine — shared pure accounting math, see
│       ├── package.json          "Technology Stack" → Shared, and "Repo layout" above for its
│       ├── tsconfig.json          dev-vs-production resolution mechanics
│       └── src/
│           ├── engine.ts            Moved verbatim from the old frontend/src/lib/engine.ts —
│           │                       zero logic changes, only its file location moved
│           ├── types.ts              Domain types only (Account, Activity, Cheque,
│           │                       JournalEntry, Role, Stocks, ReportPreset, RangeBounds, etc.)
│           └── index.ts               Re-exports both of the above
├── frontend/                 The React/Vite app — independent npm package
│   ├── package.json / package-lock.json
│   ├── index.html              Vite entry HTML; inline pre-paint script reads the theme key
│   │                          from localStorage and sets data-theme before any JS module
│   │                          loads, to avoid a flash of the wrong theme
│   ├── vercel.json              SPA rewrite (all paths → index.html) for Vercel hosting — the
│   │                          Vercel project's Root Directory setting must point at `frontend`
│   │                          for this to be picked up
│   ├── vite.config.ts           @vitejs/plugin-react + @tailwindcss/vite, `@` → ./src alias,
│   │                          and a dev-only /api proxy to the local Express server
│   ├── tsconfig.json            Project-references root (tsconfig.app.json + tsconfig.node.json)
│   ├── .oxlintrc.json           oxlint config (npm run lint scopes it to this package's src/)
│   └── src/
│       ├── main.tsx              React root bootstrap (StrictMode + createRoot)
│       ├── App.tsx                Route table + `RequireAdmin` guard + provider nesting
│       │                        (ThemeProvider > AuthProvider > StoreProvider > BrowserRouter)
│       ├── index.css               Tailwind v4 entry + Google Fonts import + all `@theme`
│       │                          color tokens + dark-mode override blocks + print stylesheet
│       ├── components/
│       │   ├── AccountFormModal.tsx    Create/edit-account dialog, incl. admin-only type-override
│       │   ├── BackButton.tsx           Shared "back" nav button
│       │   ├── PrintHeader.tsx          Print-mode header used by report pages
│       │   ├── layout/
│       │   │   ├── AppShell.tsx          Sidebar + TopBar + content-area shell
│       │   │   ├── Sidebar.tsx           Left nav; dims + locks admin-only items for
│       │   │   │                        non-admins; footer derives "Signed in as" from isAdmin
│       │   │   ├── TopBar.tsx            Search, read-only identity chip (actor + role),
│       │   │   │                        clickable stat strip, ThemeToggle, real sign-out
│       │   │   ├── ThemeToggle.tsx       Light/Dark/System 3-way control
│       │   │   └── Logo.tsx              App logo mark
│       │   └── ui/                       Radix-based primitives styled with
│       │                                 class-variance-authority: badge, button, card,
│       │                                 dialog, dropdown-menu, empty-state, input, select,
│       │                                 skeleton, tabs, tooltip
│       ├── lib/
│       │   ├── store.tsx           Global business-data state (StoreCtx) + every
│       │   │                       state-mutating action — see "State and Data"; identity now
│       │   │                       sourced from auth.tsx
│       │   ├── auth.tsx              AuthProvider/useAuth() — session status + login/logout,
│       │   │                       talks to the backend via authClient.ts
│       │   ├── authClient.ts          Plain fetch wrapper for /api/auth/* — no React
│       │   ├── engine.ts            Thin re-export shim (`export * from '@currencydesk/engine'`)
│       │   │                       — the actual accounting math now lives in
│       │   │                       packages/engine/src/engine.ts, see above
│       │   ├── format.ts              Number/currency/date formatting helpers
│       │   ├── reports.ts            Report aggregation built on engine.ts (e.g.
│       │   │                       ledgerBalance() for Balance Sheet rows)
│       │   ├── seed.ts                Seed data — system accounts only; seedActivity/
│       │   │                       seedCheques/seedJournalEntries all return `[]` (demo
│       │   │                       desk starts blank). Slated for deletion once the
│       │   │                       business-data migration's later phases land.
│       │   ├── theme.tsx              Theme context/provider — see "Theming" below
│       │   ├── types.ts               Re-exports domain types from @currencydesk/engine, plus
│       │   │                       the 4 UI-only form-state interfaces (AcctFormState,
│       │   │                       TradeFormState, SettleFormState, JournalFormState) that
│       │   │                       stay frontend-only
│       │   ├── ui-helpers.tsx          Icon/color metadata maps for activity/cheque/status
│       │   │                       badges
│       │   ├── useBootReady.ts          Tracks the one real async boot step (web-font loading)
│       │   └── utils.ts               `cn()` — clsx + tailwind-merge combiner
│       └── pages/                  One file per screen: Dashboard, Customers, CustomerDetail,
│                                    Accounts, Trade (buy/sell), Settle (receive/pay), Stock,
│                                    Payments, Cheques, Journal, Salary, Transactions,
│                                    BalanceSheet, IncomeStatement, Login (real credential
│                                    form), Denied
└── backend/                   The auth server — independent npm package, see "Authentication"
    ├── package.json / package-lock.json / tsconfig.json / .env.example
    ├── docker-compose.yml       Local Postgres 16 for this backend (dev only)
    └── src/
        ├── index.ts               Entrypoint — builds the app, calls app.listen()
        ├── app.ts                  Express app assembly: json body parsing, session
        │                          middleware, routes, a global error-handling middleware
        ├── config/env.ts            Loads + validates env vars; fails fast if SESSION_SECRET
        │                          or DATABASE_URL is missing
        ├── db/
        │   ├── pool.ts                pg.Pool singleton
        │   ├── migrate.ts              Tiny idempotent migration runner (tracks applied files
        │   │                          in a schema_migrations table) — run via `npm run migrate`.
        │   │                          Supports both .sql files (run verbatim) and .ts files
        │   │                          (dynamically imported, calls their exported `up(client)`)
        │   │                          — a migration is .ts only when its content must be
        │   │                          derived from TypeScript source rather than duplicated
        │   │                          into SQL by hand
        │   └── migrations/              001_create_users.sql, 002_create_sessions.sql (auth),
        │                                003-007_create_{accounts,stock_positions,cheques,
        │                                activity,journal_entries}.sql, 008_seed_system_accounts.sql,
        │                                009_lock_core_accounts.ts (a DB trigger generated from
        │                                @currencydesk/engine's CORE_ACCOUNT_IDS — see
        │                                "Business-data migration" above)
        ├── middleware/
        │   ├── session.ts              express-session + connect-pg-simple config
        │   ├── requireAuth.ts            401s if no session
        │   ├── requireAdmin.ts            401/403s if no session / role isn't admin
        │   └── asyncHandler.ts             Forwards a rejected async route handler's error to
        │                                the global error middleware — Express 4 doesn't do this
        │                                on its own; every business-data route uses it
        ├── routes/
        │   ├── auth.ts, health.ts             /api/auth/* and /api/health
        │   ├── state.ts                        GET /api/state — full snapshot, requireAuth only
        │   ├── trades.ts                        POST /api/trades/purchase|sale — requireAuth
        │   ├── settlements.ts                    POST /api/settlements/receive|pay — requireAuth
        │   ├── cheques.ts                         POST /api/cheques/:id/deposit (requireAuth) |
        │   │                                     clear|return (requireAdmin)
        │   ├── journal.ts                          POST /api/journal — requireAdmin
        │   ├── salary.ts                            POST /api/salary/accrue|accrue-all|pay|
        │   │                                       pay-all — requireAdmin (all four)
        │   └── accounts.ts                          POST/PATCH/DELETE /api/accounts[/:id],
        │                                           POST /api/accounts/:id/archive|unarchive —
        │                                           requireAdmin (all of them)
        ├── services/
        │   ├── authService.ts            password hashing/verification, anti-enumeration timing
        │   ├── userService.ts             user lookups/creation (parameterized SQL via pg)
        │   ├── transact.ts                  `runMutation()`/`handleMutation()` — every mutating
        │   │                             route runs on one checked-out client, one transaction,
        │   │                             reads the fresh snapshot before COMMIT; `appError()`/
        │   │                             `isAppError()` for clean 4xx responses
        │   ├── stateService.ts               `getSnapshot()` — assembles the full StateSnapshot
        │   │                             from all 5 business tables (sequential queries, not
        │   │                             Promise.all — see "Business-data migration" above)
        │   ├── mappers.ts                     Row (snake_case) → API shape (camelCase) mapping
        │   │                             per table, matching @currencydesk/engine's types exactly
        │   ├── userLookup.ts                   One query to resolve created_by/updated_by uuids
        │   │                             to display names, reused across a request
        │   ├── accountHelpers.ts                getAccount/settlementName/settlementIdFor/
        │   │                             accountHasActivity — shared across every service below
        │   ├── chequeHelpers.ts                   insertCheque() — auto-numbering with a
        │   │                             sequence-seeded scan + retry-once-on-conflict
        │   ├── tradesService.ts, settlementsService.ts, chequeService.ts, journalService.ts,
        │   │   salaryService.ts, accountsService.ts
        │   │                             One file per route group's actual business logic —
        │   │                             each function here is the server-side replacement for
        │   │                             the same-named action in frontend/src/lib/store.tsx
        ├── scripts/
        │   ├── createUser.ts               CLI: create one user
        │   └── seedDemo.ts                  CLI: create the two fixed local-dev accounts
        └── types/express-session.d.ts        Module augmentation: req.session.userId / role
```

## State and Data

- All **business** state lives in `frontend/src/lib/store.tsx`, persisted to `localStorage`
  under the key **`currencydesk.state.v1`**. Persisted shape: `accounts`, `activity`, `cheques`,
  `journalEntries`, `stocks`, `nextId`, `nextJnlNo`, `nextChequeNo`, `pristine`. **`role` and
  `userName` are no longer part of this shape** — identity lives server-side now (see
  "Authentication"); `useStore()`'s `isAdmin`/`actor` derive from `useAuth()`'s session user
  instead of from persisted state.
- **`pristine`** is `true` only for data that has never been touched by a real mutating action.
  `mutate()` (the single choke point every mutating store action goes through) always sets
  `pristine: false`, so it can't be forgotten at an individual call site. `pristine` gates a
  date-staleness auto-reseed in `loadState()`: since the seed itself now ships with **no** demo
  transactions (`seedActivity`/`seedCheques`/`seedJournalEntries` all return `[]`), an untouched
  session always re-seeds on load so the built-in system accounts' timestamps stay honestly "now"
  rather than freezing at first-ever load — but the moment there's a same-day trade, or any real
  mutating action has ever happened, this reseed never runs again. On load, saved state is merged
  over a fresh seed with an explicit `pristine: saved.pristine === true` check, so any
  pre-existing save with no `pristine` key (or corrupted JSON) is always treated as **not**
  pristine — real data is never silently wiped.
- If you add a new mutating action to the store, it must go through `mutate()` (or otherwise
  clear `pristine` the same way) — this is the mechanism that protects real user-entered data
  from the demo auto-reseed.
- **Every mutating store action routed through `mutate()`**: `saveAccount`, `deleteAccount`,
  `archiveAccount`, `unarchiveAccount`, `confirmPurchase`, `confirmSale`, `confirmReceive`,
  `confirmPay`, `postJournal`, `depositCheque`, `clearCheque`, `returnCheque`, `accrueSalary`,
  `accrueAllSalaries`, `paySalary`, `payAllSalaries`. `resetDemoData()` bypasses `mutate()`: it
  clears `currencydesk.state.v1` directly and reseeds with `pristine: true` (the opposite of
  what `mutate()` does), since a reset is explicitly meant to return to a fresh, untouched demo
  state — it does not touch the auth session, so resetting demo data never signs you out.
- **`CORE_ACCOUNT_IDS`** (`packages/engine/src/engine.ts`, re-exported through
  `frontend/src/lib/engine.ts`): `bank`, `cash`, `margin`, `expense`, `salaryExpense`,
  `salaryPayable`, `capital` — these system accounts can never change type or be deleted, even
  by Admin. This is a structural constraint (the accounting engine hard-codes these ids), not a
  permissions policy — don't relax it as part of any future role/permissions work without also
  reworking `engine.ts`. It's also why the new Postgres `accounts.id` column is `text`, not
  `uuid` (see "Business-data migration" above) — these literal id strings are load-bearing.
- **Two `localStorage` keys exist on the client**: `currencydesk.state.v1` (business data,
  above) and `currencydesk.theme.v1` (display preference, see Theming). Identity/session is
  **not** one of them anymore — it lives in a server-side Postgres-backed session, referenced by
  an httpOnly cookie the browser sends automatically; the frontend never reads or writes it
  directly.
- Business logic (the actual math) lives in `packages/engine/src/engine.ts` (shared with the
  backend — see "Business-data migration" above), kept intentionally free of any React
  dependency, and orchestrated into stateful actions by `store.tsx` via the
  `frontend/src/lib/engine.ts` re-export shim. `frontend/src/lib/reports.ts` builds report-level
  aggregation (e.g. Balance Sheet ledger balances) on top of `engine.ts`. **The logic itself is
  unchanged** — only its file location moved.

## Routing

Router setup is entirely in `frontend/src/App.tsx` (`BrowserRouter`/`Routes`/`Route` from
`react-router-dom`). There's no separate routes-config file.

- `App()` wraps everything: `ThemeProvider` → `AuthProvider` → `StoreProvider` →
  `BrowserRouter` → `Gate`. `AuthProvider` sits above `StoreProvider` because `StoreProvider`
  now reads identity from `useAuth()`.
- `Gate()` reads `useAuth()`'s 4-way `status` directly (**not** a derived boolean off
  `useStore()` — see "Authentication" → "Frontend integration" for why that distinction
  matters): `'checking'` → a boot splash, `'unreachable'` → a "can't reach the server" message,
  `'anonymous'` → `<Login />` in place of the whole routed tree, `'authenticated'` → `<AppShell>`
  wrapping the real `<Routes>`.
- `RequireAdmin({ children, label })` is unchanged: a render-time guard, not a redirect — if
  `!isAdmin` it renders `<Denied label={label} />` in place of the element; the URL doesn't
  change. This is still a UI convenience, not a real access boundary — there is no
  business-data API for a server-side guard to protect yet.

| Path | Element | Guard |
|---|---|---|
| `/` | redirect → `/dashboard` | — |
| `/dashboard` | `Dashboard` | — |
| `/customers`, `/customers/:id` | `Customers`, `CustomerDetail` | — |
| `/accounts` | `Accounts` | — |
| `/purchase` | `Trade key="buy" mode="buy"` | — |
| `/sale` | `Trade key="sell" mode="sell"` | — |
| `/receive` | `Settle key="receive" mode="receive"` | — |
| `/pay` | `Settle key="pay" mode="pay"` | — |
| `/stock` | `Stock` | — |
| `/payments` | `Payments` | — |
| `/cheques` | `Cheques` | — |
| `/journal` | `Journal` | `RequireAdmin` |
| `/salary` | `Salary` | `RequireAdmin` |
| `/transactions` | `Transactions` | — |
| `/balance-sheet` | `BalanceSheet` | `RequireAdmin` |
| `/income-statement` | `IncomeStatement` | `RequireAdmin` |
| `*` | redirect → `/dashboard` | — |

The explicit `key="buy"`/`key="sell"` (and `key="receive"`/`key="pay"`) props force React to
fully remount `Trade`/`Settle` when switching between the two modes at different URLs, rather
than reusing the mounted instance — preserve this pattern if you touch these routes.

## Roles (business-page gating — still not a security boundary)

`Role = 'admin' | 'user'` now comes from the authenticated session user (`useAuth()`), not from
persisted business state. `isAdmin` is `user?.role !== 'user'`. Signing in/out is real; **which
business pages a role can reach is still a UI/demo permission split, not a server-enforced
one**:

- Route/page-level gating (`RequireAdmin`, `Sidebar` dimming, disabled buttons in `Accounts`,
  `Cheques`, `Stock`, `Salary`, `CustomerDetail`) only controls what renders — all business data
  is already present in the client-side store regardless of role, because there is still no
  business-data API for a server-side check to protect.
- Admin-only exception within accounts: any account can have its type changed/overridden by
  Admin **except** `CORE_ACCOUNT_IDS` (see "State and Data"), which stay locked structurally.
- To view the app as the other role, sign out and sign in as the other seeded account — there is
  no more one-click role switch (see "Authentication" → "What was removed").

Keep this distinction in mind for any future business-data migration: authentication is real
now, but *authorization* over business data is still purely a client-side rendering decision.

## Theming and Design System

- `frontend/src/lib/theme.tsx` — `ThemeProvider`/`useTheme`, stores `'light' | 'dark' | 'system'`
  under its own **`currencydesk.theme.v1`** localStorage key (deliberately separate from
  `currencydesk.state.v1` — see "State and Data"). `'system'` removes `data-theme` from
  `<html>` (letting `prefers-color-scheme` govern); `'light'`/`'dark'` set it explicitly and
  always win over system preference.
- `frontend/index.html` contains an inline pre-paint script mirroring this exact logic, reading
  `currencydesk.theme.v1` and setting `data-theme` on `<html>` before any JS module loads, to
  avoid a flash of the wrong theme on first paint.
- `frontend/src/components/layout/ThemeToggle.tsx` — the three-way Light/Dark/System control in
  TopBar.

All color is driven by CSS custom properties defined once in `frontend/src/index.css` under
`@theme`, then overridden in **two** dark blocks — `@media (prefers-color-scheme: dark)`
(system preference) and `:root[data-theme="dark"]` (explicit user choice always wins) — plus a
**third, `@media print` block** that force-overrides every token back to fixed light-mode
values with `!important` (see below). Never hardcode a hex color in a component — use the
Tailwind utility for the token (`bg-surface`, `text-ink`, `border-border-strong`, etc.) or
`var(--color-*)` in inline styles.

**Solid-fill vs soft-tint is a real distinction, not a style choice:**
- Soft-tint (`bg-X-bg` + `text-X` or `text-X-text` + `border-X-border`) is used for badges,
  banners, and chips. Text and background are the same hue family, so contrast direction never
  flips between light/dark — no special handling needed beyond picking dark-mode-safe hues.
- Solid-fill (a colored background with white/light text on top, e.g. primary/destructive
  buttons) is the dangerous case: a hue that reads fine as *text on the page* in dark mode often
  fails 4.5:1 contrast for *white text on top of it*. This is why `--color-accent-solid` and
  `--color-negative-solid` exist as separate tokens from `--color-accent`/`--color-negative` —
  they're identical in light mode but diverge in dark mode.
- **`--color-positive` and `--color-pending` have no `-solid` variant on purpose** — as of this
  writing they are never used as solid fills anywhere in the app (only as tinted badges, chip
  icons, small status dots, or thin progress bars). If you ever add a solid positive/pending
  button, banner, or badge with light text, add `--color-positive-solid` /
  `--color-pending-solid` following the same pattern as `accent`/`negative` and verify contrast
  in dark mode before shipping — don't assume the plain token is safe for that use.
- Category tint colors (`--color-cat-*`) are for icon-badge backgrounds only, never card
  backgrounds or numeric values — the positive/negative/pending state colors are the only
  state signal in the app.

**Print stylesheet**: Balance Sheet, Income Statement, customer statements, and the currency
ledger can be printed/filed as paper, so the printed page must not depend on whichever theme
the screen happened to be in. `frontend/src/index.css`'s `@media print` block force-overrides
every color token back to fixed light values with `!important` (needed to beat both the
system-dark media block and the explicit `[data-theme="dark"]` block regardless of cascade
order). Component-level print visibility (hiding the sidebar, TopBar, period pills, buttons) is
handled per-element with Tailwind's `print:hidden` utility on the report pages and
`AppShell`/`Sidebar`/`TopBar`, not in this stylesheet block.

When adding any new state color, re-derive its dark-mode hue rather than mechanically darkening
the light one, and check it against both the dark page (`--color-app`) and dark card
(`--color-surface`) backgrounds, plus its own tinted background if it has one — and check the
print block too if the color can appear on a printable report.

Fonts: Instrument Sans (body) and IBM Plex Mono (tabular/numeric, via the `.tabular` utility and
`--font-mono`) are pulled from Google Fonts via a single `@import url(...)` at the top of
`frontend/src/index.css`.

## Development

**Install once, from the repo root** — this is an npm workspaces monorepo (see "Repo layout"),
so `npm install` must run at the root, not inside `frontend/`/`backend/` individually, or the
`@currencydesk/engine` workspace link won't be set up correctly:

```bash
npm install         # from the repo root — links frontend, backend, and packages/engine together
```

Frontend commands, verified against `frontend/package.json` — run from inside `frontend/`:

```bash
npm run dev        # start the Vite dev server (http://localhost:5173) — frontend only,
                    # the auth backend must be started separately or every login attempt
                    # will hit AuthProvider's 'unreachable' state
npm run build       # tsc -b && vite build — type-check, then production build
npm run preview      # preview the production build locally
npm run lint          # oxlint, scoped to this package's src/
```

Running the app with working authentication (local dev), verified end-to-end — run from inside
`backend/` (after the root-level `npm install` above):

```bash
docker compose up -d               # start local Postgres (uses backend/docker-compose.yml)
cp .env.example .env               # first time only
npm run migrate                    # creates the auth tables + the business-data schema (see
                                    # "Business-data migration") — safe to re-run, skips applied
                                    # migrations
npm run seed:demo                  # creates two fixed accounts, prints their credentials
npm run dev                        # starts Express on http://localhost:3001
```

Then, in another terminal, `npm run dev` from inside `frontend/` as usual — or from the repo
root, run both at once with `npm run dev:all` (uses `concurrently`; still requires Postgres to
already be up and migrated/seeded first).

If you change anything in `packages/engine/src/`, rebuild it before relying on the change in
`backend`'s production path (`npm run build`/`npm start` inside `backend/`) — dev (`npm run dev`
in either package) already picks up the change live, no rebuild needed (see "Repo layout" for
why dev and production resolve it differently):

```bash
npm run build --workspace=@currencydesk/engine   # from the repo root
```

There is no `npm test` / `npm run test` script for either app.

## Testing and Verification

**There is no automated test suite, frontend or backend.** No Vitest/Jest/Playwright/Cypress
config or `*.test.*`/`*.spec.*` files exist anywhere in the repo, and there's no `test` script
in either `package.json`. Correctness is verified by type-checking (`tsc -b` for the frontend,
`tsc -p tsconfig.json` for the backend), `oxlint`, and manual verification in the running app
against a real local Postgres instance.

For color/dark-mode/contrast changes specifically: **run the app (`npm run dev`) and take
actual screenshots in both themes** — there is no test harness that checks visual/contrast
correctness, so reasoning about hex values alone is not sufficient verification. When asked to
confirm a dark-mode or contrast fix is done, provide actual screenshots, not descriptions of
what should be true.

For auth changes specifically: verify against the real local Postgres + Express setup above,
not just a type-check — session behavior (fixation handling, cookie flags, rate limiting,
persistence across reload) can't be confirmed by reading the code alone.

## Current Limitations

- **Business data is still frontend-only.** All accounting data lives in browser `localStorage`
  under `currencydesk.state.v1`; clearing site data or switching browsers loses it. Adding a
  real auth backend did not change this.
- **The auth backend has no production deployment.** It only runs locally (Docker Postgres +
  `npm run dev` inside `backend/`). Cookie `secure: false`, CORS is sidestepped via a dev-only
  Vite proxy rather than solved for a real cross-origin production setup, and CSRF protection
  is deliberately deferred (see "Authentication").
- **No business-data authorization on the server.** `RequireAdmin`/role-gated UI is still a
  client-side rendering decision, not a server-enforced permission — there is no business-data
  API yet for a server check to protect.
- **`requireAdmin` trusts a session-cached role.** A role change or account deactivation takes
  effect on that user's *next* login, not immediately.
- **Single-tenant schema.** `role` lives directly on `users`; there's no desk/org concept, same
  as the app itself.
- **No automated tests**, frontend or backend.
- **`recharts` is an installed-but-unused dependency** — don't assume dashboard charts are
  already implemented with it; check current imports before building on that assumption.
- Single traded currency: `CURRENCIES = ['AED']` in `engine.ts` — the desk only trades AED
  against PKR (USD support was removed; see git history).
- **Production Vercel deployment needs a settings update after this repo split**: the Vercel
  project's **Root Directory** setting must point at `frontend` (not the repo root) so it finds
  `frontend/vercel.json`, `frontend/package.json`, and builds from the right place. This has not
  been changed in Vercel itself as part of this restructuring — it's a dashboard setting, not a
  file in the repo.

## Important Rules for Coding Agents

- This repo is **two independent apps**, not one with a subfolder — don't add cross-package
  relative imports between `frontend/` and `backend/`, and don't assume a change to one
  requires touching the other unless the task is explicitly about their integration (the auth
  API contract, the Vite proxy, shared env expectations).
- Do not hardcode hex colors in components — use the Tailwind token utility or `var(--color-*)`.
  Preserve the soft-tint vs solid-fill distinction and the positive/pending no-solid-variant
  rule described above.
- Don't unnecessarily rewrite working business logic in `engine.ts`/`reports.ts`/`store.tsx`'s
  mutating actions — the weighted-average cost, margin, and balance-replay math is real and
  load-bearing for the reports; changes there ripple into Balance Sheet/Income Statement
  correctness. Adding or changing authentication should never require touching these.
- Preserve existing `localStorage` key names and the `pristine` semantics unless you are
  deliberately performing a migration — any new mutating store action must clear `pristine` via
  `mutate()`.
- Identity (`isAdmin`, `actor`, sign in/out) lives in `frontend/src/lib/auth.tsx`'s `useAuth()`,
  backed by the real session — don't reintroduce a client-side "just declare yourself admin"
  affordance (that's exactly what was removed from `TopBar.tsx`/`Denied.tsx` when auth became
  real).
- If you add a business-data API to `backend/` in the future, don't assume the existing
  `users`/`session` schema or `requireAuth`/`requireAdmin` middleware need to change — they were
  deliberately kept generic. Do assume the single-tenant assumption (role directly on `users`)
  needs revisiting if that future work is ever multi-desk.
- Keep `backend/src/config/env.ts` failing fast on a missing `SESSION_SECRET`/`DATABASE_URL` —
  don't add a silent fallback default for either.
- Verify color/theme/UI changes by actually running the app and screenshotting both light and
  dark mode — this project has no visual test suite to lean on instead. Verify auth changes
  against the real local Postgres + Express setup, not just a type-check.
- Avoid introducing unnecessary dependencies — note that `recharts` is already installed but
  unused; check whether it (or an existing utility) already covers a need before adding a new
  charting/utility library.
- **When verifying a claim by attempting a real mutation/deletion/near-miss against a live
  database** (proving a constraint holds, reproducing a race, etc.), do it inside a transaction
  and roll back at the end — use `SAVEPOINT`s to isolate multiple attempts in one transaction
  when one attempt is expected to error (a raised error aborts the whole transaction until a
  rollback, so a `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` per attempt is needed to keep testing after
  the first rejection). Don't run the real mutation against live data and fix it up afterward
  (delete-and-restore) — a rollback is a guarantee, a manual fix-up is a mistake waiting to
  happen. This applies to ad hoc verification now and to Phase 4's concurrency tests later.
- **Be precise about what a claim actually asserts, and verify it, don't just describe intent.**
  "Zero logic changes" and "moved verbatim" are different claims from "I moved the file and
  didn't intend to change logic" — if you're not going to diff it, don't say "verbatim." "This
  constraint exists" and "this constraint is designed for" are different claims too — a schema
  decision motivated by a rule (e.g. `accounts.id` staying `text` because of `CORE_ACCOUNT_IDS`)
  does not mean the rule is enforced anywhere yet. Say which one is true.
