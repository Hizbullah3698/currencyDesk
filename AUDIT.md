# Currency Desk — Codebase Audit

**Date:** 2026-09-10
**Scope:** every tracked source file in `packages/engine/`, `backend/`, and `frontend/` (214 files, ~16,500 lines), plus the untracked `backend/src/scripts/resetAdminPassword.oneoff.ts` found on disk. Read in full, not sampled. Three claims below were verified by running code rather than by reading it, and are marked **[verified]**.
**Status:** analysis only. Nothing was changed.

## How to read this

Six sections, as requested. Within each, findings are sorted by severity. Every finding outside section 1 carries: severity, file and line, the concrete failure scenario, and a fix direction. Section 1 entries carry the four fields asked for (what, why risky, recommended fix, risk of the fix).

Severity scale used throughout:

| | Meaning |
|---|---|
| **Critical** | Wrong money in the books, or an unauthenticated path to data, reachable today |
| **High** | Wrong figure on a document the client hands out, or a security gap reachable by a signed-in user |
| **Medium** | Wrong figure in a bounded case, or a gap that needs a second fault to become visible |
| **Low** | Hygiene, drift, a raw 500 where a 400 belongs |

A note on what this codebase gets right, because the findings list is long and it would be easy to read it as damning. It is not. Every mutating route runs in one transaction on one client. All SQL is parameterised. Every route has an auth guard. The role filter on the snapshot is real and tested. The accounting engine is shared so client and server cannot disagree about arithmetic. The concurrency guards are real and regression-tested. The documentation in `CLAUDE.md` and `PROJECT_STATUS.md` is unusually honest about what is and is not done. The findings below are mostly about the *edges* of a sound design: timezones, rounding, a validation that trusts the client where it should not, and a body of hardcoded assumptions that are fine for this one client and would break for a second.

**The three things to act on first**, if nothing else is read:

1. **Section 3, #1** — a customer statement's "To" date silently drops every deal dated on that day, in the printed statement, the PDF, and the Excel export. Verified by running the date arithmetic.
2. **Section 3, #2** — the backend has no timezone configured. On Vercel it runs in UTC while the desk is in Pakistan (UTC+5). Between midnight and 05:00 local, a deal dated "today" is rejected as being in the future, and any entry that relies on the database's `CURRENT_DATE` lands on yesterday.
3. **Section 4, #1** — `npm run seed:demo` has no production guard. Pointed at the production database, it creates an admin login with a well-known password.

---

## 1. Hardcoded values

Grouped by what the value *is*, not by file, because most of these appear in several files and the fix has to cover all of them at once.

### 1.1 The base currency (PKR) is not a value at all, it is an assumption

**What.** Every rupee figure is formatted with a literal prefix (`frontend/src/lib/format.ts:5`: `'PKR ' + …`). Every rate label reads `'PKR per 1 EUR'` etc. (`packages/engine/src/currencies.ts:49–89`). The engine's canonical unit is named `pkrPerUnit` (`currencies.ts:128`). Column names are `pkr_value` (`migrations/006:9`). The Excel export header says `'PKR value'` (`LedgerDetail.tsx:67`). User-facing copy says "rupees" in a dozen places.

**Why risky.** Not for this client. For a second deployment in another country, there is no single place to change; it is a full-text pass over three packages plus a column rename. More subtly, the *quote convention* logic in `currencies.ts` is written around the rupee's order of magnitude: the comment at `currencies.ts:40–43` decides that only IRR inverts because it is the only currency worth less than one rupee. Against a different base currency the set of inverted quotes changes and nothing in the code would notice.

**Recommended fix.** Do **not** attempt to make this configurable now. It would be the largest change in this report for zero benefit to the current client. Instead: (a) add a single `BASE_CURRENCY = { code: 'PKR', name: 'Pakistani Rupee', symbol: 'PKR' }` export to `packages/engine/src/currencies.ts` and route `fmt()` and the `rateLabel` template strings through it, so the *display* string is written once; (b) leave column names and the `pkrPerUnit` identifier alone. That turns a future port into a mechanical job rather than an archaeology job, at a cost of about twenty lines.

**Risk of the fix.** Cosmetic only if limited to (a). Renaming `pkr_value` or `pkrPerUnit` would touch the engine, every mapper, two migrations, the backfill and the reconcile harness and is not worth it.

### 1.2 `'AED'` as an implicit default, in nineteen places

**What.** The fallback `(x.currency || 'AED')` or `(x.code || 'AED')` appears in:

| File | Lines |
|---|---|
| `packages/engine/src/currencies.ts` | 104 (`DEFAULT_CURRENCY`), 114 (`currencyMeta` fallback) |
| `packages/engine/src/engine.ts` | 215, 228, 276, 283 (default parameters on `buyCalc`/`sellCalc`), 340 |
| `packages/engine/src/ledger.ts` | 182 |
| `frontend/src/lib/format.ts` | 102 |
| `frontend/src/lib/reports.ts` | 167, 229, 338 |
| `frontend/src/lib/reconcile.ts` | 133 |
| `frontend/src/pages/CustomerDetail.tsx` | 213 |
| `frontend/src/pages/Transactions.tsx` | 66 |
| `frontend/src/components/AccountFormModal.tsx` | 23, 42 |
| `backend/src/services/mappers.ts` | 70 |
| `backend/src/services/accountsService.ts` | 141 |
| `backend/src/services/openingStockService.ts` | 75, 84 (inside SQL: `COALESCE(currency, 'AED')`) |
| `backend/src/services/voucherBackfill.ts` | 76, 142 |

**Why risky.** Two different things are being conflated. `DEFAULT_CURRENCY` (what the trade screen opens on) is a legitimate, documented, single-source constant. The other eighteen are a *data-shape* assumption: "a row with no currency is an AED row", inherited from when AED was the only currency and `activity.currency` was nullable. Migration 012 made `txn_date` NOT NULL but left `activity.currency` nullable (`migrations/006:4`), so the fallback is still load-bearing for any pre-012 rows. On a fresh desk (the current production database, cleared 2026-09-09) there are no such rows, so every one of these fallbacks is now dead weight that will silently mis-file a row if `currency` is ever null again. `accountsService.ts:141` is the worst of them: on *every* edit of a non-stock account it writes `code = 'AED'` into the row (a Customer gets an `AED` code), which is harmless today only because nothing reads `code` off a non-stock account.

**Recommended fix.** Three steps, in order. (1) A migration: `UPDATE activity SET currency = 'AED' WHERE currency IS NULL` (no-op on production, defensive elsewhere), then `ALTER TABLE activity ALTER COLUMN currency SET NOT NULL` with a `CHECK (type NOT IN ('purchase','sale') OR currency IS NOT NULL)` if receipts/payments must stay null. (2) Make `Activity.currency` required for trades at the type level in `packages/engine/src/types.ts:81` (a discriminated union on `type`, or simply `currency: string` with `''` for settlements). (3) Delete the eighteen fallbacks; keep only `DEFAULT_CURRENCY` and the `currencyMeta()` unknown-code fallback (which is a different, still-valid concern: an *unknown* code, not a *missing* one). Fix `accountsService.ts:141` to write `NULL` for non-stock types.

**Risk of the fix.** Step (2) will surface every call site as a type error, which is the point. `openingStock()` and `stockAsOf()` in the engine are load-bearing for the balance sheet; the change there is a filter predicate only, and `reports.test.ts` plus `engine.test.ts` cover the replay. Run `npm run reconcile` after.

### 1.3 The traded-currency list lives in code and in three migrations

**What.** `CURRENCY_LIST` (`currencies.ts:44–93`) is the single source in TypeScript, and migrations 008, 012 and 014 each seed one `stock_positions` row and one `accounts` row per currency (`migrations/008:10,21`, `012:55–78`, `014:25–51`). `lockStock()` (`tradesService.ts:56`) creates a missing stock row at runtime, but nothing creates a missing Currency Stock *account*, so a code added to `CURRENCY_LIST` without a migration trades fine and posts no voucher (`buildVoucherLegs` returns null, `journalService.ts:281`).

**Why risky.** Adding a seventh currency is a three-place change (list, migration, and the test fixture at `backend/src/test/dbFixtures.ts:37–50`), and the failure mode of forgetting the middle one is silent (documented at `accountHelpers.ts:61–64`). Changing a *rate label* or *decimal precision* for an existing currency requires a code deploy. Migration 012's header argues, correctly, that a migration should not be derived from `CURRENCY_LIST`. That argument is about migrations; it is not an argument against a table.

