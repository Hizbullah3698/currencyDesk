import type {
  Account,
  Activity,
  Cheque,
  JournalEntry,
  Period,
  ReportPreset,
  RangeBounds,
  Stocks,
} from './types.js'
import { CURRENCY_LIST, pkrPerUnit, pkrValueOf } from './currencies.js'

export const CURRENCIES = CURRENCY_LIST.map((c) => c.code)

// Ids that other parts of the app resolve directly by id rather than by looking the account up
// fresh — accruing/paying salary posts against 'salaryExpense'/'salaryPayable', opening balances
// post against 'capital', and Cash settlement resolves to 'cash' with 'bank' as the Bank-method
// fallback. Deleting or retyping one of these would silently break that plumbing on the next
// salary run, opening balance, or cash settlement, so even Admin can't delete or retype them.
// This is a structural constraint, not a policy one — every other account (including the
// built-in Currency Stock ledger row, whose actual quantities live in Stocks, not this record)
// is fully editable/deletable/retypable for Admin.
export const CORE_ACCOUNT_IDS = ['bank', 'cash', 'margin', 'expense', 'salaryExpense', 'salaryPayable', 'capital']

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A short "since" label (e.g. "Aug 2026") for an account's creation month — used for both the
// built-in system accounts (stamped once, whenever the desk is first set up for real) and every
// account created afterward, so both read the account's actual creation date rather than a
// fabricated backstory.
export function sinceLabel(d: Date): string {
  return MONTHS[d.getMonth()] + ' ' + d.getFullYear()
}

function dayIndex(d: Date): number {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000)
}

export function isToday(iso?: string): boolean {
  return !!iso && dayIndex(new Date(iso)) === dayIndex(new Date())
}

export function stampTime(iso?: string): number {
  return (iso && new Date(iso).getTime()) || 0
}

/**
 * The date a transaction ECONOMICALLY happened, as an ISO string `stampTime` can read.
 *
 * `createdAt` is when the row was keyed into the system; `txnDate` is the date the dealer says
 * the deal was actually struck, which is what a customer statement, a balance sheet "as of",
 * and an income statement period all have to be cut on — a purchase entered this morning for a
 * deal done last Thursday belongs in last Thursday's numbers. `txnDate` is a bare 'YYYY-MM-DD'
 * from Postgres, so it is pinned to LOCAL noon: far enough from either midnight boundary that
 * no timezone offset can slide it into the neighbouring day, which a bare `new Date('...')`
 * (parsed as UTC) would do in any negative-offset zone.
 *
 * Ordering is a separate question and deliberately still keyed on `createdAt` — see
 * `openingStock`.
 */
export function activityDate(t: { txnDate?: string; createdAt: string }): string {
  return t.txnDate ? t.txnDate + 'T12:00:00' : t.createdAt
}

/**
 * The PKR cost/value of one unit of the currency this movement traded, from the rate as the
 * dealer typed it. Every weighted-average-cost calculation goes through here rather than
 * reading `t.rate` directly, because `t.rate` is in the currency's own quote convention (see
 * currencies.ts) and is NOT a PKR figure for a 'divide'-quoted currency like TMN.
 */
export function unitPkr(t: Activity): number {
  return pkrPerUnit(t.currency, t.rate || 0)
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  )
}

export function auditLine(rec?: { createdBy: string; createdAt: string; updatedBy: string; updatedAt: string }): string {
  if (!rec) return ''
  let s = 'Created by ' + (rec.createdBy || 'unknown') + ' on ' + fmtDateTime(rec.createdAt)
  if (rec.updatedAt && rec.updatedAt !== rec.createdAt) {
    s += ' · last edited by ' + (rec.updatedBy || 'unknown') + ' on ' + fmtDateTime(rec.updatedAt)
  }
  return s
}

// ---------------------------------------------------------------------------
// Report period
// ---------------------------------------------------------------------------

