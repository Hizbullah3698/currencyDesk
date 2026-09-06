import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { PoolClient } from 'pg'
import { pool } from '../../db/pool.js'
import { deleteAccount, archiveAccount } from '../../services/accountsService.js'
import { isAppError } from '../../services/transact.js'
import { resetBusinessData } from '../dbFixtures.js'

// ---------------------------------------------------------------------------
// deleteAccount's guards. There were none of these before 2026-09-06 — the success path and
// every refusal were uncovered, which is how the two faults below survived review.
//
// FAULT 1 — the wrong predicate. Deletion was gated on CORE_ACCOUNT_IDS (7 ids), not is_system
// (13 accounts). The gap is the six Currency Stock accounts, and deleting one is silent twice
// over: every later trade in that currency posts no voucher at all (buildVoucherLegs returns
// null on a side with no account, and the caller's policy is that the trade still succeeds), and
// the holding stops being an asset on the balance sheet while remaining in stock_positions.
// Neither raises.
//
// FAULT 2 — three reference paths were unchecked. Every FK into accounts is NO ACTION, so the
// database refused these deletes correctly; the problem was that a raw 23503 is not an appError,
// so the user got `500 Something went wrong` instead of being told what was in the way.
//
// Each test below was confirmed to FAIL against the pre-fix code before the fix was put back — a
// guard whose test has never been seen failing is not known to be testing anything.
//
// Service-level, no HTTP: these are assertions about SQL and about which appError comes back.
// ---------------------------------------------------------------------------

/** Runs `fn` and returns the appError it threw, failing the test if it did not throw one. */
async function refusal(fn: () => Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await fn()
  } catch (err) {
    if (isAppError(err)) return err
    throw err
  }
  throw new Error('expected a refusal, but the call succeeded')
}

