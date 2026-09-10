import type { PoolClient } from 'pg'
import { deskToday } from '../config/deskTime.js'
import { appError } from './transact.js'
import { getAccount, settlementName } from './accountHelpers.js'

const UNIQUE_VIOLATION = '23505'
const ACCRUAL_CONSTRAINT = 'journal_entries_salary_accrual_uniq'

async function outstandingFor(client: PoolClient, empId: string): Promise<number> {
  const { rows } = await client.query<{ accrued: number; paid: number }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE salary_kind = 'accrual'), 0) AS accrued,
       COALESCE(SUM(amount) FILTER (WHERE salary_kind = 'payment'), 0) AS paid
     FROM journal_entries WHERE salary_employee_id = $1`,
    [empId],
  )
  return (rows[0]?.accrued || 0) - (rows[0]?.paid || 0)
}

export async function accrueSalary(client: PoolClient, empId: string, period: string, actorId: string | null): Promise<void> {
  const emp = await getAccount(client, empId)
  if (!emp || emp.type !== 'Employee') throw appError(400, 'Select a valid employee.')
  if (!(emp.monthly_salary! > 0)) throw appError(400, `${emp.name} has no monthly salary on file — set it on the account first.`)

  try {
    // Every salary posting is dated on the desk's calendar rather than by the column's
    // CURRENT_DATE default (the database's day, UTC on Neon) — see config/deskTime.ts.
    await client.query(
      `INSERT INTO journal_entries (narration, debit_account, credit_account, debit_label, credit_label, amount, salary_employee_id, salary_period, salary_kind, txn_date, created_by, updated_by)
       VALUES ($1, 'salaryExpense', 'salaryPayable', 'Salary Expense', 'Salary Payable', $2, $3, $4, 'accrual', $5::date, $6, $6)`,
      [`Salary accrual ${period} — ${emp.name}`, emp.monthly_salary, empId, period, deskToday(), actorId],
    )
  } catch (err) {
    const pgErr = err as { code?: string; constraint?: string }
    // The pre-check above already covers the common case with a friendly message; this catch is
    // the actual race-proof guard — two concurrent "Accrue" requests for the same employee/period
    // can only ever produce one row, and the loser lands here instead of double-accruing.
    if (pgErr.code === UNIQUE_VIOLATION && pgErr.constraint === ACCRUAL_CONSTRAINT) {
      throw appError(409, `${period} is already accrued for ${emp.name}.`)
    }
    throw err
  }
}

export async function accrueAllSalaries(client: PoolClient, period: string, actorId: string | null): Promise<void> {
  const { rows: employees } = await client.query<{ id: string; name: string; monthly_salary: number }>(
    "SELECT id, name, monthly_salary FROM accounts WHERE type = 'Employee' AND monthly_salary > 0",
  )
  if (employees.length === 0) throw appError(400, 'No employee accounts yet — add one from Accounts with type Employee.')

  // Per-row ON CONFLICT DO NOTHING against the partial unique index, not one bare multi-row
  // insert — a single unique-violation would otherwise abort the whole transaction and silently
  // fail accrual for every other, non-conflicting employee in the same batch too.
  let accruedCount = 0
  for (const emp of employees) {
    const { rowCount } = await client.query(
      `INSERT INTO journal_entries (narration, debit_account, credit_account, debit_label, credit_label, amount, salary_employee_id, salary_period, salary_kind, txn_date, created_by, updated_by)
       VALUES ($1, 'salaryExpense', 'salaryPayable', 'Salary Expense', 'Salary Payable', $2, $3, $4, 'accrual', $5::date, $6, $6)
       ON CONFLICT (salary_employee_id, salary_period) WHERE salary_kind = 'accrual' DO NOTHING`,
      [`Salary accrual ${period} — ${emp.name}`, emp.monthly_salary, emp.id, period, deskToday(), actorId],
    )
    if ((rowCount ?? 0) > 0) accruedCount++
  }
  if (accruedCount === 0) throw appError(400, `Every employee with a salary on file is already accrued for ${period}.`)
}

export async function paySalary(client: PoolClient, empId: string, bankId: string, actorId: string | null): Promise<void> {
  const emp = await getAccount(client, empId)
  if (!emp) throw appError(400, 'Select a valid employee.')

  // "Outstanding" is a derived SUM over journal_entries, not a stored balance column, so there's
  // no single row a guarded UPDATE could check against — locking the employee's account row is
  // the equivalent chokepoint, serializing concurrent pay/accrue attempts for this employee.
  await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [empId])

  const outstanding = await outstandingFor(client, empId)
  if (outstanding <= 0) throw appError(400, `Nothing outstanding for ${emp.name}.`)

  const bankName = await settlementName(client, bankId)
  await client.query(
    `INSERT INTO journal_entries (narration, debit_account, credit_account, debit_label, credit_label, amount, salary_employee_id, salary_period, salary_kind, txn_date, created_by, updated_by)
     VALUES ($1, 'salaryPayable', $2, 'Salary Payable', $3, $4, $5, '', 'payment', $6::date, $7, $7)`,
    [`Salary paid — ${emp.name} · from ${bankName}`, bankId, bankName, outstanding, empId, deskToday(), actorId],
  )
}

export async function payAllSalaries(client: PoolClient, bankId: string, actorId: string | null): Promise<void> {
  // Lock every target employee row up front, in a fixed order — without a consistent lock
  // order, two concurrent bulk-pay runs (or a bulk-pay racing an individual pay touching an
  // overlapping employee) could each hold one lock the other needs and deadlock for real.
  const { rows: employees } = await client.query<{ id: string; name: string }>("SELECT id, name FROM accounts WHERE type = 'Employee' ORDER BY id FOR UPDATE")

  const bankName = await settlementName(client, bankId)
  let paidCount = 0
  for (const emp of employees) {
    const outstanding = await outstandingFor(client, emp.id)
    if (outstanding <= 0) continue
    await client.query(
      `INSERT INTO journal_entries (narration, debit_account, credit_account, debit_label, credit_label, amount, salary_employee_id, salary_period, salary_kind, txn_date, created_by, updated_by)
       VALUES ($1, 'salaryPayable', $2, 'Salary Payable', $3, $4, $5, '', 'payment', $6::date, $7, $7)`,
      [`Salary paid — ${emp.name} · from ${bankName}`, bankId, bankName, outstanding, emp.id, deskToday(), actorId],
    )
    paidCount++
  }
  if (paidCount === 0) throw appError(400, 'No unpaid salary balance to settle.')
}
