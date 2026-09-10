import type { Pool } from 'pg'
import { hashPassword } from '../services/authService.js'
import { invalidateSettingsCache } from '../services/settingsService.js'

/**
 * TRUNCATEs the five business tables and reseeds the structural chart of accounts — the fast,
 * disposable reset every integration test runs in its `beforeAll`. `users`/`session` are untouched.
 *
 * NAMED to be unmistakable from `services/businessDataReset.ts`'s `resetBusinessDataForGoLive`,
 * which does the opposite thing safely: targeted DELETEs in FK order that leave migration 009's
 * core-account trigger armed. TRUNCATE does NOT fire that trigger, so running THIS against a real
 * database would walk straight past the guard and take the chart of accounts with it. The two
 * near-identical old names (`resetBusinessData` here vs `resetBusinessDataForGoLive` there) were a
 * standing invitation to run the wrong one in the wrong place.
 */
export async function truncateAndReseedTestDb(pool: Pool): Promise<void> {
  // csrf_missing_token is included so an untokened request made by one test file cannot be seen by
  // another — the gate script's whole value is that a row here means something, so leaking rows
  // between files would make the CSRF tests assert against each other's noise.
  await pool.query('TRUNCATE accounts, stock_positions, cheques, activity, journal_entries, csrf_missing_token RESTART IDENTITY CASCADE')
  await pool.query('ALTER SEQUENCE cheque_number_seq RESTART WITH 1')
  await pool.query('ALTER SEQUENCE journal_ref_seq RESTART WITH 1')
  await pool.query(`
    INSERT INTO accounts (id, type, name, is_system, category, notes) VALUES
      ('bank', 'Bank', 'Bank', true, NULL, ''),
      ('cash', 'Cash', 'Cash in hand', true, NULL, 'Counter drawer.'),
      ('currency', 'Currency Stock', 'Currency stock (AED)', true, NULL,
         'Quantity and weighted-average cost are derived from the currency ledger.'),
      ('margin', 'Income', 'Margin / Income', true, NULL,
         'Trading margin on currency sales, plus anything journalled to Income.'),
      ('expense', 'Expense', 'Expenses', true, 'General', ''),
      ('salaryExpense', 'Expense', 'Salary Expense', true, 'Payroll',
         'Debited when a pay period is accrued.'),
      ('salaryPayable', 'Payable', 'Salary Payable', true, NULL,
         'Accrued salary not yet paid out.'),
      ('capital', 'Capital', 'Opening Balance / Capital', true, NULL, '')
  `)
  await pool.query("UPDATE accounts SET code = 'AED' WHERE id = 'currency'")
  // Migrations 012 and 014 — one Currency Stock account and one stock position per traded
  // currency. This must stay in step with CURRENCIES: a code the engine will accept but that has
  // no account and no stock row behind it fails in a way no unit test would catch.
  await pool.query(`
    INSERT INTO accounts (id, type, name, is_system, code, notes) VALUES
      ('currencyAFN', 'Currency Stock', 'Currency stock (AFN)', true, 'AFN',
         'Quantity and weighted-average cost are derived from the currency ledger.'),
      ('currencyIRR', 'Currency Stock', 'Currency stock (IRR)', true, 'IRR',
         'Quantity and weighted-average cost are derived from the currency ledger.'),
      ('currencyUSD', 'Currency Stock', 'Currency stock (USD)', true, 'USD',
         'Quantity and weighted-average cost are derived from the currency ledger.'),
      ('currencyEUR', 'Currency Stock', 'Currency stock (EUR)', true, 'EUR',
         'Quantity and weighted-average cost are derived from the currency ledger.'),
      ('currencyJPY', 'Currency Stock', 'Currency stock (JPY)', true, 'JPY',
         'Quantity and weighted-average cost are derived from the currency ledger.')
  `)
  await pool.query("INSERT INTO stock_positions (code, available, avg_cost) VALUES ('AED', 0, 0), ('AFN', 0, 0), ('IRR', 0, 0), ('USD', 0, 0), ('EUR', 0, 0), ('JPY', 0, 0)")

  // THE IN-MEMORY SETTINGS CACHE, cleared here because a TRUNCATE cannot reach it.
  //
  // settingsService caches idle_timeout_minutes for 30 seconds per PROCESS, and vitest runs every
  // test file in one worker — so the cache outlives the database reset that is supposed to give
  // each file a clean slate. applySessionIdleTimeout reads it on every authenticated request, so
  // every file that logs in warms it for the next one.
  //
  // That is what made the suite intermittently red on 2026-09-03: idleTimeout.test.ts asserts the
  // stored value, but whether a previous file's cached entry was still inside its 30-second window
  // depended entirely on how long the files before it took. Never reproducible in isolation —
  // there is no preceding file to leave a warm cache — and it surfaced that day because five new
  // test files landed ahead of it and changed the timing. Two different tests in that one file
  // failed on two separate runs, which is the signature of a timing dependence rather than a
  // defect in either test.
  invalidateSettingsCache()

  // app_settings is reset to exactly what migration 015 seeds, rather than left alone. Hygiene
  // rather than a fix: the docstring above promises the seed state and this table was the one
  // exception. It was also the first hypothesis for the flake above, and it was WRONG — corrupting
  // the row does not fail the suite, because idleTimeout.test.ts sets what it needs. Kept anyway,
  // labelled honestly, so nobody re-investigates it as a suspect.
  //
  // It is the one stateful table truncateAndReseedTestDb did not touch, and that made the whole suite
  // intermittently red: idleTimeout.test.ts changes idle_timeout_minutes through PATCH
  // /api/settings, nothing truncates it, and a run interrupted part-way through that file leaves
  // the value behind for the NEXT run to trip over. Two failures were seen this way on 2026-09-03,
  // on two different tests in that file, neither reproducible in isolation — which is exactly the
  // signature of leftover state rather than a real defect.
  //
  // Upserted back to the seeded default rather than truncated: an empty table falls back to
  // DEFAULT_IDLE_TIMEOUT_MINUTES in code, so the tests would pass while the database no longer
  // matched what a real migrated database looks like — the fixture's whole job.
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('idle_timeout_minutes', '5', now(), NULL)
     ON CONFLICT (key) DO UPDATE SET value = '5', updated_at = now(), updated_by = NULL`,
  )
  await pool.query("DELETE FROM app_settings WHERE key <> 'idle_timeout_minutes'")

  // Not a business table, but it has to be cleared here for the same reason: the login limiter
  // (20 attempts / 15 min per IP) is backed by a real Postgres table (migration 010), so its
  // counts SURVIVE between test runs. Every test file logs in once in its own beforeAll, so a
  // few consecutive `npm run test` invocations inside one 15-minute window would otherwise start
  // returning 429 from login and fail every file — an environmental failure that looks exactly
  // like a real regression. Test database only; see guardTestDatabase.ts.
  await pool.query('DELETE FROM rate_limit_hits')
}

/** Idempotent — safe to call once per test file even though `users` is never truncated. */
export async function ensureTestUser(pool: Pool, email: string, password: string, role: 'admin' | 'user'): Promise<void> {
  await pool.query(
    `INSERT INTO users (email, password_hash, display_name, role, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (lower(email)) DO NOTHING`,
    [email, hashPassword(password), 'Test User', role],
  )
}

export async function insertCustomer(pool: Pool, name: string, opts: { receivable?: number; payable?: number } = {}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO accounts (type, name, receivable, payable) VALUES ('Customer', $1, $2, $3) RETURNING id`,
    [name, opts.receivable ?? 0, opts.payable ?? 0],
  )
  return rows[0].id
}

export async function insertEmployee(pool: Pool, name: string, monthlySalary: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO accounts (type, name, monthly_salary) VALUES ('Employee', $1, $2) RETURNING id`,
    [name, monthlySalary],
  )
  return rows[0].id
}
