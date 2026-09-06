import type { PoolClient } from 'pg'
import { CORE_ACCOUNT_IDS, CURRENCIES, type AccountType } from '@currencydesk/engine'
import { appError } from './transact.js'
import { accountHasActivity, describeAccountReferences, getAccount } from './accountHelpers.js'

export interface AccountForm {
  type: AccountType
  name: string
  phone: string
  city: string
  notes: string
  bankName: string
  accountNo: string
  category: string
  designation: string
  monthlySalary: string
  code: string
  opening: string
  typeOverride: boolean
}

async function assertNameFree(client: PoolClient, name: string, excludeId?: string) {
  const { rows } = excludeId
    ? await client.query('SELECT 1 FROM accounts WHERE id <> $1 AND lower(name) = lower($2)', [excludeId, name])
    : await client.query('SELECT 1 FROM accounts WHERE lower(name) = lower($1)', [name])
  if (rows.length > 0) throw appError(409, `${name} already exists.`)
}

// A Currency Stock account is nothing but the Balance Sheet's view of ONE stock_positions row,
// matched to it by `code`. Two accounts carrying the same code therefore both value the same
// position, the sheet double-counts that stock as an asset, and the capital plug silently
// absorbs the difference so it still reports balanced=true. Free text here was survivable while
// AED was the only currency and only one such account existed; now that one account per traded
// currency is the normal shape, an admin adding a fourth and leaving the code at its default is
// a realistic way to book phantom assets. So: it must be a currency this desk actually trades,
// and it must not already be taken.
async function resolveCurrencyCode(client: PoolClient, raw: string, excludeId?: string): Promise<string> {
  const typed = raw.trim()
  if (!typed) throw appError(400, 'Choose which currency this stock account tracks.')
  const code = typed.toUpperCase()
  if (!CURRENCIES.includes(code)) {
    throw appError(400, `Unknown currency "${typed}" — this desk trades ${CURRENCIES.join(', ')}.`)
  }
  const { rows } = excludeId
    ? await client.query("SELECT 1 FROM accounts WHERE id <> $1 AND type = 'Currency Stock' AND upper(code) = $2", [excludeId, code])
    : await client.query("SELECT 1 FROM accounts WHERE type = 'Currency Stock' AND upper(code) = $1", [code])
  if (rows.length > 0) throw appError(409, `A ${code} stock account already exists — there is one per traded currency.`)
  return code
}

export async function createAccount(client: PoolClient, form: AccountForm, actorId: string | null): Promise<string> {
  const name = form.name.trim()
  if (!name) throw appError(400, 'Enter an account name.')
  await assertNameFree(client, name)

  const currencyCode = form.type === 'Currency Stock' ? await resolveCurrencyCode(client, form.code) : null

  const opening =
    form.type === 'Customer' || form.type === 'Payable' || form.type === 'Bank' || form.type === 'Cash' ? parseFloat(form.opening) || 0 : 0
  const receivable = form.type === 'Customer' && opening > 0 ? opening : 0
  const payable = form.type === 'Customer' && opening < 0 ? -opening : 0

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO accounts
       (type, name, notes, phone, city, bank_name, account_no, category, designation, monthly_salary, code,
        receivable, payable, opening_receivable, opening_payable, opening_posted, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
     RETURNING id`,
    [
      form.type,
      name,
      form.notes.trim(),
      form.type === 'Customer' || form.type === 'Employee' ? form.phone.trim() || '—' : null,
      form.type === 'Customer' || form.type === 'Employee' ? form.city.trim() || '—' : null,
      form.type === 'Bank' ? form.bankName.trim() : null,
      form.type === 'Bank' ? form.accountNo.trim() : null,
      form.type === 'Expense' ? form.category.trim() : null,
      form.type === 'Employee' ? form.designation.trim() || null : null,
      form.type === 'Employee' ? parseFloat(form.monthlySalary) || 0 : null,
      currencyCode,
      receivable,
      payable,
      receivable,
      payable,
      opening !== 0,
      actorId,
    ],
  )
  const newId = rows[0].id

  if (opening !== 0) {
    const capital = await getAccount(client, 'capital')
    const owedToUs = form.type === 'Payable' ? false : opening > 0
    const drId = owedToUs ? newId : 'capital'
    const crId = owedToUs ? 'capital' : newId
    const drLabel = owedToUs ? name : capital!.name
    const crLabel = owedToUs ? capital!.name : name
    await client.query(
      `INSERT INTO journal_entries (narration, opening_for, debit_account, credit_account, debit_label, credit_label, amount, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [`Opening balance — ${name}`, newId, drId, crId, drLabel, crLabel, Math.abs(opening), actorId],
    )
  }

  return newId
}