describe('deleteAccount', () => {
  let client: PoolClient

  beforeAll(async () => {
    client = await pool.connect()
  })

  beforeEach(async () => {
    await resetBusinessData(pool)
  })

  afterAll(async () => {
    client.release()
    await pool.end()
  })

  // -------------------------------------------------------------------------
  // The structural scaffold
  // -------------------------------------------------------------------------

  it('refuses every one of the 13 built-in accounts', async () => {
    // The whole set, not a sample. A seventh currency seeded without being covered here would
    // otherwise be deletable the day it lands.
    const { rows } = await client.query<{ id: string }>('SELECT id FROM accounts WHERE is_system = true ORDER BY id')
    expect(rows).toHaveLength(13)
    for (const { id } of rows) {
      const err = await refusal(() => deleteAccount(client, id))
      expect(err.status, id).toBe(400)
      expect(err.message, id).toMatch(/built-in account/)
    }
  })

  it('refuses a Currency Stock account — the case CORE_ACCOUNT_IDS did not cover', async () => {
    // Stated separately from the sweep above because this is the actual regression. Under the old
    // predicate every one of these six was deletable by an Admin, and the damage was silent.
    for (const id of ['currency', 'currencyAFN', 'currencyIRR', 'currencyUSD', 'currencyEUR', 'currencyJPY']) {
      const err = await refusal(() => deleteAccount(client, id))
      expect(err.message, id).toMatch(/built-in account/)
    }
    const { rows } = await client.query("SELECT 1 FROM accounts WHERE type = 'Currency Stock'")
    expect(rows).toHaveLength(6)
  })

  it('refuses to archive a built-in account too', async () => {
    // Archiving one would hide it from the Accounts page while leaving trading pointed at it —
    // the same predicate has to govern both doors.
    const err = await refusal(() => archiveAccount(client, 'currencyUSD', null))
    expect(err.status).toBe(400)
    expect(err.message).toMatch(/built-in account/)
  })

  // -------------------------------------------------------------------------
  // The three reference paths that used to produce a 500
  // -------------------------------------------------------------------------

  it('refuses an Employee with salary history, naming the salary posting', async () => {
    // THE ONE A REAL USER HITS FIRST. A salary accrual posts Dr salaryExpense / Cr salaryPayable,
    // so the employee is never a debit or credit leg — only salary_employee_id points at them.
    // The old three-column check saw an employee with a full year of payroll as untouched, let
    // the DELETE through, and the foreign key turned it into a 500.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO accounts (type, name, is_system, phone, city, designation, monthly_salary)
       VALUES ('Employee', 'Bilal', false, '—', '—', 'Teller', 50000) RETURNING id`,
    )
    const empId = rows[0].id
    await client.query(
      `INSERT INTO journal_entries (narration, debit_account, credit_account, debit_label, credit_label, amount, salary_employee_id, salary_period, salary_kind)
       VALUES ('Salary accrual 2026-09 — Bilal', 'salaryExpense', 'salaryPayable', 'Salary Expense', 'Salary Payable', 50000, $1, '2026-09', 'accrual')`,
      [empId],
    )

    const err = await refusal(() => deleteAccount(client, empId))
    expect(err.status).toBe(400)
    expect(err.message).toMatch(/1 salary posting/)
    expect(err.message).toMatch(/Archive it instead/)
    expect((await client.query('SELECT 1 FROM accounts WHERE id = $1', [empId])).rows).toHaveLength(1)
  })

  it('refuses a Bank account with a cheque drawn on it', async () => {
    // A cheque names its bank from the day it is taken, but nothing journals against that bank
    // until it clears — so between those two moments the account looked free to delete.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO accounts (type, name, is_system, bank_name, account_no)
       VALUES ('Bank', 'HBL Main', false, 'HBL', '001') RETURNING id`,
    )
    const bankId = rows[0].id
    await client.query(
      `INSERT INTO cheques (direction, number, party, bank, bank_account_id, amount, due_date, status)
       VALUES ('Inward', '1001', 'Wazir', 'HBL', $1, 25000, '2026-09-30', 'Pending')`,
      [bankId],
    )

    const err = await refusal(() => deleteAccount(client, bankId))
    expect(err.status).toBe(400)
    expect(err.message).toMatch(/1 cheque drawn on it/)
  })

  it('refuses a Bank account a trade was settled through', async () => {
    // A Cheque-method trade records no money movement on the day by design, so the settlement
    // account carries no voucher leg yet — the third way an in-use account read as unused.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO accounts (type, name, is_system, bank_name, account_no)
       VALUES ('Bank', 'Meezan', false, 'Meezan', '002') RETURNING id`,
    )
    const bankId = rows[0].id
    await client.query(
      `INSERT INTO activity (type, currency, customer_name, amount, rate, pkr_value, method, settlement_account_id)
       VALUES ('purchase', 'AED', 'Walk-in', 1000, 77, 77000, 'Cheque', $1)`,
      [bankId],
    )

    const err = await refusal(() => deleteAccount(client, bankId))
    expect(err.status).toBe(400)
    expect(err.message).toMatch(/1 transaction settled through it/)
  })

  // -------------------------------------------------------------------------
  // The paths that were already covered, kept so a rewrite cannot quietly drop them
  // -------------------------------------------------------------------------

  it('refuses a Customer with trades against them', async () => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO accounts (type, name, is_system, phone, city)
       VALUES ('Customer', 'Wazir', false, '—', '—') RETURNING id`,
    )
    const custId = rows[0].id
    await client.query(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method)
       VALUES ('purchase', 'AED', $1, 'Wazir', 1000, 77, 77000, 'Credit')`,
      [custId],
    )

    const err = await refusal(() => deleteAccount(client, custId))
    expect(err.message).toMatch(/1 transaction against it/)
  })

  it('names every kind of reference at once rather than only the first', async () => {
    // The message is what an admin acts on. Reporting one reference at a time turns clearing an
    // account into a guessing game of delete-read-retry.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO accounts (type, name, is_system, phone, city)
       VALUES ('Customer', 'Karim', false, '—', '—') RETURNING id`,
    )
    const custId = rows[0].id
    await client.query(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method)
       VALUES ('purchase', 'AED', $1, 'Karim', 1000, 77, 77000, 'Credit')`,
      [custId],
    )
    await client.query(
      `INSERT INTO cheques (direction, number, party, customer_id, bank, bank_account_id, amount, due_date)
       VALUES ('Inward', '2001', 'Karim', $1, 'HBL', 'bank', 5000, '2026-10-01')`,
      [custId],
    )
    await client.query(
      `INSERT INTO journal_entries (narration, debit_account, credit_account, debit_label, credit_label, amount)
       VALUES ('Adjustment', $1, 'capital', 'Karim', 'Capital', 100)`,
      [custId],
    )

    const err = await refusal(() => deleteAccount(client, custId))
    expect(err.message).toMatch(/1 transaction/)
    expect(err.message).toMatch(/1 cheque/)
    expect(err.message).toMatch(/1 journal entry/)
  })

  it('refuses an account that still carries a balance', async () => {
    // receivable/payable are STORED columns, not derived — so this is not implied by the
    // reference check. Seeded directly here precisely because through the app the two always move
    // together; the guard exists for the case where they have come apart, which is exactly the
    // fault found on 2026-09-03.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO accounts (type, name, is_system, phone, city, receivable)
       VALUES ('Customer', 'Ahmed', false, '—', '—', 4992) RETURNING id`,
    )
    const err = await refusal(() => deleteAccount(client, rows[0].id))
    expect(err.status).toBe(400)
    expect(err.message).toMatch(/still carries a balance/)
  })

  // -------------------------------------------------------------------------
  // The success path — never covered before at all
  // -------------------------------------------------------------------------

  it('deletes a clean, client-created account', async () => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO accounts (type, name, is_system, phone, city)
       VALUES ('Customer', 'Unused Customer', false, '—', '—') RETURNING id`,
    )
    await deleteAccount(client, rows[0].id)
    expect((await client.query('SELECT 1 FROM accounts WHERE id = $1', [rows[0].id])).rows).toHaveLength(0)
  })

  it('deletes an account whose only reference was removed first', async () => {
    // Confirms the guard tracks live state rather than latching — an account that HAD a trade and
    // no longer does is deletable, which is what makes "settle it, then remove it" work.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO accounts (type, name, is_system, phone, city)
       VALUES ('Customer', 'Briefly Busy', false, '—', '—') RETURNING id`,
    )
    const custId = rows[0].id
    const act = await client.query<{ id: string }>(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method)
       VALUES ('purchase', 'AED', $1, 'Briefly Busy', 1000, 77, 77000, 'Credit') RETURNING id`,
      [custId],
    )
    await refusal(() => deleteAccount(client, custId))
    await client.query('DELETE FROM activity WHERE id = $1', [act.rows[0].id])
    await deleteAccount(client, custId)
    expect((await client.query('SELECT 1 FROM accounts WHERE id = $1', [custId])).rows).toHaveLength(0)
  })
})
