import type { PoolClient } from 'pg'

/**
 * The seeded Income account that carries trading margin. A literal id, matching how salaryService
 * names 'salaryExpense'/'salaryPayable' — these are CORE_ACCOUNT_IDS entries the schema guarantees.
 * One definition, imported by both the live posting path (tradesService) and the backfill
 * (voucherBackfill), so a rename cannot land in one and not the other.
 */
export const MARGIN_ACCOUNT_ID = 'margin'

export async function getAccount(client: PoolClient, id: string | null | undefined) {
  if (!id) return undefined
  const { rows } = await client.query('SELECT * FROM accounts WHERE id = $1', [id])
  return rows[0] as
    | {
        id: string
        type: string
        name: string
        // The structural chart-of-accounts flag — true for the 13 accounts migrations 008/012/014
        // seed. It is the delete/archive predicate (see accountsService), which is why it is on
        // this type at all: a caller that forgets it would silently offer to delete the scaffold.
        is_system: boolean
        receivable: number
        payable: number
        monthly_salary: number | null
      }
    | undefined
}

export async function settlementName(client: PoolClient, id: string): Promise<string> {
  const a = await getAccount(client, id)
  return a?.name || '—'
}

export async function defaultBankId(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ id: string }>("SELECT id FROM accounts WHERE type = 'Bank' ORDER BY created_at ASC LIMIT 1")
  return rows[0]?.id || 'bank'
}

export async function settlementIdFor(client: PoolClient, method: string, bankId: string): Promise<string | null> {
  if (method === 'Cash') return 'cash'
  if (method === 'Bank' || method === 'Cheque') return bankId || (await defaultBankId(client))
  // Credit has no settlement account at all — must be a real NULL, not '', since
  // activity.settlement_account_id has a foreign key to accounts(id) and '' is not NULL.
  return null
}

/**
 * The Currency Stock account that holds `code`, or null if the desk has none.
 *
 * **Never derive this id by string concatenation.** `'currency' + code` looks obviously right and
 * is wrong for the desk's most-traded currency: AED's account is `'currency'`, seeded by migration
 * 008 back when AED was the only code, while AFN/IRR/USD/EUR/JPY got `'currencyAFN'` and friends
 * from 012 and 014. There is no `'currencyAED'`. A concatenated id therefore violates the foreign
 * key on the one currency the desk trades most, and does it at write time rather than review time.
 * Resolving by `code` is the only correct route, which is why this lives here as one shared
 * function rather than inline at a call site waiting to be copy-pasted.
 *
 * `upper()` on both sides matches how accountsService decides a code is already taken, so the two
 * agree about which account a code refers to.
 *
 * ON DUPLICATES — deterministic, and deliberately not an error. Two accounts sharing a code is
 * already a broken state (both value the same position, so it double-counts as an asset) but it is
 * only guarded in application code, not by a database constraint. Ordering picks the original
 * consistently instead of an arbitrary row. Throwing here was considered and rejected: it would
 * stop the desk trading over a pre-existing bookkeeping fault that trading itself does not depend
 * on, which is a worse outcome than posting consistently to the older account.
 *
 * ON NULL — the caller's policy, not this function's. It happens when a code is in the engine's
 * CURRENCY_LIST but its seed migration has not run, the same gap `lockStock()` closes for
 * `stock_positions`. That cannot be papered over the same way, because an account id cannot be
 * invented.
 */
export async function stockAccountIdFor(client: PoolClient, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM accounts
     WHERE type = 'Currency Stock' AND upper(code) = upper($1)
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
    [code],
  )
  return rows[0]?.id ?? null
}

