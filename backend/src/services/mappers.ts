import type { Account, Activity, Cheque, JournalEntry, Stocks } from '@currencydesk/engine'
import { sinceLabel } from '@currencydesk/engine'
import { resolveActor, type UserNameMap } from './userLookup.js'

// Row shapes as they come back from `pg` (snake_case columns, numeric/date already normalized
// to plain numbers/strings by the type parsers registered in db/pool.ts). Mapping functions
// below translate these into the exact JSON shape the frontend's `@currencydesk/engine` types
// already define — optional fields are `null` when absent rather than an omitted key, which is
// behaviorally identical for every existing `(x.field || fallback)` read pattern in the app.

export interface AccountRow {
  id: string
  type: Account['type']
  name: string
  is_system: boolean
  notes: string
  created_at: Date
  created_by: string | null
  updated_at: Date
  updated_by: string | null
  receivable: number
  payable: number
  opening_receivable: number
  opening_payable: number
  opening_posted: boolean
  phone: string | null
  city: string | null
  bank_name: string | null
  account_no: string | null
  code: string | null
  category: string | null
  designation: string | null
  monthly_salary: number | null
  type_changed_from: string | null
  type_changed_by: string | null
  type_changed_at: Date | null
  archived: boolean
  archived_at: Date | null
  archived_by: string | null
}

export function mapAccountRow(row: AccountRow, names: UserNameMap): Account {
  const acct: Account = {
    id: row.id,
    type: row.type,
    name: row.name,
    notes: row.notes,
    since: sinceLabel(new Date(row.created_at)),
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: resolveActor(row.created_by, names),
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: resolveActor(row.updated_by, names),
  }
  if (row.is_system) acct.system = true
  if (row.type === 'Customer') {
    acct.receivable = row.receivable
    acct.payable = row.payable
    acct.openingReceivable = row.opening_receivable
    acct.openingPayable = row.opening_payable
    acct.openingPosted = row.opening_posted
  }
  if (row.type === 'Customer' || row.type === 'Employee') {
    acct.phone = row.phone ?? '—'
    acct.city = row.city ?? '—'
  }
  if (row.type === 'Bank') {
    acct.bankName = row.bank_name ?? ''
    acct.accountNo = row.account_no ?? ''
  }
  if (row.type === 'Currency Stock') acct.code = row.code ?? 'AED'
  if (row.type === 'Expense') acct.category = row.category ?? ''
  if (row.type === 'Employee') {
    if (row.designation != null) acct.designation = row.designation
    acct.monthlySalary = row.monthly_salary ?? 0
  }
  if (row.type_changed_from) {
    acct.typeChangedFrom = row.type_changed_from as Account['type']
    acct.typeChangedBy = resolveActor(row.type_changed_by, names)
    acct.typeChangedAt = new Date(row.type_changed_at!).toISOString()
  }
  if (row.archived) {
    acct.archived = true
    acct.archivedAt = new Date(row.archived_at!).toISOString()
    acct.archivedBy = resolveActor(row.archived_by, names)
  }
  return acct
}

export interface ActivityRow {
  id: string
  type: Activity['type']
  currency: string | null
  customer_id: string | null
  customer_name: string
  amount: number
  rate: number | null
  pkr_value: number
  cost: number | null
  margin: number | null
  method: Activity['method']
  paid_now: number | null
  outstanding: number | null
  cheque_held: boolean
  cheque_id: string | null
  settlement_account_id: string | null
  /** A Postgres `date`, delivered as the literal 'YYYY-MM-DD' text by the DATE type parser
   *  registered in db/pool.ts — the same mechanism `cheques.due_date` already relies on. No
   *  Date object is ever constructed from it, so no timezone shift can occur here. */
  txn_date: string
  created_at: Date
  created_by: string | null
  updated_at: Date
  updated_by: string | null
}

/**
 * `includeMargin: false` omits the per-deal cost basis and realised margin entirely (the keys are
 * absent, not zeroed — a zero would read as "this sale made nothing", which is a different and
 * wrong claim). Both fields are already optional on the engine's `Activity` type, so every
 * existing `(t.margin || 0)` read degrades correctly. See stateService.ts's `viewForRole`.
 */
export function mapActivityRow(row: ActivityRow, names: UserNameMap, includeMargin: boolean): Activity {
  return {
    id: row.id,
    type: row.type,
    currency: row.currency ?? undefined,
    customerId: row.customer_id,
    customerName: row.customer_name,
    amount: row.amount,
    rate: row.rate ?? undefined,
    pkrValue: row.pkr_value,
    cost: includeMargin ? row.cost ?? undefined : undefined,
    margin: includeMargin ? row.margin ?? undefined : undefined,
    method: row.method,
    paidNow: row.paid_now ?? undefined,
    outstanding: row.outstanding ?? undefined,
    chequeHeld: row.cheque_held,
    chequeId: row.cheque_id ?? undefined,
    settlementAccountId: row.settlement_account_id ?? undefined,
    txnDate: row.txn_date,
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: resolveActor(row.created_by, names),
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: resolveActor(row.updated_by, names),
  }
}