export function rangeBounds(preset: ReportPreset, from: string, to: string): RangeBounds {
  const now = new Date()
  const startOf = (d: Date) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x.getTime()
  }
  const endOf = (d: Date) => {
    const x = new Date(d)
    x.setHours(23, 59, 59, 999)
    return x.getTime()
  }
  if (preset === 'all') return { fromT: -Infinity, toT: Infinity, isAll: true, hasFrom: false, hasTo: false, label: 'All time' }
  if (preset === 'month') {
    const f = new Date(now.getFullYear(), now.getMonth(), 1)
    return { fromT: startOf(f), toT: endOf(now), isAll: false, hasFrom: true, hasTo: true, label: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
  }
  if (preset === 'lastMonth') {
    const f = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const t = new Date(now.getFullYear(), now.getMonth(), 0)
    return { fromT: startOf(f), toT: endOf(t), isAll: false, hasFrom: true, hasTo: true, label: f.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
  }
  if (preset === '7d') {
    const f = new Date(now)
    f.setDate(f.getDate() - 6)
    return { fromT: startOf(f), toT: endOf(now), isAll: false, hasFrom: true, hasTo: true, label: 'Last 7 days' }
  }
  if (preset === '10d') {
    const f = new Date(now)
    f.setDate(f.getDate() - 9)
    return { fromT: startOf(f), toT: endOf(now), isAll: false, hasFrom: true, hasTo: true, label: 'Last 10 days' }
  }
  if (preset === '30d') {
    const f = new Date(now)
    f.setDate(f.getDate() - 29)
    return { fromT: startOf(f), toT: endOf(now), isAll: false, hasFrom: true, hasTo: true, label: 'Last 30 days' }
  }
  if (preset === 'ytd') {
    const f = new Date(now.getFullYear(), 0, 1)
    return { fromT: startOf(f), toT: endOf(now), isAll: false, hasFrom: true, hasTo: true, label: now.getFullYear() + ' to date' }
  }
  const fromD = from ? new Date(from + 'T00:00:00') : null
  const toD = to ? new Date(to + 'T00:00:00') : null
  const fromT = fromD && !isNaN(fromD.getTime()) ? startOf(fromD) : -Infinity
  const toT = toD && !isNaN(toD.getTime()) ? endOf(toD) : Infinity
  const fmtD = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const label =
    fromT === -Infinity && toT === Infinity
      ? 'All time'
      : fromT === -Infinity
        ? 'Up to ' + fmtD(toD as Date)
        : toT === Infinity
          ? 'From ' + fmtD(fromD as Date)
          : fmtD(fromD as Date) + ' – ' + fmtD(toD as Date)
  return { fromT, toT, isAll: fromT === -Infinity && toT === Infinity, hasFrom: fromT !== -Infinity, hasTo: toT !== Infinity, label }
}

// ---------------------------------------------------------------------------
// Customer receivable/payable effects (used for as-of / verification replay)
// ---------------------------------------------------------------------------

export function custEffects(customerId: string, activity: Activity[], cheques: Cheque[], keep: (iso: string) => boolean) {
  const owed = (t: Activity) => (t.pkrValue || 0) - (t.chequeHeld ? 0 : t.paidNow || 0)
  const act = activity.filter((t) => t.customerId === customerId && keep(activityDate(t)))
  const chq = cheques.filter((q) => q.customerId === customerId && q.status === 'Cleared' && keep(q.updatedAt || q.createdAt))
  return {
    receivable:
      act.filter((t) => t.type === 'sale').reduce((a, t) => a + owed(t), 0) -
      act.filter((t) => t.type === 'receive' && !t.chequeHeld).reduce((a, t) => a + (t.amount || 0), 0) -
      chq.filter((q) => q.direction === 'Inward').reduce((a, q) => a + q.amount, 0),
    payable:
      act.filter((t) => t.type === 'purchase').reduce((a, t) => a + owed(t), 0) -
      act.filter((t) => t.type === 'pay' && !t.chequeHeld).reduce((a, t) => a + (t.amount || 0), 0) -
      chq.filter((q) => q.direction === 'Outward').reduce((a, q) => a + q.amount, 0),
  }
}

// A purchase/sale's own `outstanding` field is a one-time snapshot from when it was posted —
// later Receive/Make Payment actions adjust the customer's aggregate receivable/payable but
// never go back and clear it (there's no per-invoice settlement matching in this app). Once the
// customer's balance on that side reaches zero, showing that old snapshot as still "Open" is
// simply wrong, so re-derive the badge from the current balance instead of the frozen field.
export function txnIsOpen(t: Activity, accounts: Account[]): boolean {
  if (!t.outstanding) return false
  if (t.type !== 'sale' && t.type !== 'purchase') return true
  const cust = accounts.find((a) => a.id === t.customerId)
  const balance = cust ? (t.type === 'sale' ? cust.receivable : cust.payable) || 0 : t.outstanding
  return balance > 0
}

/**
 * An account's opening balance as at a date — zero before the account existed.
 *
 * `openingReceivable`/`openingPayable` carry no date of their own, so every replay applied them at
 * EVERY date, including dates before the account was created. `createAccount` journals the same
 * figure against Capital as a dated entry, so a balance sheet cut before that date showed the
 * customer's opening balance while the journal correctly showed nothing — measured as a PKR 10,000
 * disagreement at 2026-08-31 for an account created 2026-09-01, and the only remaining
 * disagreement in `npm run reconcile` once unrelated test data was removed.
 *
 * Dated on the ACCOUNT's `createdAt` rather than by looking up its opening journal entry, so this
 * stays a pure function of the account and needs no journal argument: `createAccount` writes both
 * in one transaction, so the two dates are the same by construction (verified on real data — the
 * account and its JV-012 both carry 2026-09-01). The journal is what this has to agree WITH, so
 * deriving the date from it would be circular.
 */
export function openingBalanceAsOf(cust: Account, toT: number) {
  if (stampTime(cust.createdAt) > toT) return { receivable: 0, payable: 0 }
  return { receivable: cust.openingReceivable || 0, payable: cust.openingPayable || 0 }
}

export interface CustBalance {
  receivable: number
  payable: number
}

// ---------------------------------------------------------------------------
// The allocation rule — the one order-dependent step in a customer's history
// ---------------------------------------------------------------------------
//
// A customer carries TWO columns at once, `receivable` and `payable`, not one signed figure. A
// bare `Dr customer X` says only which way the net moves, not which column should change, so
// postJournal settles whatever is outstanding in the OPPOSITE direction first and lets the
// remainder cross over.
//
// These two mirror `applyDebitToCustomer`/`applyCreditToCustomer` in backend journalService.ts
// statement for statement — the SQL evaluates every SET against the pre-update row, which is what
// reading both fields off the same `bal` reproduces. They are the reason a customer's history
// cannot be replayed as a sum: the outcome of each one depends on the running pair at that moment,
// so the events have to be walked in order.
//
// Neither column can go negative under them, so no guard is needed — the reduction is capped at
// what is there and the remainder moves across.

export function allocateDebit(bal: CustBalance, amount: number): CustBalance {
  return {
    receivable: bal.receivable + Math.max(amount - bal.payable, 0),
    payable: Math.max(bal.payable - amount, 0),
  }
}

export function allocateCredit(bal: CustBalance, amount: number): CustBalance {
  return {
    payable: bal.payable + Math.max(amount - bal.receivable, 0),
    receivable: Math.max(bal.receivable - amount, 0),
  }
}

/**
 * The manual journal entries that move one customer's balance, in the order the server applied
 * them.
 *
 * EXCLUDES VOUCHER LEGS. A trade writes an activity row AND voucher legs against the same
 * customer; counting both doubles every deal. This is the same `isVoucherLeg` exclusion the
 * reports already apply, for the same reason.
 *
 * EXCLUDES THE ACCOUNT'S OWN OPENING ENTRY. `createAccount` journals the opening balance against
 * Capital, and `openingBalanceAsOf` already seeds that figure from the account's own columns —
 * replaying the entry as well would count it twice. The entry is identified by `openingFor`, the
 * same column the backfill uses as its idempotency key.
 *
 * INCLUDED by the entry's own date (`activityDate`, which journal entries satisfy structurally and
 * which pins a bare 'YYYY-MM-DD' to local noon), but ORDERED by `createdAt` — the order the server
 * actually applied them in, which is the order the stored columns were built up in. That is the
 * same document-date/posting-date split `openingStock` already runs on, and it matters here
 * precisely because the allocation above is order-dependent.
 */
export function customerJournalEntries(customerId: string, journalEntries: JournalEntry[], keep: (iso: string) => boolean): JournalEntry[] {
  return journalEntries
    .filter((e) => !isVoucherLeg(e) && e.openingFor !== customerId)
    .filter((e) => e.debitAccount === customerId || e.creditAccount === customerId)
    .filter((e) => keep(activityDate(e)))
    .slice()
    .sort((a, b) => stampTime(a.createdAt) - stampTime(b.createdAt))
}

/**
 * A customer's receivable/payable as at a date, replayed from the opening balance forward.
 *
 * Activity and cheques move the columns by plain addition — each already knows its own direction,
 * and the server's own settlement updates are guarded so they never drive a column negative.
 * Journal entries go through the allocation rule above, which is why this walks the history in
 * order instead of summing it the way `custEffects` does.
 */
export function customerBalanceAsOf(
  cust: Account,
  activity: Activity[],
  cheques: Cheque[],
  journalEntries: JournalEntry[],
  toT: number,
): CustBalance {
  const keep = (iso: string) => stampTime(iso) <= toT
  const owed = (t: Activity) => (t.pkrValue || 0) - (t.chequeHeld ? 0 : t.paidNow || 0)

  interface Step {
    order: number
    apply: (b: CustBalance) => CustBalance
  }
  const steps: Step[] = []

  for (const t of activity) {
    if (t.customerId !== cust.id || !keep(activityDate(t))) continue
    const order = stampTime(t.createdAt)
    if (t.type === 'sale') steps.push({ order, apply: (b) => ({ ...b, receivable: b.receivable + owed(t) }) })
    else if (t.type === 'purchase') steps.push({ order, apply: (b) => ({ ...b, payable: b.payable + owed(t) }) })
    else if (t.type === 'receive' && !t.chequeHeld) steps.push({ order, apply: (b) => ({ ...b, receivable: b.receivable - (t.amount || 0) }) })
    else if (t.type === 'pay' && !t.chequeHeld) steps.push({ order, apply: (b) => ({ ...b, payable: b.payable - (t.amount || 0) }) })
  }

  // A cleared cheque goes through the SAME allocation as a journal entry, because the server does:
  // a cheque can be for more than the customer owes, and since 2026-09-19 the excess crosses over
  // as a credit rather than driving the column negative (chequeService.ts). Plain subtraction here
  // would make the replay disagree with the books the moment one over-covers a debt.
  for (const q of cheques) {
    if (q.customerId !== cust.id || q.status !== 'Cleared') continue
    const when = q.updatedAt || q.createdAt
    if (!keep(when)) continue
    const order = stampTime(when)
    if (q.direction === 'Inward') steps.push({ order, apply: (b) => allocateCredit(b, q.amount) })
    else steps.push({ order, apply: (b) => allocateDebit(b, q.amount) })
  }

  for (const e of customerJournalEntries(cust.id, journalEntries, keep)) {
    const order = stampTime(e.createdAt)
    if (e.debitAccount === cust.id) steps.push({ order, apply: (b) => allocateDebit(b, e.amount) })
    if (e.creditAccount === cust.id) steps.push({ order, apply: (b) => allocateCredit(b, e.amount) })
  }

  steps.sort((a, b) => a.order - b.order)
  return steps.reduce<CustBalance>((b, s) => s.apply(b), openingBalanceAsOf(cust, toT))
}

// ---------------------------------------------------------------------------
// Currency stock (weighted-average cost)
// ---------------------------------------------------------------------------

export function stk(stocks: Stocks, code: string) {
  const s = stocks[code]
  return { available: s?.available || 0, avgCost: s?.avgCost || 0 }
}

export function currencyCodes(stocks: Stocks): string[] {
  const keys = Object.keys(stocks)
  return CURRENCIES.filter((c) => keys.indexOf(c) >= 0).concat(keys.filter((c) => CURRENCIES.indexOf(c) < 0))
}

export function activeCurrencies(stocks: Stocks, activity: Activity[]): string[] {
  return currencyCodes(stocks).filter(
    (c) => stk(stocks, c).available > 0 || activity.some((t) => (t.type === 'purchase' || t.type === 'sale') && (t.currency || 'AED') === c),
  )
}

// Movements are ordered by `createdAt` (the order they were POSTED), not by `txnDate` (the
// date the deal was struck) — deliberately. The stored weighted-average cost in
// `stock_positions` was built up by the server one posting at a time in exactly that order, and
// `openingStock` works by unwinding that same stored figure backwards. Replaying in a different
// order than it was built in would not reconstruct the number it started from. Backdating
// therefore moves a trade between REPORTING PERIODS (see `activityDate`) without rewriting the
// cost history, which is the same document-date/posting-date split any real ledger runs.
export function openingStock(code: string, stocks: Stocks, activity: Activity[]) {
  const moves = activity
    .filter((t) => (t.type === 'purchase' || t.type === 'sale') && (t.currency || 'AED') === code)
    .slice()
    .sort((a, b) => stampTime(a.createdAt) - stampTime(b.createdAt))
  let qty = stk(stocks, code).available
  let avg = stk(stocks, code).avgCost
  for (let i = moves.length - 1; i >= 0; i--) {
    const t = moves[i]
    if (t.type === 'purchase') {
      const prev = qty - (t.amount || 0)
      avg = prev > 0 ? (qty * avg - (t.amount || 0) * unitPkr(t)) / prev : avg
      qty = prev
    } else {
      qty = qty + (t.amount || 0)
    }
  }
  return { qty, avg, moves }
}

export function stockAsOf(code: string, stocks: Stocks, activity: Activity[], toT: number) {
  const open = openingStock(code, stocks, activity)
  let qty = open.qty
  let avg = open.avg
  open.moves.forEach((t) => {
    if (stampTime(activityDate(t)) > toT) return
    const amt = t.amount || 0
    if (t.type === 'purchase') {
      const nq = qty + amt
      avg = nq > 0 ? (qty * avg + amt * unitPkr(t)) / nq : avg
      qty = nq
    } else {
      qty = qty - amt
    }
  })
  return { available: qty, avgCost: avg }
}

// ---------------------------------------------------------------------------
// Buy / Sell math
// ---------------------------------------------------------------------------

// `rate` is in the traded currency's own quote convention (see currencies.ts); `code` is what
// tells these two how to read it. It is the LAST parameter and defaults to 'AED' — a
// 'multiply'-quoted currency — so every pre-existing 3-and-4-argument call site keeps its exact
// previous behaviour (`pkrValue = amount * rate`) rather than silently changing meaning.
//
// `avgCost` in sellCalc is the opposite: it is always canonical PKR-per-unit, never a quote
// rate, because it is a derived weighted average rather than something a dealer typed. That is
// why `cost` multiplies unconditionally while `saleValue` goes through the conversion.
//
// COST BASIS IS DESK-WIDE WEIGHTED-AVERAGE, NOT FIFO. `avgCost` is whatever `stock_positions`
// holds for the currency at the moment of sale — one blended PKR-per-unit figure across every
// purchase ever made of that currency, re-weighted in place on each new purchase (see
// `tradesService.purchase`), not a queue of discrete lots consumed oldest-first. A sale that
// spans stock bought at several different rates is costed at the single blended average, never
// split across the original purchase rates. This is deliberate and load-bearing far beyond this
// function — `stockAsOf`/`openingStock` above replay this same weighted average for historical
// valuation, the balance sheet prices currency stock with it, and `npm run reconcile` checks
// against it — so switching to FIFO is a cost-basis change for the whole desk, not something a
// caller of `sellCalc` can opt into locally. THIS IS THE SINGLE SOURCE OF TRUTH for realized
// sale margin: both the Sale screen's live badge (`Trade.tsx`) and the persisted
// `activity.cost`/`activity.margin` columns (`tradesService.sale`) call this exact function with
// this exact `avgCost`, so they can never disagree.
export function buyCalc(amount: number, rate: number, method: string, paidNowRaw: number, code = 'AED') {
  const pkrValue = pkrValueOf(code, amount, rate)
  const paidNow = method === 'Credit' ? 0 : Math.min(paidNowRaw || 0, pkrValue)
  const outstanding = Math.max(pkrValue - paidNow, 0)
  return { amount, rate, pkrValue, paidNow, outstanding }
}

export function sellCalc(amount: number, rate: number, avgCost: number, method: string, paidNowRaw: number, code = 'AED') {
  const saleValue = pkrValueOf(code, amount, rate)
  const cost = amount * avgCost
  const margin = saleValue - cost
  const paidNow = method === 'Credit' ? 0 : Math.min(paidNowRaw || 0, saleValue)
  const outstanding = Math.max(saleValue - paidNow, 0)
  return { amount, rate, saleValue, cost, margin, paidNow, outstanding }
}

// ---------------------------------------------------------------------------
// Margin ledger — single source read by both Income Statement and Balance Sheet
// ---------------------------------------------------------------------------

export interface MarginCurrencyRow {
  code: string
  margin: number
  revenue: number
  cost: number
  qty: number
  count: number
  rows: Activity[]
}

export interface MarginAdjRow {
  label: string
  sub: string
  amount: number
}

/**
 * True for a journal row that is one leg of a trade's voucher, rather than an entry in its own
 * right (a manual posting, an opening balance, a salary accrual).
 *
 * WHY EVERY READER HAS TO ASK. Requirement 7 phase 3 was scoped on the premise that "nothing reads
 * vouchers yet". That premise was wrong, and the reconciliation harness caught it on the first
 * trade posted through the new code: `ledgerBalance()` and `marginLedger()` have always read
 * `journal_entries` indiscriminately, because until now every row in that table was a standalone
 * entry. So the moment a trade also posted a voucher, its cash leg was counted twice — once from
 * the activity row's settlement leg and once from the new journal row — and its margin twice over
 * as well. Measured on a real purchase: cash reported PKR 60,000 against an actual 30,000.
 *
 * This predicate is what keeps vouchers genuinely inert until phase 5 retires the reconstructions
 * that double-count them. It exists once, here, rather than as four copies of `e.voucherId != null`
 * scattered across the readers — the same rule that put the currency-stock account lookup in one
 * place.
 *
 * PHASE 5 REMOVES THE CALLERS, NOT THIS FUNCTION. When the reports switch to reading the journal as
 * the source of truth, they stop excluding voucher legs and start excluding the activity and stored
 * columns instead.
 */
export function isVoucherLeg(entry: JournalEntry): boolean {
  return entry.voucherId != null
}

export function marginLedger(accounts: Account[], activity: Activity[], journalEntries: JournalEntry[], stocks: Stocks, keep: (iso: string) => boolean) {
  const sales = activity.filter((t) => t.type === 'sale' && keep(activityDate(t)))
  const byCurrency: MarginCurrencyRow[] = currencyCodes(stocks).map((code) => {
    const rows = sales.filter((t) => (t.currency || 'AED') === code)
    return {
      code,
      margin: rows.reduce((a, t) => a + (t.margin || 0), 0),
      revenue: rows.reduce((a, t) => a + (t.pkrValue || 0), 0),
      cost: rows.reduce((a, t) => a + (t.cost || 0), 0),
      qty: rows.reduce((a, t) => a + (t.amount || 0), 0),
      count: rows.length,
      rows,
    }
  })
  const salesMargin = byCurrency.reduce((a, c) => a + c.margin, 0)
  const incomeIds = accounts.filter((a) => a.type === 'Income').map((a) => a.id)
  const adjRows: MarginAdjRow[] = []
  let journalAdj = 0
  journalEntries.filter((e) => keep(e.createdAt) && !isVoucherLeg(e)).forEach((e) => {
    const dr = incomeIds.indexOf(e.debitAccount) >= 0
    const cr = incomeIds.indexOf(e.creditAccount) >= 0
    if (!dr && !cr) return
    const v = (cr ? e.amount : 0) - (dr ? e.amount : 0)
    journalAdj += v
    adjRows.push({ label: e.ref + ' · ' + (e.narration || 'Journal entry'), sub: 'Dr ' + e.debitLabel + ' · Cr ' + e.creditLabel, amount: v })
  })
  return { salesMargin, journalAdj, total: salesMargin + journalAdj, adjRows, byCurrency, sales }
}

// ---------------------------------------------------------------------------
// Period close — Sale/Purchase only, see types.ts's Period doc comment
// ---------------------------------------------------------------------------

/** The period id ('YYYY-MM') a bare 'YYYY-MM-DD' `txnDate` falls in. Plain string slicing, not a
 *  parsed Date — `txnDate` is already the literal day with no time-of-day to shift. */
export function periodIdFor(txnDate: string): string {
  return txnDate.slice(0, 7)
}

/** False once an admin has reopened the period — the row is kept for its close history rather
 *  than deleted, so "closed" is "has never been reopened", not merely "has a row at all". */
export function isClosedPeriod(p: Period): boolean {
  return !p.reopenedAt
}

/** The closed period a `txnDate` falls inside, or undefined if that month is open (never closed,
 *  or closed then reopened). Used to block a new Sale/Purchase from backdating into it. */
export function closedPeriodFor(txnDate: string, periods: Period[]): Period | undefined {
  const id = periodIdFor(txnDate)
  return periods.find((p) => p.id === id && isClosedPeriod(p))
}

/** 'YYYY-MM' -> 'September 2026'. Constructed from the parsed year/month directly (never a bare
 *  `new Date('YYYY-MM')`, which some engines resolve as UTC) — only month+year are read back, so
 *  there is no day-of-month for a timezone offset to shift. */
export function periodLabel(id: string): string {
  const [y, m] = id.split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Cheques
// ---------------------------------------------------------------------------

/**
 * Is this cheque still waiting on an outcome?
 *
 * Pending and Deposited are the two live states; Cleared, Returned and Cancelled are all final —
 * the cheque's story is over and it stops counting towards anything outstanding.
 */
export function chequeIsOpen(q: Cheque): boolean {
  return q.status === 'Pending' || q.status === 'Deposited'
}

/**
 * Is this cheque past its due date and still unresolved?
 *
 * Only an OPEN cheque can be overdue — a cleared, returned or cancelled one has had its outcome,
 * and flagging it later because a date passed would be noise about a closed record.
 *
 * `due` is a plain 'YYYY-MM-DD' from Postgres (the DATE parser is overridden to hand back the
 * literal text — see db/pool.ts), and `today` is expected in the same form. ISO dates compare
 * correctly as strings, so this is a calendar comparison with no Date object and no timezone
 * involved — the same reasoning routes/txnDate.ts uses for "not in the future".
 *
 * Strictly AFTER the due date: a cheque due today is not yet late.
 */
export function chequeIsOverdue(q: Cheque, today: string): boolean {
  return chequeIsOpen(q) && !!q.due && q.due < today
}

export function chequeNoError(cheques: Cheque[], method: string, chqNo: string): string {
  if (method !== 'Cheque') return ''
  const num = (chqNo || '').trim()
  if (!num) return ''
  if (cheques.some((q) => q.number.toLowerCase() === num.toLowerCase())) {
    return 'Cheque number ' + num + ' already exists — cheque numbers must be unique.'
  }
  return ''
}

export function nextChequeNumber(cheques: Cheque[], seed: number): number {
  let n = seed
  const taken = new Set(cheques.map((q) => q.number))
  while (taken.has(String(n))) n++
  return n
}