**Recommended fix.** A `currencies` table (`code PK, name, quote CHECK IN ('multiply','divide'), rate_label, amount_decimals, rate_decimals, sort_order, active bool`), seeded by one migration from the current list, and `GET /api/state` returns it alongside `stocks`. The engine keeps `CURRENCY_LIST` as the *type* and a `setCurrencyRegistry()` call, so the pure functions stay pure and both tiers load the same rows at boot. `stockAccountIdFor` stays as it is. An admin "Currencies" section on the Settings page can come later; the table is the enabling step. **Alternatively**, if a seventh currency is genuinely unlikely, leave this alone and add a startup assertion in `backend/src/index.ts` that every `CURRENCY_LIST` code has both a `stock_positions` row and a `Currency Stock` account, failing loudly at boot rather than silently at the first trade.

**Risk of the fix.** The table version means `currencyMeta()` is no longer synchronous-from-import; every caller in the engine already takes a code string, so the change is confined to how the registry is populated. The backfill and reconcile harness read the same registry. `accountsService.resolveCurrencyCode` and `tradesService.assertKnownCurrency` switch from `CURRENCIES.includes` to a table lookup inside the same transaction. The startup-assertion alternative has no risk.

### 1.4 Core account ids and their display labels, written by hand in nine files

**What.** `CORE_ACCOUNT_IDS` (`engine.ts:22`) is the documented single source. But the *individual* ids are still typed as literals wherever they are used:

| Literal | Where |
|---|---|
| `'margin'` | `tradesService.ts:11`, `voucherBackfill.ts:34` (two separate `MARGIN_ACCOUNT` constants) |
| `'capital'` | `accountsService.ts:92,94,95`, `openingStockService.ts:30`, `reports.ts:257,260` |
| `'cash'`, `'bank'` | `accountHelpers.ts:29,33`, `Settle.tsx:31` (`|| 'bank'` fallback in the UI) |
| `'salaryExpense'`, `'salaryPayable'` | inside SQL string literals at `salaryService.ts:27,55,79,97`; `reports.ts:327` |
| `'Salary Expense'`, `'Salary Payable'` (display labels) | inside the same SQL at `salaryService.ts:27,55,79,97` |
| `'Opening Balance / Capital'` (display label) | `reports.ts:260` |
| `'currency'` (the AED stock account, not `'currencyAED'`) | migrations 008, `dbFixtures.ts:22,33`; documented trap at `accountHelpers.ts:43–49` |

**Why risky.** The ids themselves are protected by a database trigger and are safe to hardcode; that is a deliberate design and this report does not recommend moving them. The *labels* are the problem. `updateAccount` cascades a rename into `journal_entries.debit_label/credit_label` (`accountsService.ts:166–167`), so if an admin renames "Salary Expense" to "Staff Salaries", every existing row is updated but the *next* accrual writes `'Salary Expense'` again from the SQL literal. The journal then shows two names for one account. The same applies to `reports.ts:260`, which prints "Opening Balance / Capital" on the plug row regardless of what the Capital account is called.

**Recommended fix.** (1) Turn `CORE_ACCOUNT_IDS` from a string array into a typed object in the engine: `export const CORE = { bank: 'bank', cash: 'cash', margin: 'margin', … } as const` with `CORE_ACCOUNT_IDS = Object.values(CORE)`; replace every literal with `CORE.margin` etc. Migration 009 keeps generating its trigger from the array. (2) In `salaryService.ts`, resolve the two labels with the existing `settlementName()` helper (one extra query per accrual, already inside the transaction) instead of the SQL literal, exactly as `postVoucher` already does at `journalService.ts:203–208`. (3) In `reports.ts:257–261`, look the Capital account's name up from `accounts` rather than the literal.

**Risk of the fix.** (1) is a rename with compiler support. (2) changes the label written on new salary rows only when the account has been renamed, which is the desired behaviour; existing tests in `salaryBulk.concurrency.test.ts` assert on amounts, not labels. (3) is presentation only.

### 1.5 Role names

**What.** `'admin' | 'user'` is defined in `types.ts:1`, checked in `requireAdmin.ts:11` (`!== 'admin'`), `stateService.ts:39` (`=== 'admin'`), the migration CHECK (`001:8`), `createUser.ts:20`, and in the frontend as `isAdmin = user?.role !== 'user'` (`store.tsx:272`). The UI calls the second role "Operator" (`Sidebar.tsx:95`, `TopBar.tsx:129`) and "Operations user" (`Denied.tsx:16`), never "user".

**Why risky.** Two roles is fine and this is not a recommendation to build RBAC. The concrete problem is the **inverted predicate on the client**: the backend grants admin only on `=== 'admin'`, the frontend grants it on `!== 'user'`. Any third role value that ever reaches the session (a typo in a `create-user` invocation is blocked by the CHECK, but a future `'viewer'` role is not) shows the admin UI and then 403s on every action. Low today, but it is the kind of asymmetry that turns a one-line migration into a confusing afternoon.

**Recommended fix.** Export `ROLES = { admin: 'admin', operator: 'user' } as const` from the engine, use `=== ROLES.admin` on both tiers, and add a `roleLabel()` helper for the UI strings. Do not rename the stored value `'user'` — that would need a data migration for no gain.

**Risk of the fix.** None beyond a rename.

### 1.6 Magic counts in the destructive reset script

**What.** `backend/src/services/businessDataReset.ts:107–113` asserts `systemAccounts === 13`, `stockRows === 6`, `migrations === 18`, `settings === 1`, as literals.

**Why risky.** The next migration (019) makes `npm run reset:business` refuse to run; the next currency makes it refuse; the next `app_settings` key makes it refuse. It fails *safe* (rolls back with a clear message), so this is not a data risk. It is a script that will break on the next unrelated change and someone will "fix" it by editing the number without re-reading the intent.

**Recommended fix.** Derive each expected value in the same transaction *before* the deletes run: `SELECT count(*) FROM accounts WHERE is_system` before and after must be equal; `stock_positions` count before and after equal; `schema_migrations` count before and after equal; `app_settings` before and after equal. The assertion becomes "unchanged", which is what it means. `CORE_ACCOUNT_IDS.length` is already done this way.

**Risk of the fix.** None; strictly weaker preconditions, same postconditions.

### 1.7 The server's timezone is unset

**What.** There is no `TZ` in any env file (checked: `backend/.env`, `.env.production`, `.env.production.local`, `.env.vercel` — key names only were read), no `timezone` on the `pg.Pool` (`db/pool.ts:13`), and no `SET TIME ZONE` anywhere. The frontend's date helpers are careful about *local* time; the backend assumes its own local time is the desk's.

**Why risky.** This is a missing configuration value rather than a hardcoded one, and it is the root cause of section 3 #2. Listed here because the fix is a config change.

**Recommended fix.** `TZ=Asia/Karachi` as a backend env var on Vercel and in `.env.example`, **and** `options: '-c timezone=Asia/Karachi'` in the `Pool` config (or `?options=-c%20timezone%3DAsia%2FKarachi` on the `DATABASE_URL`), so that `CURRENT_DATE`, `now()::date` and `updated_at::date` all resolve in the desk's day. Read the zone from one env var (`DESK_TIMEZONE`) into `config/env.ts` and apply it to both. See section 3 #2 for the code-side half.

**Risk of the fix.** Changing the DB session timezone changes the result of every `::date` cast on a `timestamptz`. The three that matter are all "today" computations that are currently wrong between 00:00 and 05:00 local, so they get better. Migrations 012 and 017 already ran, so their backfills are unaffected. `csrfGate.ts` uses `now()` intervals, not dates; unaffected.

### 1.8 Settings constants duplicated across the wire

**What.** `DEFAULT_IDLE_TIMEOUT_MINUTES = 5`, `MIN = 1`, `MAX = 480`, `CACHE_TTL_MS = 30_000` in `settingsService.ts:16,27,28,43`; `FALLBACK_SETTINGS = { 5, 30, 1, 480 }` in `frontend/src/lib/settings.ts:26–31`; `WARNING_SECONDS = 30` in `useIdleTimeout.ts:17` and the string "30 seconds" in `Settings.tsx:56`; the seeded `'5'` in `migrations/015:36`.

**Why risky.** The frontend fallback is deliberately a copy (documented at `settings.ts:22–24`) so the app fails *closed* if the settings fetch fails. That is correct. But the server already returns `minIdleTimeoutMinutes`/`maxIdleTimeoutMinutes`/`cacheTtlSeconds` precisely so the client does not have to know them, and then the client also hardcodes them. Change the server maximum and the fallback lies until someone remembers the second file.

**Recommended fix.** Move the four numbers into the engine (`packages/engine/src/settings.ts`, exported as `IDLE_TIMEOUT_DEFAULTS`) and import them on both sides. `WARNING_SECONDS` joins them and `Settings.tsx` interpolates it.

**Risk of the fix.** None. The engine has no runtime dependencies and both tiers already import it.