export interface ChequeRow {
  id: string
  direction: Cheque['direction']
  number: string
  party: string
  customer_id: string | null
  bank: string
  bank_account_id: string
  amount: number
  due_date: string
  status: Cheque['status']
  ledger_applied: boolean
  history: string[]
  source: string | null
  created_at: Date
  created_by: string | null
  updated_at: Date
  updated_by: string | null
}

export function mapChequeRow(row: ChequeRow, names: UserNameMap): Cheque {
  return {
    id: row.id,
    direction: row.direction,
    number: row.number,
    party: row.party,
    customerId: row.customer_id,
    bank: row.bank,
    bankAccountId: row.bank_account_id,
    amount: row.amount,
    due: row.due_date,
    status: row.status,
    ledgerApplied: row.ledger_applied,
    history: row.history,
    source: row.source ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: resolveActor(row.created_by, names),
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: resolveActor(row.updated_by, names),
  }
}

export interface JournalRow {
  id: string
  ref: string
  narration: string
  debit_account: string
  credit_account: string
  debit_label: string
  credit_label: string
  amount: number
  opening_for: string | null
  salary_employee_id: string | null
  salary_period: string | null
  salary_kind: 'accrual' | 'payment' | null
  voucher_id: string | null
  activity_id: string | null
  created_at: Date
  created_by: string | null
  updated_at: Date
  updated_by: string | null
}

/**
 * `includeMargin: false` OMITS any entry with a leg against an Income account — the whole row,
 * not a zeroed or blanked amount, for the same reason mapActivityRow omits rather than zeroes:
 * a zero is a claim, and the claim it makes ("this made nothing") is false.
 *
 * WHY THIS EXISTS BEFORE ANYTHING WRITES AN INCOME LEG. Requirement 7 makes a sale credit the
 * `margin` account for its realised profit. Journal entries were, until this change, served to
 * every role unfiltered — mapJournalRow took no view argument at all — while getSnapshot has
 * stripped cost and margin from activity rows for non-admins since 2026-08-31. So the first
 * commit that posted a margin leg would have handed every Operator the exact figure the API
 * already declines to give them, reopening a hole that was found and closed once before. The
 * filter is therefore landed first, deliberately, while it still guards nothing: the ordering is
 * the point, not the code.
 *
 * `incomeAccountIds` is passed in rather than looked up here because getSnapshot has already read
 * the accounts table by the time it maps journal rows, and a second query per row would be absurd.
 *
 * Note what this changes today, before any voucher exists: an Operator's Transactions page
 * (`/transactions` is NOT admin-gated, and it lists journal entries) stops showing manual entries
 * posted against Income. That is the intended consequence — such an entry discloses income just as
 * plainly as a margin leg would — but it is a visible change, not a silent no-op.
 *
 * Returns null for an omitted row; getSnapshot drops the nulls.
 */
export function mapJournalRow(
  row: JournalRow,
  names: UserNameMap,
  includeMargin: boolean,
  incomeAccountIds: ReadonlySet<string>,
): JournalEntry | null {
  if (!includeMargin && (incomeAccountIds.has(row.debit_account) || incomeAccountIds.has(row.credit_account))) {
    return null
  }
  const entry: JournalEntry = {
    id: row.id,
    ref: row.ref,
    narration: row.narration,
    debitAccount: row.debit_account,
    creditAccount: row.credit_account,
    debitLabel: row.debit_label,
    creditLabel: row.credit_label,
    amount: row.amount,
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: resolveActor(row.created_by, names),
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: resolveActor(row.updated_by, names),
  }
  if (row.opening_for) entry.openingFor = row.opening_for
  if (row.salary_employee_id && row.salary_kind) {
    entry.salary = { employeeId: row.salary_employee_id, period: row.salary_period ?? '', kind: row.salary_kind }
  }
  if (row.voucher_id) entry.voucherId = row.voucher_id
  if (row.activity_id) entry.activityId = row.activity_id
  return entry
}

export interface StockRow {
  code: string
  available: number
  avg_cost: number
}

export function mapStocks(rows: StockRow[]): Stocks {
  const stocks: Stocks = {}
  for (const row of rows) stocks[row.code] = { available: row.available, avgCost: row.avg_cost }
  return stocks
}