/**
 * Every way a row elsewhere can point at an account, counted in one pass.
 *
 * WHY ALL SEVEN AND NOT THE OBVIOUS THREE. Each of these columns is a plain
 * `REFERENCES accounts(id)` with no ON DELETE clause, so Postgres defaults to NO ACTION and
 * refuses the delete. Integrity was therefore never at risk — but a raw 23503 is not an
 * appError, so handleMutation rethrows it and the global handler answers
 * `500 Something went wrong`. Three of these columns were unchecked and each is genuinely
 * reachable:
 *
 *   - `journal_entries.salary_employee_id` — salary accrual posts Dr salaryExpense / Cr
 *     salaryPayable, so the EMPLOYEE IS NEVER A LEG. An employee with a full year of payroll
 *     behind them looked completely unreferenced to the old three-column check.
 *   - `cheques.bank_account_id` — a cheque names a bank account from the day it is taken, but
 *     nothing journals against that bank until it clears.
 *   - `activity.settlement_account_id` — a Cheque-method trade records no money movement on the
 *     day by design, so the settlement account carries no voucher leg yet.
 *
 * `journal_entries.opening_for` is included for completeness; in practice it always accompanies
 * a debit/credit leg on the same row, so it never fires alone.
 *
 * One query rather than seven, and deliberately not seven queries in a `Promise.all` — a single
 * client runs one statement at a time.
 */
export interface AccountReferences {
  trades: number
  settlements: number
  cheques: number
  chequesDrawnOn: number
  journalEntries: number
  salaryPostings: number
  openingBalances: number
}

export async function accountReferences(client: PoolClient, id: string): Promise<AccountReferences> {
  const { rows } = await client.query<Record<keyof AccountReferences, number>>(
    `SELECT
       (SELECT count(*) FROM activity        WHERE customer_id           = $1)::int AS trades,
       (SELECT count(*) FROM activity        WHERE settlement_account_id = $1)::int AS settlements,
       (SELECT count(*) FROM cheques         WHERE customer_id           = $1)::int AS cheques,
       (SELECT count(*) FROM cheques         WHERE bank_account_id       = $1)::int AS "chequesDrawnOn",
       (SELECT count(*) FROM journal_entries WHERE debit_account = $1 OR credit_account = $1)::int AS "journalEntries",
       (SELECT count(*) FROM journal_entries WHERE salary_employee_id    = $1)::int AS "salaryPostings",
       (SELECT count(*) FROM journal_entries WHERE opening_for           = $1)::int AS "openingBalances"`,
    [id],
  )
  return rows[0]
}

function count(n: number, singular: string, plural = singular + 's'): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * A phrase naming what still points at this account, or null when nothing does.
 *
 * Reads as the middle of a sentence: `${name} ${phrase} and can't be deleted.` Naming the
 * specific rows matters more than it looks — "this account has transactions posted against it"
 * sends an admin hunting through a customer's trades for an employee whose only trace is a
 * payroll posting they cannot see from the Accounts page at all.
 */
export async function describeAccountReferences(client: PoolClient, id: string): Promise<string | null> {
  const r = await accountReferences(client, id)
  const parts: string[] = []
  if (r.trades > 0) parts.push(count(r.trades, 'transaction'))
  if (r.settlements > 0) parts.push(count(r.settlements, 'transaction') + ' settled through it')
  if (r.cheques > 0) parts.push(count(r.cheques, 'cheque'))
  if (r.chequesDrawnOn > 0) parts.push(count(r.chequesDrawnOn, 'cheque') + ' drawn on it')
  if (r.journalEntries > 0) parts.push(count(r.journalEntries, 'journal entry', 'journal entries'))
  if (r.salaryPostings > 0) parts.push(count(r.salaryPostings, 'salary posting'))
  if (parts.length === 0 && r.openingBalances > 0) parts.push('an opening balance')
  if (parts.length === 0) return null
  const listed = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]
  return `has ${listed} against it`
}

/**
 * Whether anything at all references this account. The type lock in `updateAccount` reads this,
 * and `store.tsx` mirrors it client-side over the same seven paths so the screen and the server
 * agree about which accounts are in use.
 */
export async function accountHasActivity(client: PoolClient, id: string): Promise<boolean> {
  return (await describeAccountReferences(client, id)) !== null
}
