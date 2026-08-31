import type { Pool } from 'pg'
import { hashPassword } from '../services/authService.js'

/** Wipes the five business tables back to exactly the seed state migrations 008 + 012 leave
 * behind (eight system accounts, plus the two extra Currency Stock accounts and the AFN/IRR
 * stock rows 012 adds) — the same
 * TRUNCATE + reseed used to reset the real dev database after a manual verification pass (see
 * CLAUDE.md's "Business-data migration" section), just run before every concurrency test
 * instead of by hand. `users`/`session` are untouched. */
export async function resetBusinessData(pool: Pool): Promise<void> {
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
  // Migration 012 — one Currency Stock account and one stock position per traded currency.
  await pool.query(`
    INSERT INTO accounts (id, type, name, is_system, code, notes) VALUES
      ('currencyAFN', 'Currency Stock', 'Currency stock (AFN)', true, 'AFN',
         'Quantity and weighted-average cost are derived from the currency ledger.'),
      ('currencyIRR', 'Currency Stock', 'Currency stock (IRR)', true, 'IRR',
         'Quantity and weighted-average cost are derived from the currency ledger.')
  `)
  await pool.query("INSERT INTO stock_positions (code, available, avg_cost) VALUES ('AED', 0, 0), ('AFN', 0, 0), ('IRR', 0, 0)")

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