### 1.9 Demo credentials and the login hint

**What.** `backend/src/scripts/seedDemo.ts:9–12` — `admin` / `admin-demo-pass` (role admin) and `user1` / `user-demo-pass`. `frontend/src/pages/Login.tsx:50` — the placeholder text on the identifier field is `"admin"`.

**Why risky.** See section 4 #1 for the seed script. The placeholder is a small thing: it tells an attacker the admin username on the production login page. It is also the username `seed:demo` creates.

**Recommended fix.** Seed script: refuse unless `NODE_ENV !== 'production'` **and** the `DATABASE_URL` host is `localhost`/`127.0.0.1`, following the pattern of `test/guardTestDatabase.ts`. Placeholder: change to `"username or email"`.

**Risk of the fix.** None.

### 1.10 Test database URL in `package.json`

**What.** `backend/package.json:17–18` embeds `postgresql://currencydesk:currencydesk@localhost:5432/currencydesk_test` twice.

**Why risky.** A developer whose local Postgres is on another port or credential cannot run the backend tests without editing `package.json`. The guard in `guardTestDatabase.ts` only checks for `_test` in the name, so the URL could equally come from an env var.

**Recommended fix.** `"test": "cross-env DATABASE_URL=${TEST_DATABASE_URL:-postgresql://…}"` does not work cross-platform. Instead: read `TEST_DATABASE_URL` in `setupTestDb.ts` and `guardTestDatabase.ts` with the current literal as the default, and have `pretest`/`test` set `NODE_ENV=test` only. A `backend/.env.test` (gitignored, with a tracked `.env.test.example`) loaded by `dotenv` when `NODE_ENV=test` is the conventional shape.

**Risk of the fix.** The guard must keep refusing anything without `_test` in it; that check is what stops the dev database being truncated and must not be loosened.

### 1.11 Tolerances: two different "half a paisa" and a "half a rupee"

**What.** `0.005` in `journalService.ts:253` (`LEG_TOLERANCE`), `openingStockService.ts:28` (`VALUE_TOLERANCE`), `reconcile.ts:62` (`TOLERANCE`), `LedgerDetail.tsx:241`. `0.5` in `reports.ts:236,245,256` (balance-sheet plug/balanced thresholds) and `reports.ts:344,348,359` (income statement integrity checks).