export async function updateAccount(client: PoolClient, id: string, form: AccountForm, actorId: string | null): Promise<void> {
  const name = form.name.trim()
  if (!name) throw appError(400, 'Enter an account name.')
  await assertNameFree(client, name, id)

  const prev = await getAccount(client, id)
  if (!prev) throw appError(404, 'That account no longer exists.')

  const typeChanged = prev.type !== form.type
  // Backstopped by the protect_core_accounts DB trigger (migration 009) regardless of this
  // check — this is here purely for a clean 4xx instead of a raw constraint-violation 500.
  if (typeChanged && CORE_ACCOUNT_IDS.includes(prev.id)) {
    throw appError(400, "This account's type can't be changed — other parts of the app depend on it by id.")
  }
  if (typeChanged && !form.typeOverride) {
    const hasActivity = await accountHasActivity(client, id)
    if (hasActivity) throw appError(400, 'Type is locked — this account has transaction history.')
  }
  if (typeChanged && prev.type === 'Customer' && ((prev.receivable || 0) !== 0 || (prev.payable || 0) !== 0)) {
    throw appError(400, `${prev.name} still carries an open receivable or payable. Settle the balance before changing the type.`)
  }

  // Matches the original frontend's own edit behavior exactly: every one of these fields is
  // always overwritten from the form regardless of the account's type (unlike account creation,
  // which is type-conditional) — not tidied up here to avoid changing existing behavior.
  const phone = form.phone.trim() || '—'
  const city = form.city.trim() || '—'
  const notes = form.notes.trim()
  const bankName = form.bankName.trim()
  const accountNo = form.accountNo.trim()
  const category = form.category.trim()
  const designation = form.designation.trim()
  const monthlySalary = parseFloat(form.monthlySalary) || 0
  const code = form.type === 'Currency Stock' ? await resolveCurrencyCode(client, form.code, id) : form.code.trim() || 'AED'

  if (typeChanged) {
    await client.query(
      `UPDATE accounts SET
         name=$1, type=$2, phone=$3, city=$4, notes=$5, bank_name=$6, account_no=$7,
         category=$8, designation=$9, monthly_salary=$10, code=$11,
         updated_at=now(), updated_by=$12,
         type_changed_from=$13, type_changed_by=$12, type_changed_at=now()
       WHERE id=$14`,
      [name, form.type, phone, city, notes, bankName, accountNo, category, designation, monthlySalary, code, actorId, prev.type, id],
    )
  } else {
    await client.query(
      `UPDATE accounts SET
         name=$1, type=$2, phone=$3, city=$4, notes=$5, bank_name=$6, account_no=$7,
         category=$8, designation=$9, monthly_salary=$10, code=$11,
         updated_at=now(), updated_by=$12
       WHERE id=$13`,
      [name, form.type, phone, city, notes, bankName, accountNo, category, designation, monthlySalary, code, actorId, id],
    )
  }

  // Cascades a rename into every place that carries this account's name as a display label —
  // idempotent to run even when the name didn't actually change.
  await client.query('UPDATE journal_entries SET debit_label = $1 WHERE debit_account = $2', [name, id])
  await client.query('UPDATE journal_entries SET credit_label = $1 WHERE credit_account = $2', [name, id])
  await client.query('UPDATE activity SET customer_name = $1 WHERE customer_id = $2', [name, id])
  await client.query('UPDATE cheques SET party = $1 WHERE customer_id = $2', [name, id])
}

// ---------------------------------------------------------------------------
// WHY `is_system` AND NOT `CORE_ACCOUNT_IDS` GOVERNS DELETION
// ---------------------------------------------------------------------------
//
// Two different sets answering two different questions, and conflating them is the bug this
// replaced.
//
//   CORE_ACCOUNT_IDS (7 ids)  "something resolves this by literal id" — salary posts against
//                             'salaryExpense'/'salaryPayable', opening balances against
//                             'capital', Cash settlement against 'cash' with 'bank' as the Bank
//                             fallback. That is what makes RETYPING them unsafe, which is what
//                             migration 009's trigger enforces. Deliberately unchanged.
//
//   is_system (13 accounts)   "this is the structural chart of accounts" — true for everything
//                             migrations 008/012/014 seed, false for everything the desk creates
//                             afterwards. This is the right predicate for DELETION.
//
// The gap between the two is the six Currency Stock accounts, and it turned dangerous when
// requirement 7 went live. Migration 012 left them out of CORE_ACCOUNT_IDS because "nothing
// resolves them by literal id" — still true, and no longer the whole story. `stockAccountIdFor`
// resolves them by `code`, so deleting one produces two silent faults rather than an error:
//
//   1. Every later trade in that currency posts NO voucher. buildVoucherLegs returns null on a
//      side with no account and the caller's policy is that the trade still succeeds — right for
//      a currency whose seed migration never ran, catastrophic for one an admin deleted, because
//      it quietly drops the auditable record requirement 7 exists to produce.
//   2. That currency's holding stops being an asset. computeBalanceSheet iterates Currency Stock
//      ACCOUNTS and values each from stock_positions, so the position stays in the ledger, stays
//      on the Stock page, and simply leaves the balance sheet.
//
// Neither shows up as an error, which is what makes the scaffold undeletable rather than merely
// discouraged.
// ---------------------------------------------------------------------------

export async function deleteAccount(client: PoolClient, id: string): Promise<void> {
  const acc = await getAccount(client, id)
  if (!acc) throw appError(400, "This account can't be deleted.")
  if (acc.is_system) throw appError(400, "This is a built-in account and can't be deleted — the desk's own books are kept on it.")
  const reference = await describeAccountReferences(client, id)
  if (reference) throw appError(400, `${acc.name} ${reference} and can't be deleted. Archive it instead — that hides it without losing the history.`)
  // receivable/payable are STORED columns, not derived from the journal, so this is not implied
  // by the reference check above. Through the app the two always move together — every path that
  // touches a balance also writes a row that describeAccountReferences would find — but the
  // 2026-09-03 fault was precisely these columns drifting out of step with the journal, and
  // deleting an account carrying money is not the place to assume they cannot drift again.
  if ((acc.receivable || 0) !== 0 || (acc.payable || 0) !== 0) {
    throw appError(400, `${acc.name} still carries a balance. Settle it first, or archive the account to hide it without losing the history.`)
  }
  await client.query('DELETE FROM accounts WHERE id = $1', [id])
}

export async function archiveAccount(client: PoolClient, id: string, actorId: string | null): Promise<void> {
  const acc = await getAccount(client, id)
  if (!acc) throw appError(400, "This account can't be archived.")
  if (acc.is_system) throw appError(400, "This is a built-in account and can't be archived — the desk's own books are kept on it.")
  await client.query('UPDATE accounts SET archived = true, archived_at = now(), archived_by = $2 WHERE id = $1', [id, actorId])
}

export async function unarchiveAccount(client: PoolClient, id: string): Promise<void> {
  await client.query('UPDATE accounts SET archived = false, archived_at = NULL, archived_by = NULL WHERE id = $1', [id])
}