**Why risky.** The balance sheet declares itself "Balanced" when the unexplained difference is under **half a rupee**, while the reconcile harness fails on **half a paisa**. So a one-paisa rounding drift (section 3 #4) fails `npm run reconcile` ("a red run is a finding") while the balance sheet says everything is fine. The two tools disagree about what "balanced" means by a factor of 100. Neither number is wrong on its own; they are just not the same number and nothing says why.

**Recommended fix.** One `MONEY_TOLERANCE = 0.005` in the engine, used by all four `0.005` sites. For the `0.5` sites, either lower them to the same constant (the sheet then reports paisa-level imbalances, which is arguably what "unexplained" should mean) or keep them and name the constant `PRESENTATION_TOLERANCE` with a comment explaining that a report rounds to whole rupees and so cannot display a sub-rupee difference. Decide, then write it down once.

**Risk of the fix.** Lowering the sheet's threshold to 0.005 may make the live balance sheet report "Out of balance" on a paisa the moment section 3 #4 bites. That is a true statement about the books and arguably should be shown, but it is a client-visible change and should be paired with the rounding fix.

### 1.12 Business rules stated as literals

| File:line | Value | What it decides | Fix |
|---|---|---|---|
| `routes/txnDate.ts:6` | `'2000-01-01'` | earliest accepted deal date | fine as a typo guard; move to `env` only if a client has older history to import |
| `chequeHelpers.ts:37–38` | `+14` days | every cheque's due date | should be a field on the cheque form (the dealer knows the real due date); until then, an `app_settings` key `cheque_due_days` |
| `migrations/005:1` | `START 1001` | first auto cheque number | reset script restarts it at 1 (`businessDataReset.ts:90`) so production is *already* inconsistent with the migration; pick one, document it |
| `migrations/007:5–6` | `'JV-' \|\| lpad(…, 3, '0')` | journal reference format | fine; note `lpad` does not truncate so `JV-1000` follows `JV-999` |
| `routes/auth.ts:18–19` | 15 min / 20 attempts | login rate limit | env vars `LOGIN_RATE_WINDOW_MS`, `LOGIN_RATE_LIMIT` |
| `authService.ts:4` | `BCRYPT_COST = 12` | password hashing cost | fine; leave |
| `createUser.ts:5`, `setPassword.ts:14`, `resetAdminPassword.oneoff.ts:28` | `MIN_PASSWORD_LENGTH = 8` | three copies | one export from `authService.ts` |
| `csrfGate.ts:21` | `48` hours | gate window default | fine (CLI arg overrides) |
| `activity.ts:50,110`, `useIdleTimeout.ts:21,35` | 60 s, 1 s, 1 s, 1 s | keepalive and throttles | fine; leave |
| `accountHelpers.ts:28` | "oldest Bank account is the default bank" | implicit rule, not a setting; also picks an **archived** bank | see section 3 #9 |
| `Salary.tsx:14–25` | `'Sep 2026'` via `toLocaleDateString('en-US')` | the **stored** `salary_period` key is a display string | works because the locale is pinned; a `'YYYY-MM'` key with a display formatter would be safer. Low |
| `Stock.tsx:16`, `Customers.tsx:14`, `Dashboard.tsx:43`, `Salary.tsx:29` | 24, 8, 6, 6 | UI list lengths | fine |
| `PrintHeader.tsx:22` | `"Currency Desk"` | masthead on every printed statement | self-documented as needing to become a settings row; the client's real business name belongs on a filed statement |
| `index.css:1` | Google Fonts URL | runtime dependency on a third-party host | self-host the three faces (also removes a CSP/privacy dependency); Low |
| `accountsService.ts:73–74,133–134` and `AccountFormModal.tsx:34–35`, `Accounts.tsx:231`, `Ledger.tsx:82`, `Trade.tsx:96`, `Settle.tsx:46` | `'—'` | the em-dash sentinel for "no phone/city", stored in the database and special-cased in six UI files | store `NULL`; the known "cannot clear phone" gap closes with it |
| `reports.ts:82–94` ↔ `BalanceSheet.tsx:28–36` | group title strings | `GROUP_META` is keyed by the exact title text from `GROUP_TITLES` | export the keys as an enum from `reports.ts` |
| `frontend/src/lib/csrf.ts:63` | `/security token/i` | client recognises a CSRF rejection by **regex on the server's error message** (`middleware/csrf.ts:137,149`) | return `{ error, code: 'CSRF_MISSING' }` from the server and match on `code` |
| `env.ts:28–31` | 3001, `cd.sid`, 30 days | defaults | fine |
| `vite.config.ts:20` | `localhost:3001` | dev proxy target | fine |
| `docker-compose.yml` | `currencydesk:currencydesk` | local dev DB creds | fine |
| `Trade.tsx:53` | `CREDIT_ONLY` | every trade posts on credit while the settlement UI is hidden | client-requested; see section 5 |

### 1.13 Values in the untracked one-off script

**What.** `backend/src/scripts/resetAdminPassword.oneoff.ts:24–25` — the client's admin email address and the production API URL as defaults.

**Why risky.** Not secrets, but a real person's login identifier and a production endpoint in a file whose own header says "delete this file once the password is reset". It is untracked, so it is not in git, but it is on disk in the repo and will be committed by the first `git add -A`. The script also performs a **real login against production** to verify the reset (`:244–248`), creating a session row.

**Recommended fix.** Delete the file. If a hidden-prompt password reset is wanted permanently, fold the prompt into `setPassword.ts` with the email as a required argument and no default.

**Risk of the fix.** None.

### 1.14 Things that are correctly configured and should stay that way

For completeness, so nobody "fixes" them: `VITE_API_BASE_URL` (`apiBase.ts:5`) is the right mechanism for the frontend's API origin and is the only env value in the bundle; `FRONTEND_ORIGIN`, `CSRF_ENFORCE`, `PREVIEW_DB_ISOLATED`, `DATABASE_URL`, `SESSION_SECRET` are all env-driven with fail-fast or fail-safe semantics; the idle timeout is already a database setting with an admin UI; `CORE_ACCOUNT_IDS` is deliberately structural and protected by a trigger.

---

## 2. Architecture and structure

### 2.1 Findings

**[High] The reports are computed in the frontend, not in the shared engine or the backend.**
`frontend/src/lib/reports.ts:19–47` (`ledgerBalance`), `:96–277` (`computeBalanceSheet`), `:297–374` (`computeIncomeStatement`). These are the desk's financial statements and they live in a package the server cannot import. Consequences already visible: the reconcile harness needs a JSON dump to run (`dumpSnapshot.ts:9–15` explains why), the backend cannot produce a PDF or email a statement, and a future "close the period" or "lock the month" feature has nowhere server-side to compute what it is locking. Phase 5 (switching reports to read the journal) will rewrite these functions anyway. *Failure scenario:* any server-side report, export, or period-close requirement forces a move of load-bearing accounting code under deadline. *Fix direction:* move `ledgerBalance`, `computeBalanceSheet`, `computeIncomeStatement` into `packages/engine/src/reports.ts` **as part of phase 5**, not before; they take plain arrays and return plain objects and have no React in them, so the move is mechanical. `reconcile.ts` follows them.

**[Medium] Three separate walks over the same currency movements.**
The weighted-average-cost replay is written in `engine.ts:226–244` (`openingStock`, unwinding), `engine.ts:246–262` (`stockAsOf`, forward), and again in `frontend/src/pages/Stock.tsx:312–354` (`buildLedger`, forward, with per-row output). `Dashboard.tsx:27–32` has its own cash-movement rule (`paidNow` for trades, `amount` for settlements, excluding Cheque and Credit) that mirrors `ledgerBalance`'s activity branch at `reports.ts:35–40`. *Failure scenario:* a fix to one replay (say, a rounding rule) that is not applied to the other two produces a Stock page whose running average disagrees with the balance sheet's valuation for the same currency. *Fix direction:* `stockAsOf` should return the per-movement rows it already computes and `buildLedger` should consume them; the dashboard's inflow/outflow should call `ledgerBalance` for the cash and bank accounts with a one-day `keep`.

**[Medium] Salary "outstanding" is computed twice, differently.**
Server: SQL aggregate over `journal_entries` (`salaryService.ts:8–17`). Client: `store.tsx:355–361` `salaryStats` reduces the snapshot. Both read the same rows, but the server's figure is inside a lock and the client's is a render-time recompute of a possibly stale snapshot; the "Mark paid" button is enabled from the client figure (`Salary.tsx:167`). *Failure scenario:* two admins on the Salary page; one pays, the other's button stays enabled until navigation; the second click gets a 400 "Nothing outstanding". Benign today because the server re-checks. *Fix direction:* none needed now; note it as an instance of the general pattern (client derives, server verifies) working as designed.

**[Medium] Request parsing is ad hoc per route, with unchecked enum casts.**
`routes/trades.ts:13–27`, `routes/settlements.ts:10–21`, `routes/accounts.ts:9–26`, and inline in `routes/journal.ts:13–20` and `routes/salary.ts:13,22,31,40`. `method` is cast (`b.method as TradeInput['method']`, `trades.ts:20`, `settlements.ts:15`) and `type` is cast (`accounts.ts:12`) with no runtime check; the database CHECK constraints catch bad values and surface as a raw 500. *Failure scenario:* a request with `method: "Card"` returns "Something went wrong" instead of a 400 naming the field. *Fix direction:* one `backend/src/routes/parse.ts` with `enumField(b, 'method', SETTLEMENT_METHODS)`, `numberField(b, 'amount', { min: 0, max: 1e12 })`, `dateField` (wrapping `parseTxnDate`), throwing `appError(400, …)`. No schema library needed at this size. Every route gets the same shape and the `sendIfAppError` pre-transaction path already exists to catch it.

**[Medium] One route opens its own transaction inline.**
`routes/settings.ts:35–49` does `pool.connect / BEGIN / COMMIT / ROLLBACK / release` by hand because `handleMutation` returns a snapshot and a settings change should not. The reasoning is right; the outcome is a second copy of transaction handling that does not get `runMutation`'s guarantees if those ever change. *Fix direction:* add a `runTransaction(fn)` sibling to `runMutation` in `transact.ts` that returns `fn`'s result instead of a snapshot; `settings.ts` calls it.

**[Low] Naming and folder conventions.**
- `Role = 'admin' | 'user'` in code, "Operator" / "Operations user" in the UI (section 1.5).
- `dbFixtures.resetBusinessData()` (test: TRUNCATE + reseed) vs `businessDataReset.resetBusinessDataForGoLive()` (production: targeted DELETEs) — two functions with near-identical names and opposite safety properties, and `CLAUDE.md` warns at length that using the first one's approach in production would be a disaster. Rename the fixture to `truncateAndReseedTestDb()`.
- `frontend/src/lib/engine.ts` and `lib/types.ts` are one-line re-export shims (`export * from '@currencydesk/engine'`) kept so existing imports do not change. Fine, but new code should import from `@currencydesk/engine` directly so the shims can eventually go.
- `lib/customerSearch.ts:25` exports `customSearchFilter` (typo for `customer`).
- `backend/src/scripts/` mixes production operations (`resetBusinessData`, `backfillVouchers`, `csrfGate`, `dumpSnapshot`), user administration (`createUser`, `setPassword`, `setUsername`), local-dev conveniences (`seedDemo`), and test infrastructure (`setupTestDb`, excluded from the build at `tsconfig.json:19`). Four kinds of script with four different blast radii in one folder with no naming convention distinguishing them. Suggest `scripts/prod/`, `scripts/users/`, `scripts/dev/`.
- `activity` (table, type) / "Transactions" (page, nav) / "deals" (docs) for the same thing. Harmless but worth one glossary line in `CLAUDE.md`.
- Four copies of the same `arg()` CLI parser (`createUser.ts:7`, `setPassword.ts:16`, `setUsername.ts:14`, `resetAdminPassword.oneoff.ts:34`, and a fifth variant in `resetBusinessData.ts:19`).

**[Low] The engine's `Payable` account type does double duty** as the built-in `salaryPayable` and as any other payable an admin creates, and `computeBalanceSheet` groups both under "Other Payables". Fine until someone wants salary payable shown separately.

### 2.2 What the frontend trusts vs. re-validates

This boundary is mostly right and worth stating precisely.

**Re-validated on both sides (correct):** amount > 0 and rate > 0 (`Trade.tsx:122` / `tradesService.ts:65,152`); date not in the future (`Trade.tsx:125`, `Settle.tsx:61` / `txnDate.ts:43–47`); cannot oversell (`Trade.tsx:126` / `tradesService.ts:161`, re-checked under lock); settlement amount within outstanding (`Settle.tsx:57` / `settlementsService.ts:33,70`); journal balanced (`Journal.tsx:30` / `journalService.ts:21`); admin role (`RequireAdmin` in `App.tsx` / `requireAdmin` middleware on every admin route); currency code (`tradesService.ts:34`). The client's checks are UX; the server's are the control. Good.

**Trusted from the client and NOT validated on the server (the gaps):**
- `bankId` on trades, settlements and salary — any existing account id is accepted (section 3 #6).
- `method: 'Credit'` on a receipt or payment (section 3 #8).
- `period` on salary accrual is free text (`salaryService.ts:19`).
- `narration` and account `name`/`notes` have no length limit (Postgres `text`); `express.json()` caps the body at 100 kB so it is bounded, but a 90 kB customer name is accepted.

**Computed on the client and displayed as if authoritative:**
- The "Purchase posted" confirmation card shows `value` and `outstanding` from the client's own `buyCalc` (`Trade.tsx:147–155`), not the server's stored `pkr_value`. The store *does* replace `state` with the server's snapshot, so every other screen shows the stored figure; only this slip shows the local one. If section 3 #4's rounding is fixed server-side, this card could disagree by a paisa. Read `state.activity[0]` after the mutation instead.
- Everything on the dashboard, balance sheet and statements is computed from the snapshot in the browser. That is the architecture, and it is fine while the snapshot is small.

**Where the server trusts the session:** role and identity are read from the session cookie on every request and never re-checked against `users` (section 4 #2).

### 2.3 The whole-snapshot read model

`GET /api/state` and every mutation response return every row of five tables (`stateService.ts:60–64`). There is no pagination, no `since`, no per-resource endpoint. For a desk doing 20 deals a day this is 7,000 activity rows a year, each ~400 bytes on the wire, so ~3 MB per navigation after a year, ~15 MB after five. Every page then filters and sorts that in the browser on every render (`Customers.tsx:47` does an O(customers × activity) scan). This is a known and deliberate trade (`CLAUDE.md`, "One snapshot is the entire read model") and it is the right one *now*. It is listed here because it has a horizon, roughly two years of trading at current volume, and the refactor it implies (per-resource endpoints with date windows, or a server-side balance-sheet endpoint, which is the phase 5 move in 2.1) is the largest structural change in this report and should be planned before it becomes urgent rather than after.

---

## 3. Data integrity and correctness

### #1 [High] Customer statement "To" date excludes every entry dated on that day — **[verified]**

`frontend/src/pages/LedgerDetail.tsx:45–46`:
```ts
fromT: from ? stampTime(from) : undefined,
toT:   to   ? stampTime(to)   : undefined,
```
`stampTime('2026-09-10')` is `new Date('2026-09-10').getTime()`, which is **UTC midnight** (05:00 local in Pakistan). `activityDate()` pins a deal dated `2026-09-10` to **local noon**. Noon is after 05:00, so `inPeriod()` in `engine/ledger.ts:128–131` returns false and the row is dropped. Run on this machine (UTC+5): a trade dated on the "To" date reports `included in statement? false`. The engine test at `ledger.test.ts:127–135` uses a `to` of Feb 28 with the only February row on Feb 15, so it never exercises a row on the boundary day.

*Failure scenario:* a customer asks for their statement for 1–30 September. The desk sets To = Sep 30. Every deal struck on Sep 30 is missing from the printed statement, the PDF, and the Excel export (all three read the same `ledger` object, by design). The closing balance is therefore wrong on the document handed to the customer. The same off-by-one affects cheques cleared after 05:00 local on the To date.

*Fix direction:* build bounds the way `BalanceSheet.tsx:44` and `IncomeStatement.tsx:29` already do, through `rangeBounds('custom', from, to)`, which uses local `endOf(day)`. Then add a test to `ledger.test.ts` with a row dated exactly on `to`. Thirty minutes. Do this first.

### #2 [High] The backend's "today" is UTC, the desk's is UTC+5

No timezone is configured for Node or the Postgres session (section 1.7). Vercel functions run in UTC; Neon's default session timezone is UTC. Four places compute "today" or "this day" server-side:

| Where | What it does | What goes wrong 00:00–05:00 PKT |
|---|---|---|
| `routes/txnDate.ts:43–47` | rejects a `txnDate` later than the server's local today | the dealer's date picker defaults to today (local, `format.ts:109`); the server's today is still yesterday; **every trade and settlement is refused with "cannot be in the future"** |
| `tradesService.ts:118,196`, `settlementsService.ts:64,123` | `COALESCE($txnDate, CURRENT_DATE)` | only when `txnDate` is omitted; the UI always sends it, so latent |
| `journalService.ts:29–33` | manual journal entries have **no** `txn_date` parameter; the column defaults to `CURRENT_DATE` | a manual entry keyed at 01:00 local is dated yesterday, permanently |
| `chequeService.ts:31` | `updated_at::date AS cleared_on` becomes the clearing voucher's `txn_date` | a cheque cleared at 02:00 local is journalled on the previous day; `ledgerBalance` (browser-local) counts it on the correct day, so the reconcile harness will report drift at a date cut between them |
| `chequeHelpers.ts:37–40`, `chequeService.ts:8,18,64` | due date via `toISOString()`, history lines via `shortDate(new Date())` | cosmetic: "Recorded Sep 9" on a Sep 10 cheque |

*Failure scenario:* the first one is the serious one. A desk that opens early, or a dealer entering last night's deals after midnight, cannot record anything for five hours a day, with an error message that blames the date they typed. It has not been reported yet because the desk has traded for exactly one day.

*Fix direction:* two halves. Config half is section 1.7 (`TZ` and the pool `timezone` option). Code half: (a) `parseTxnDate` should compare against a "today" computed in the desk's zone, not `new Date()`; simplest is to read `DESK_TIMEZONE` from env and use `Intl.DateTimeFormat(…, { timeZone }).format()` to get the local `YYYY-MM-DD`; (b) `postJournal` should accept an optional `txnDate` through the same `parseTxnDate` and the Journal page should send one (this also closes a product gap: manual entries cannot be backdated); (c) `clearCheque` should compute `cleared_on` from `now()` in the configured zone, which the pool option gives for free. Add an integration test that sets the process `TZ` to `Asia/Karachi` and posts a trade dated "today" at a simulated 01:00.

### #3 [Medium] Clearing a cheque can drive a customer balance negative

`chequeService.ts:39,41`:
```sql
UPDATE accounts SET receivable = receivable - $1 … WHERE id = $2
```
No `AND receivable >= $1` guard, no `FOR UPDATE`, no allocation. Compare `settlementsService.ts:70` (guarded, 409 on `rowCount === 0`) and `journalService.ts:85–105` (allocation with `GREATEST`, cannot go negative). The cheque path is the only one that can push a column below zero.

*Failure scenario:* a customer owes 100,000 and hands over a 100,000 cheque (receivable stays 100,000, cheque pending). Before it clears, an admin posts a manual journal entry crediting the customer 30,000 (receivable → 70,000, correctly). The cheque clears: receivable → **−30,000**. The customer detail page shows "Receivable PKR −30,000" (or, via `fmt()`, "PKR -30,000"); the TopBar total is understated by 30,000; `deleteAccount`'s balance check passes for a customer who is actually owed money.

*Fix direction:* this needs a decision, not just a guard. Option A: apply the same `GREATEST` allocation `postJournal` uses, so the excess crosses to `payable` (the desk now owes them 30,000, which is the economically correct reading of "they overpaid"). Option B: guard with `WHERE receivable >= $1` and return 409 "the customer's balance no longer covers this cheque", forcing a human to decide. A is consistent with the journal path; B is safer for a bookkeeper who would rather be asked. Either way, lock the customer row (`SELECT … FOR UPDATE`) first, matching the settlement path, and add the test that reproduces the scenario above.

### #4 [Medium] `cost`, `margin` and `pkr_value` are rounded independently, so they stop summing

`tradesService.ts:169` computes `saleValue`, `cost = amount × avgCost`, `margin = saleValue − cost` in doubles. `:194–198` inserts all three into `numeric(18,2)` columns, where Postgres rounds each **separately**. `voucherPostings.saleSides` (`:205–218`) then builds legs from the *unrounded* figures, and `postVoucher` stores each leg rounded separately again.

*Failure scenario:* sell 1,000,000 IRR at 4,952.53 IRR/PKR with an average cost of 0.000201917 PKR/IRR. `saleValue = 201.9169…` → stored 201.92. `cost = 201.917` → stored 201.92. `margin = −0.0001…` → stored −0.00, i.e. 0. Fine here. Now shift the third decimal: `cost = 201.915`, `margin = 0.0019`. Stored: 201.92 / 201.92 / 0.00 — sums to 201.92, matches. But `cost = 201.914`, `saleValue = 201.9169`: stored 201.91 / 201.92 / 0.00 — `cost + margin = 201.91 ≠ pkr_value 201.92`. The income statement check at `reports.ts:344` tolerates it (`< 0.5`). The reconcile harness does not (`TOLERANCE = 0.005`) and will report the journal one paisa off the activity row. `CLAUDE.md` says a red reconcile "is a finding, full stop". The first fractional-paisa IRR or JPY sale makes it red for a reason nobody will want to chase. It has not happened yet only because every live trade so far used whole-rupee rates on a whole-unit currency.

*Fix direction:* round in the service before insert, once, with a stated rule: `pkrValue = round2(saleValue)`, `cost = round2(amount × avgCost)`, `margin = pkrValue − cost` (so the three sum by construction), and pass the rounded figures to `saleSides`. The same for `buyCalc`'s `pkrValue` and `outstanding`. Put `round2` (`Math.round(n * 100) / 100`) in the engine so the client preview uses it too. The deeper fix, integer paisa throughout the engine, is a section 6 refactor.

### #5 [Medium] All money arithmetic is IEEE-754 doubles

`db/pool.ts:10` overrides `pg`'s safe default and parses every `NUMERIC` with `parseFloat`. `buyCalc`/`sellCalc`, the weighted-average recompute (`tradesService.ts:79`), every `reduce((a, t) => a + …)` in the engine and reports, and `postJournal`'s balance check (`debitAmount !== creditAmount`, `journalService.ts:21`) all run in doubles.

*Failure scenario:* not a wrong rupee today. PKR amounts up to ~90 trillion paisa are exactly representable, and a 2-decimal currency at desk volumes is far inside that. The real exposure is (a) #4 above, which is a consequence of rounding-at-the-boundary rather than rounding-in-the-domain, and (b) IRR quantities: an `activity.amount` of `numeric(18,4)` for a 500,000,000-rial position is exactly representable, but its `avg_cost` of `0.000201917123456` is `numeric(24,12)` and round-trips through a double with ~15–16 significant digits, so a twelve-decimal cost multiplied by a nine-digit quantity has already lost the last digit before it is stored. The compounding error is bounded and small (the migration 012 header measured 0.041% at six decimals and fixed it by widening the column; at twelve decimals in a double it is around 1e-7 relative), but it is not zero and it is not auditable.

*Fix direction:* not now. When the engine is next rewritten (phase 5 is the natural moment), represent PKR as integer paisa (`bigint` in Postgres, `number` in JS up to 2^53) and quantities as integer minor units per currency, and keep only `avg_cost` as a decimal string handled by a small decimal helper. Until then, #4's explicit rounding at the boundary is the containment.

### #6 [Medium] `bankId` is trusted: any account can be a settlement or salary account

`accountHelpers.settlementIdFor` (`:32–38`) returns `bankId` as given for `Bank`/`Cheque` methods. Callers: `tradesService.ts:83,172`, `settlementsService.ts:40,101`, `salaryService.ts:76–81,90–99` (which does not even call `settlementIdFor`; it takes `bankId` straight into `credit_account`). The only check is the foreign key: the id must exist. Nothing checks `type IN ('Bank','Cash')` or `archived = false`.

*Failure scenario:* an Operator (any signed-in user can call `/api/settlements/receive`) sends `bankId: '<some customer id>'` with `method: 'Bank'`. The receipt is recorded with the customer as the settlement account; the voucher debits that customer's account as if it were a bank. `ledgerBalance` for the real bank is unchanged; the balance sheet shows the money nowhere sensible. Or, more plausibly, a stale client picks an archived bank after an admin retires it. Or `paySalary` with `bankId: 'margin'` credits Income for a salary payment.

*Fix direction:* `assertSettlementAccount(client, id)` in `accountHelpers.ts` that loads the row and throws `appError(400, 'Pick a bank or cash account')` unless `type IN ('Bank','Cash') AND NOT archived`. Call it from `settlementIdFor` when `bankId` is non-blank, and from `paySalary`/`payAllSalaries`. One integration test per route.

### #7 [Medium] Archived employees are still paid, and an archived bank can be the default

`salaryService.ts:44` (`accrueAllSalaries`) and `:88` (`payAllSalaries`) select `WHERE type = 'Employee'` with no `archived` filter. `accountHelpers.defaultBankId` (`:28`) picks the oldest `Bank` with no `archived` filter.

*Failure scenario:* an employee leaves; the admin archives them (the app's only way to retire an account with history). Next month "Accrue Sep 2026 for all" accrues their salary again; "Pay everything outstanding" pays it. Real money, wrong direction, and the Salary page's `employees()` in `store.tsx:277` does list archived employees too, so the admin would see it, but "accrue all" is one click.

*Fix direction:* `AND archived = false` on both salary queries and on `defaultBankId`. Consider whether an archived employee should also be excluded from `employees()` on the client (the Customers page pattern says: hide from browsing, keep in financial views, so the Salary *list* should show them with a badge but the *bulk actions* must skip them).

### #8 [Medium] A receipt or payment with `method: 'Credit'` moves the balance and posts nothing

`settlementsService.receive` accepts any `method` (`SettleInput.method` includes `'Credit'`, `:15`). For `'Credit'`, `settlementIdFor` returns `null` (`accountHelpers.ts:37`), the activity row is written with no settlement account, the receivable **is** reduced (`:70`), and `buildVoucherLegs` returns `null` because the cash side has no account (`journalService.ts:281`), so no voucher. The UI's `METHODS` (`Settle.tsx:17`) excludes `'Credit'`, so this is API-only.

*Failure scenario:* money is recorded as received from a customer with no account receiving it. The customer's balance drops; cash and bank do not rise; the balance sheet loses the amount into the equity plug, which still says "Balanced" if the shortfall is under half a rupee and "Out of balance" otherwise, without saying why. Reachable by any signed-in user with a modified request.

*Fix direction:* in `receive`/`pay`, `if (input.method === 'Credit') throw appError(400, 'A payment needs a cash, bank or cheque method.')`. Narrow `SettleInput.method` to exclude `'Credit'` at the type level so the compiler enforces it.

### #9 [Medium] Manual journal entries cannot carry a transaction date

`journalService.postJournal` (`:29–33`) does not write `txn_date`; `routes/journal.ts:13–20` does not parse one; `Journal.tsx` has no date field. The column defaults to `CURRENT_DATE` (server timezone, see #2). Every other movement in the app has a deal date; the one hand-written kind does not.

*Failure scenario:* a bookkeeper enters last month's rent on the 3rd of this month. It lands in this month's income statement (`computeIncomeStatement` cuts expense rows on `createdAt` at `reports.ts:322`, and would cut on `txnDate` after phase 5, which is also this month). There is no way to correct it (corrections are a future feature).

*Fix direction:* add `txnDate` to `JournalInput`, parse with `parseTxnDate` in the route (same `sendIfAppError` pattern as trades), write it in the INSERT, add a `DatePicker` to `Journal.tsx` defaulting to today. Then phase 5 can cut on it. This is a small change and it removes the only path that still relies on the database's idea of "today".

### #10 [Low] Two Currency Stock accounts can share a code under a race

`accountsService.resolveCurrencyCode` (`:37–49`) checks uniqueness with a SELECT then INSERTs. No unique index on `(upper(code)) WHERE type = 'Currency Stock'`. Two concurrent creates both pass. Documented consequence at `accountHelpers.ts:54–59`: both value the same position and the balance sheet double-counts it.

*Fix direction:* a partial unique index in migration 019; catch `23505` in `createAccount` and return the existing 409 message.

### #11 [Low] `GET /api/state` is not a consistent snapshot

`stateService.getSnapshot` runs five SELECTs on the bare pool (`:60–64`), so each may run on a different connection with no transaction. A trade committing between the `accounts` read and the `activity` read yields a snapshot where the customer's balance has moved but the deal that moved it is absent.

*Failure scenario:* a one-navigation-stale inconsistency that the next navigation heals; the balance sheet could momentarily report "Out of balance". *Fix direction:* wrap the GET in `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY … COMMIT` on one client. Five lines.

### #12 [Low] Raw 500s where a 400 belongs

- A non-UUID `:id` on `/api/cheques/:id/*` → `22P02 invalid input syntax for type uuid` → 500 (`chequeService.ts:9,29,65`).
- `amount: 1e400` (JSON parses to `Infinity`, passes `> 0`) → `numeric field overflow` → 500 **[verified against Postgres 18: rejected, not stored]**. Same for any amount over 10^16. Add an upper bound in the parser (section 2.1).
- Duplicate account name under a race → `23505` → 500 (`accountsService.ts:22–27`).
- Invalid `method`/`type` enum → CHECK violation → 500 (section 2.1).
- `paySalary` with blank `bankId` → FK violation → 500 (`salaryService.ts:76–81`).

None of these corrupt data; all of them hit the "Something went wrong" message that `PROJECT_STATUS.md` already lists as an open item.

### #13 [Low] The confirmation slip shows client-side arithmetic

`Trade.tsx:147–155` — see section 2.2. Read the posted row from the refreshed snapshot instead.

### #14 [Known, documented] A past-dated balance sheet ignores manual journal entries on customers

`reports.ts:158–163` prefers stored columns when nothing postdates `asOfT`, otherwise replays `customerBalanceAsOf`, which does not model journal entries. Pinned by a test, scheduled for phase 5. Listed so it is not rediscovered.

---

## 4. Security

Verified in passing: all SQL is parameterised (the two dynamic-SQL sites, `migrations/009_lock_core_accounts.ts:12` and `scripts/setupTestDb.ts:23`, build identifiers from trusted constants with escaping). No `eval`, no `dangerouslySetInnerHTML`. No secrets in the git history (searched all refs for connection strings, session secrets and key patterns; only the tracked `.env.example` with placeholder values has ever been committed). All four `backend/.env*` files on disk are gitignored. The frontend bundle carries exactly one env value, the API origin. Every mutating route has `requireAuth` or `requireAdmin`; the mapping matches the UI's gating exactly (deposit: any user; clear/return: admin; journal, salary, accounts, settings write: admin). CORS is an explicit allowlist. Sessions are httpOnly, regenerated on login, CSRF-protected with enforcement live.

### #1 [High] `seed:demo` will create a default admin on any database it is pointed at

`backend/src/scripts/seedDemo.ts:9–16` creates `admin@currencydesk.local` (username `admin`, password `admin-demo-pass`, role **admin**) via `createUser`, which is `ON CONFLICT DO NOTHING` on email only. There is no environment or hostname guard. `csrf:gate:prod`, `snapshot:dump:prod`, `backfill:vouchers:prod` and `reset:business:prod` all demonstrate that pointing a script at production with `DOTENV_CONFIG_PATH=.env.production` is a routine action in this repo.

*Failure scenario:* someone runs `npx cross-env DOTENV_CONFIG_PATH=.env.production tsx src/scripts/seedDemo.ts` (or `npm run seed:demo` with `DATABASE_URL` exported in their shell from an earlier prod task). Production now has an admin account whose credentials are in a public repository, and the login page's placeholder text suggests its username.

*Fix direction:* the guard from `guardTestDatabase.ts`, inverted: refuse unless `NODE_ENV !== 'production'` **and** the `DATABASE_URL` host is loopback. Ten lines. Also change the `Login.tsx:50` placeholder.

### #2 [Medium] A deactivated user, or a demoted admin, keeps their access until the session ends on its own

`routes/auth.ts:73–83` (`/me`) loads the user row and returns it without checking `is_active`. `requireAuth`/`requireAdmin` read `userId` and `role` from the session only. `attemptLogin` checks `is_active` (`authService.ts:35`), so deactivation blocks the *next* login. With `rolling: true` and the keepalive in `activity.ts`, an active session never expires on its own.

*Failure scenario:* an admin deactivates a departing operator's account while that operator is signed in. The operator keeps trading until they close the tab and stay away for five minutes. There is no "revoke sessions" tool. `PROJECT_STATUS.md` documents the "next login" semantics as accepted; this note is that "next login" can be arbitrarily far away.

*Fix direction:* `/me` already has the row: `if (!user.is_active) { req.session.destroy(); 401 }`, and write `req.session.role = user.role` so a role change propagates within one keepalive (≤ 60 s). For an immediate cutoff, a `DELETE FROM session WHERE sess->>'userId' = $1` in a `deactivate-user` CLI. The `sess` column is `json`, so the `->>` works.

### #3 [Medium] Employee salaries are served to Operators

`SnapshotView` filters cost/margin and Income-leg journal rows for non-admins. It does not filter `accounts.monthly_salary` (`mappers.ts:74` sets it for every Employee row regardless of view) or salary journal rows (`mapJournalRow` only omits rows touching an Income account; salary rows are `salaryExpense → salaryPayable`, both non-Income). The Salary page is admin-gated in the UI, but `/transactions` is not, and `Transactions.tsx:104` lists every non-voucher journal row; the "Journal" filter chip is hidden for Operators (`:134`) but the "All" view still includes them.

*Failure scenario:* an Operator opens Transactions and reads "Salary accrual Sep 2026 — Ali Khan, PKR 50,000" for every colleague, and `/accounts` shows "PKR 50,000/mo" on each employee row (`Accounts.tsx:228`). `PROJECT_STATUS.md` promises Operators "cannot reach payroll".

*Fix direction:* extend `SnapshotView` with `includePayroll: boolean` (admin only), omit `monthlySalary` in `mapAccountRow` and return `null` from `mapJournalRow` for rows with `salary_kind` set when false. Same shape as the existing margin filter, same test file pattern (`stateMargin.authorization.test.ts`). Side effect to check: `accountRefs.inUseAccountIds` will under-count employee references for Operators; harmless because Operators cannot edit accounts.

### #4 [Low] Login rate limiting is per-IP only

`routes/auth.ts:17–24`: 20 attempts per 15 minutes per client IP. A desk's staff typically share one office IP, so a colleague's typos can lock out the whole desk for 15 minutes; conversely an attacker with many IPs is not slowed at all against one username. *Fix direction:* a second limiter keyed on the lowercased identifier (say 10 per 15 minutes), using the same Postgres store. Both limiters, not either.

### #5 [Low] Login CSRF is open

Documented at `middleware/csrf.ts:49–57`. An attacker can log a victim's browser into the attacker's account. Impact here is low (the victim sees an empty desk under the wrong name). Left as documented.

### #6 [Low] No security headers, no CSP

`app.ts` has no `helmet`. The API returns JSON only, so clickjacking and MIME sniffing are not live risks; HSTS is set by Vercel's edge. The frontend loads fonts from `fonts.googleapis.com` (`index.css:1`) and has no CSP. *Fix direction:* `helmet()` with defaults on the backend (one line, no behaviour change for a JSON API); self-host the fonts and add a `Content-Security-Policy` header via `frontend/vercel.json` when convenient.

### #7 [Low] `trust proxy 1` is correct for Vercel and wrong for anything with two hops

`app.ts:27`. If the backend is ever fronted by a second proxy (Cloudflare in front of Vercel, say), `req.ip` becomes the inner proxy's address and the rate limiter keys everyone together. Noted because the comment there says "every deployment target puts exactly one reverse proxy in front", which is an assumption about the future.

### #8 [Low] Audit trail gaps

`created_by`/`updated_by` are on every row, but a deleted account leaves no record (hard `DELETE`, `accountsService.ts:220`), archive/unarchive is only visible on the row itself, and edits to an account's fields keep only the latest `updated_by`. `PROJECT_STATUS.md` already lists "who archived / who overrode a type is recorded but shown nowhere". An `account_events` append-only table (or simply refusing hard delete once the client has agreed archiving is the route) is the direction; not urgent.

### #9 [Low] The untracked one-off script logs into production

`resetAdminPassword.oneoff.ts:238–262` performs a real `POST /api/auth/login` against the production API as its verification step, creating a real session that is never destroyed. Delete the file (section 1.13).

### #10 [Informational] Things a pentester would try and find closed

Session fixation (regenerated), user enumeration via timing (dummy hash) and via message (single message), role escalation via client (`requireAdmin` on every admin route), CSRF (enforced), SQL injection (parameterised), IDOR on cheques/accounts (ids are UUIDs and every row is visible to every signed-in user by design, so there is nothing to escalate to), mass assignment (routes pick fields explicitly), preview deployments against production (disabled and tripwired).

---

## 5. Technical debt and dead code

Severity here is "how likely is this to cost someone an afternoon".

| Sev | Where | What | Direction |
|---|---|---|---|
| **Medium** | `backend/src/scripts/resetAdminPassword.oneoff.ts` | Untracked one-off whose header says "delete this file once the password is reset". Contains a client email and the production URL as defaults, and logs into production. | Delete. |
| **Medium** | `services/userService.ts:36–66` | `hasUsernameColumn` fallback with comment "Delete this once production is known to be migrated". Migration 011 has been live for weeks. Every login pays for a `try/catch` and a module-level mutable flag that can only ever flip one way. | Delete the fallback and the flag; keep the single-query lookup. |
| **Medium** | `services/businessDataReset.ts:107–113` | Magic counts (13 / 6 / 18 / 1) that break on the next migration, currency or setting. Fails safe, but will be "fixed" by editing the number. | Section 1.6. |
| **Medium** | `README.md:16`, `:143–145`, `:117–119` | Says the desk trades three currencies (it trades six), says "CSRF protection is not yet implemented" (it is enforced), points to a "Known Limitations" section of `CLAUDE.md` that no longer exists, and omits `ledger.ts` from the engine layout. This is the file a new developer reads first. | Rewrite the three paragraphs from `CLAUDE.md`. |
| **Medium** | `db/migrate.ts:25–27` | Filters on `.sql` and `.ts`. `tsc` neither copies `.sql` files to `dist/` nor emits `.ts`, so `node dist/db/migrate.js` would find zero migrations and report everything applied. Works only via `tsx` from source, which is how it is run today, but nothing says so. | Either add a comment and a guard (`if (files.length === 0) throw`), or copy `migrations/` into `dist/` in the build and accept `.js`. |
| **Medium** | `frontend/src/pages/Trade.tsx:17–51, 79–84, 101, 126–129, 137–141, 270–342, 373` | ~110 lines of commented-out settlement UI with a nine-step restore procedure. Client-requested and documented as revivable, so not dead code in the usual sense, but it is code that `tsc` and `oxlint` cannot see, so it rots silently: the `cn` import was already dropped to keep lint clean (`:43–45`), and any refactor of `Button` or `Combobox` will not be applied to it. | Replace the comments with a `SETTLEMENT_UI_ENABLED = false` constant and `{SETTLEMENT_UI_ENABLED && (…)}` blocks. Same reversibility, compiled every build. |
| **Low** | `npm audit` | 3 moderate advisories in `qs` via `body-parser`/`express@4` (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g). `npm audit fix` resolves them within Express 4. | Run it; re-run tests. |
| **Low** | dependency drift | `express` 4.22 (5.2 available; not urgent), `bcryptjs` 2.4 (3.0), `express-rate-limit` 7.5 (8.7), `dotenv` 16 (17), `cross-env` 7 (10). TypeScript 5.9 in backend/engine vs 6.0 in frontend; `@types/node` 22 in backend vs 24 in frontend. Nothing here is a known-vulnerable version. | Align the TypeScript and `@types/node` majors across workspaces first (they share one `node_modules`); the rest at leisure. |
| **Low** | `frontend/src/components/ui/dialog.tsx`, `select.tsx`, `tabs.tsx` | Zero importers anywhere in `src/`. Three Radix packages (`react-dialog`, `react-select`, `react-tabs`) are in `package.json` only for them. | Delete the three files and three dependencies. |
| **Low** | unused exports | `PopoverAnchor` (`popover.tsx:7`), `fmtSigned` (`format.ts:62`), `CardHeader`/`CardTitle`/`CardContent` (`card.tsx:25–35`), `activityLabel` (`ui-helpers.tsx:56`), `isSessionActive` (`sessionExpiry.ts:35`), and the four form-state interfaces `AcctFormState`/`TradeFormState`/`SettleFormState`/`JournalFormState` (`lib/types.ts:12–72`) which describe a state shape no page uses any more (pages use individual `useState`s). | Delete. |
| **Low** | `reports.ts:316` | `currencyRows[].rows: []` is always empty; the income statement never populates per-currency detail rows. Dead field on the result type. | Remove the field or populate it. |
| **Low** | `services/tradesService.ts:11`, `voucherBackfill.ts:34` | Two `MARGIN_ACCOUNT = 'margin'` constants. | Section 1.4. |
| **Low** | `scripts/*.ts` | Five copies of `arg()`. | One `scripts/lib/args.ts`. |
| **Low** | `config/env.ts:20` | Error text says "Copy server/.env.example to server/.env"; the directory is `backend/`. | Fix the string. |
| **Low** | `lib/useBootReady.ts:8–9` | Comment says "the store hydrates synchronously from localStorage"; it has fetched from the API for weeks. | Fix the comment. |
| **Low** | `pages/Salary.tsx:147–152` | Inline hand-written SVG clock while `lucide-react` (already imported in the file) has `Clock`. | Use the icon. |
| **Low** | `migrations/013`, `010` | `csrf_missing_token` and `rate_limit_hits` are never pruned. Bounded by design (hourly buckets; one row per IP), but grow forever. | A weekly `DELETE … WHERE last_seen < now() - interval '30 days'` in a cron or at boot. |
| **Low** | `test/dbFixtures.ts:11` vs `services/businessDataReset.ts:64` | `resetBusinessData` (TRUNCATE) vs `resetBusinessDataForGoLive` (targeted DELETE) — same name, opposite safety. | Rename the fixture. |
| **Low** | `CLAUDE.md:602` | Claims 283 tests; there are 286 `it(` blocks. | Trivial; noted because that document's accuracy is a stated goal. |
| **Low** | `PROJECT_STATUS.md` Part 2, requirement 7 | Self-flagged as stale on 2026-09-09 (cites deleted trades as evidence, names 2026-09-03 as the last clearing). | Update as already planned. |
| **Low** | no CI | `npm run test` is manual; `tsc`, `oxlint` and the 286 tests only run when someone remembers. The 2026-09-03 log records a flake that only appeared because "five new test files landed ahead of it", the kind of thing CI catches. | A GitHub Actions workflow with a `postgres:16` service running `npm test` on push. Half a day. |

Not debt, but worth stating: there are no `TODO`/`FIXME`/`HACK` markers anywhere in the source. Known gaps are written as prose in comments and in `PROJECT_STATUS.md` instead, which is more honest but means `grep TODO` returns nothing and a reader has to know to look in the log.

---

## 6. Quick wins vs. bigger refactors

### Quick wins — under 30 minutes each, low risk, no design decision needed

Ordered by value.

1. **Fix the statement "To" date** (§3 #1): use `rangeBounds` in `LedgerDetail.tsx:45–46`; add the boundary-day test to `ledger.test.ts`.
2. **Guard `seed:demo`** (§4 #1): refuse on non-loopback host or `NODE_ENV=production`. Change the login placeholder.
3. **Set the timezone, config half** (§1.7): `TZ=Asia/Karachi` on Vercel and in `.env.example`; `options: '-c timezone=Asia/Karachi'` on the pool. This alone fixes the `CURRENT_DATE` and `updated_at::date` cases in §3 #2; the `parseTxnDate` case also fixes itself once Node's local time is the desk's.
4. **Reject `'Credit'` on settlements** (§3 #8): one `if` in each of `receive`/`pay`; narrow the type.
5. **Validate `bankId`** (§3 #6): `assertSettlementAccount` helper; call from `settlementIdFor` and the two salary functions.
6. **Exclude archived rows** (§3 #7): `AND archived = false` in `accrueAllSalaries`, `payAllSalaries`, `defaultBankId`.
7. **`/me` checks `is_active` and refreshes `role`** (§4 #2, the cheap half).
8. **Delete `resetAdminPassword.oneoff.ts`** (§1.13, §5).
9. **Delete the `hasUsernameColumn` fallback** (§5).
10. **Derive the reset script's expected counts** instead of hardcoding them (§1.6).
11. **`npm audit fix`** (§5).
12. **Delete `dialog.tsx`/`select.tsx`/`tabs.tsx` and their three Radix deps**, plus the unused exports (§5).
13. **`runTransaction` helper** for `routes/settings.ts` (§2.1).
14. **Wrap `GET /api/state` in a read-only repeatable-read transaction** (§3 #11).
15. **Fix the four stale strings**: `README.md` currency count and CSRF claim, `env.ts:20` path, `useBootReady.ts` comment, `CLAUDE.md` test count.
16. **Add an upper bound to amount parsing** so `1e400` is a 400, not a 500 (§3 #12).
17. **Rename `dbFixtures.resetBusinessData`** (§5).
18. **Extract the shared settings constants and `MIN_PASSWORD_LENGTH`** to one place (§1.8, §1.12).
19. **Return a `code` on CSRF errors** and match on it client-side instead of a regex on the message (§1.12).

Items 1 to 7 touch behaviour on live financial data and should each get the "write the test, revert the fix, watch it fail" treatment `CLAUDE.md` prescribes. Items 8 to 19 do not change any stored figure.

### Bigger refactors — need a design decision, a migration, or both

Ordered by how soon they will matter.

1. **Rounding at the boundary** (§3 #4). Small code change, but it changes stored figures on new sales by up to a paisa relative to today's behaviour, and it interacts with the tolerance question (§1.11). Decide the rounding rule (recommended: `margin = round2(saleValue) − round2(cost)`), write it into `CLAUDE.md`'s currency section, apply it in `tradesService` and the engine's `sellCalc`, and run `npm run reconcile` on real data before and after. Half a day including tests. **Do this before the desk's first IRR or JPY sale.**
2. **Timezone, code half** (§3 #2 b and c): `parseTxnDate` computing "today" in the configured zone; `postJournal` accepting a `txnDate`; `clearCheque` dating the voucher in the desk's zone; a Journal page date picker. One day. Depends on a decision about whether manual entries may be backdated at all (the client's correction-policy decision #1 says corrections post "always today", which is a different question, but worth confirming they do not want the same rule here).
3. **Cheque clearing against an insufficient balance** (§3 #3). Needs the client to choose between "cross to payable" and "refuse and ask". Then a lock, a guard or allocation, and a test. Half a day after the decision.
4. **Payroll visibility for Operators** (§4 #3). A `SnapshotView` flag, two mapper changes, one test file. Half a day. Decision: does the client want Operators to see the *existence* of salary postings (without amounts) or nothing at all?
5. **Make `activity.currency` NOT NULL for trades and remove the eighteen `'AED'` fallbacks** (§1.2). One migration, one type change, the compiler finds the rest. One day. Run `reconcile` after.
6. **Input parsing module** (§2.1). Mechanical, but touches every route; best done alongside #2 above since `journal.ts` gains a date field anyway. One day.
7. **Currencies as a table** (§1.3), only if a seventh currency or per-currency admin settings are on the horizon. Otherwise the startup assertion is the right size. One to two days for the table.
8. **Business name on printed statements** (§1.12 `PrintHeader`): an `app_settings` key plus a Settings page field. Two hours, but it is a client-visible change to filed documents, so it wants their sign-off on the exact text.
9. **Phase 5: reports read the journal, and move into the engine** (§2.1). Already planned. The recommendation this audit adds: move `reports.ts` into `packages/engine` **as part of** phase 5 rather than after it, and consider integer-paisa money (§3 #5) at the same time, because both are rewrites of the same functions and doing them in two passes means re-verifying the reconcile harness twice. Multi-day; the largest item in the project.
10. **The whole-snapshot read model** (§2.3). Not needed for a year or more at current volume. Plan it when phase 5 lands, because a server-side balance sheet endpoint is the first per-resource endpoint the app will want.
11. **Session revocation and an admin user-management screen** (§4 #2, §4 #8). The CLI covers creation; deactivation, role change, and "sign everyone out" have no tool. A day for the CLI versions; longer for a screen.
12. **CI** (§5). Half a day. Independent of everything else and makes all of the above safer.

---

*End of audit.*
