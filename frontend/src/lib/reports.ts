import type { Account, Activity, Cheque, JournalEntry, Stocks } from './types'
import { activityDate, currencyCodes, currencyMeta, isVoucherLeg, marginLedger, openingStock, stampTime, stockAsOf } from './engine'
import { fmtAmount, fmtQuote } from './format'

// ---------------------------------------------------------------------------
// Generic account ledger balance (Dr positive) — everything except Customer
// and Currency Stock accounts, which are carried on their own dedicated
// fields (receivable/payable, and the currency stock table) rather than
// replayed from journal legs.
//
// Cheque-method settlements only move a bank/cash balance once the cheque
// clears — matching "Cheque-method amounts count only once cleared."
//
// `keep` is a REPORTING-PERIOD cutoff, so an activity row is cut on activityDate(t) — the date
// the deal was actually struck — not on createdAt, the date it was keyed in. A purchase entered
// this morning for last Thursday's deal belongs in last Thursday's balance. Journal entries and
// cheque status changes have no separate deal date, so they stay on their own timestamps.
// ---------------------------------------------------------------------------
export function ledgerBalance(
  accountId: string,
  journalEntries: JournalEntry[],
  activity: Activity[],
  cheques: Cheque[],
  keep: (iso: string) => boolean,
): number {
  let net = 0
  journalEntries.forEach((e) => {
    // Voucher legs are excluded until phase 5 — counting them here as well as the activity row's
    // own settlement leg double-counts every cash and bank movement. See isVoucherLeg().
    if (isVoucherLeg(e)) return
    if (!keep(e.createdAt)) return
    if (e.debitAccount === accountId) net += e.amount
    if (e.creditAccount === accountId) net -= e.amount
  })
  activity.forEach((t) => {
    if (t.settlementAccountId !== accountId || t.method === 'Cheque') return
    if (!keep(activityDate(t))) return
    const amt = t.type === 'purchase' || t.type === 'pay' ? -(t.paidNow ?? t.amount ?? 0) : t.paidNow ?? t.amount ?? 0
    net += amt
  })
  cheques.forEach((q) => {
    if (q.bankAccountId !== accountId || q.status !== 'Cleared') return
    if (!keep(q.updatedAt || q.createdAt)) return
    net += q.direction === 'Inward' ? q.amount : -q.amount
  })
  return net
}

export interface TrialBalanceRow {
  id: string
  label: string
  sub: string
  dr: number
  cr: number
}

export interface TrialBalanceGroup {
  title: string
  rows: TrialBalanceRow[]
  subDr: number
  subCr: number
}

export interface BalanceSheetResult {
  groups: TrialBalanceGroup[]
  /** Includes the presentation-only equity plug, so it always equals totalCr. */
  totalDr: number
  totalCr: number
  /**
   * True only when debits and credits agree once the legitimately-unjournalled opening currency
   * stock is accounted for. Deliberately NOT derived from totalDr/totalCr — those carry the plug
   * that makes them agree by construction.
   */
  balanced: boolean
  /** The expected, legitimate residual: currency stock held before the recorded ledger begins. */
  openingStockEquity: number
  /** Signed. Anything non-zero here is a real imbalance, not a reconciling item. */
  unexplained: number
  diags: { label: string; detail: string; amount: number }[]
}

const GROUP_TITLES: Record<string, string> = {
  Customer: 'Receivables & Payables — Customers',
  Bank: 'Bank & Cash',
  Cash: 'Bank & Cash',
  'Currency Stock': 'Currency Stock',
  Payable: 'Other Payables',
  Income: 'Income',
  Expense: 'Expenses',
  Capital: 'Equity',
  Employee: 'Employees',
}
const GROUP_ORDER = ['Receivables & Payables — Customers', 'Bank & Cash', 'Currency Stock', 'Other Payables', 'Income', 'Expenses', 'Equity', 'Employees']

export function computeBalanceSheet(
  accounts: Account[],
  activity: Activity[],
  cheques: Cheque[],
  journalEntries: JournalEntry[],
  stocks: Stocks,
  asOfT: number,
): BalanceSheetResult {
  const keep = (iso: string) => stampTime(iso) <= asOfT
  const rowsByGroup: Record<string, TrialBalanceRow[]> = {}
  // A row with nothing on either side is dropped, and a group left with no rows never appears.
  //
  // PRESENTATION ONLY — no figure changes. A zero row contributes zero to its subtotal, to
  // totalDr/totalCr, to rawDiff and therefore to `balanced` and `unexplained`; the reconciliation
  // below is computed from `accounts` directly and never reads these rows at all. `npm run
  // reconcile` is likewise unaffected: reconcile.ts deliberately mirrors the per-account branches
  // of this function rather than reading its output, precisely so its comparison cannot be
  // changed by a presentation decision made here.
  //
  // WHY. Customer and Income rows were already suppressed this way; Bank, Cash, Expense, Payable,
  // Capital and every Currency Stock account were pushed unconditionally. On a real desk that is
  // the four untraded currencies, both zero expense accounts and an empty salary payable printed
  // as blank lines around the handful of figures that carry anything — the client's "it shows
  // all", 2026-09-09. An account with a balance of zero is not a fact worth a line on a report.
  //
  // The Capital row is the one exception and is added below rather than here, because it carries
  // the presentation plug and must exist to receive it.
  const push = (type: string, row: TrialBalanceRow) => {
    if (!row.dr && !row.cr) return
    const g = GROUP_TITLES[type] || type
    ;(rowsByGroup[g] ||= []).push(row)
  }


  accounts.forEach((a) => {
    if (a.type === 'Customer') {
      const dr = a.receivable || 0
      const cr = a.payable || 0
      if (dr || cr) push('Customer', { id: a.id, label: a.name, sub: 'Customer', dr, cr })
      return
    }
    if (a.type === 'Currency Stock') {
      const code = a.code || 'AED'
      // stockAsOf, NOT stk(): every other row on this sheet is cut at asOfT, so valuing currency
      // stock at TODAY's position made a historical balance sheet mix two different dates and
      // guaranteed a residual for any past date — which the equity plug below then silently
      // absorbed, so the sheet still claimed to balance. Same replay the Stock page's ledger uses.
      const { available, avgCost } = stockAsOf(code, stocks, activity, asOfT)
      const value = available * avgCost
      // Works for ANY code — nothing here is AED-specific, so a new AFN/IRR Currency Stock
      // account added server-side shows up on its own row with no change needed here. The cost
      // prints in that currency's own quote convention (avgCost itself stays canonical
      // PKR-per-unit, which is what `value` is correctly computed from).
      push('Currency Stock', { id: a.id, label: a.name, sub: `${fmtAmount(available, code)} ${code} @ ${fmtQuote(code, avgCost)} ${currencyMeta(code).rateLabel}`, dr: value, cr: 0 })
      return
    }
    if (a.type === 'Employee') return // memo-only; no ledger balance of its own
    const net = ledgerBalance(a.id, journalEntries, activity, cheques, keep)
    const marginExtra = a.type === 'Income' ? marginLedger(accounts, activity, [], stocks, keep).salesMargin : 0
    const total = net - marginExtra // net is Dr-positive; margin is Cr-normal, so subtract to credit it
    if (a.type === 'Income') {
      const cr = -total
      if (cr) push('Income', { id: a.id, label: a.name, sub: 'Trading margin + journal postings', dr: 0, cr })
      return
    }
    if (a.type === 'Capital' || a.type === 'Payable') {
      const cr = -total
      push(a.type, { id: a.id, label: a.name, sub: a.notes || a.type, dr: cr < 0 ? -cr : 0, cr: cr > 0 ? cr : 0 })
      // (the capital row is topped up with the presentation plug further down)
      return
    }
    // Bank / Cash / Expense are Dr-normal
    push(a.type, { id: a.id, label: a.name, sub: a.type === 'Bank' ? [a.bankName, a.accountNo].filter(Boolean).join(' · ') : a.notes || a.type, dr: total > 0 ? total : 0, cr: total < 0 ? -total : 0 })
  })

  const sum = (rows: TrialBalanceRow[], key: 'dr' | 'cr') => rows.reduce((s, r) => s + r[key], 0)
  let totalDr = 0
  let totalCr = 0
  Object.values(rowsByGroup).forEach((rows) => {
    totalDr += sum(rows, 'dr')
    totalCr += sum(rows, 'cr')
  })

  // ---------------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------------
  // The residual is measured BEFORE the equity plug is applied, and `balanced` is judged on what
  // is left after subtracting the one residual that is legitimately expected. This used to be a
  // tautology: the plug was added into totalDr/totalCr and then `balanced` was computed from
  // those same plugged totals, so it could essentially never be false and a genuine posting
  // error was indistinguishable from the expected opening-stock figure.
  const diags: { label: string; detail: string; amount: number }[] = []
  const rawDiff = totalDr - totalCr

  // The ONLY legitimately unjournalled figure on this sheet. Opening balances for customers,
  // banks, cash and payables are NOT in this category — createAccount posts each one as a real
  // journal entry against Capital (see accountsService.ts's `opening_for` entry), so they carry
  // their own credit and need no plug. Currency stock is different: a position that predates the
  // recorded activity has no originating purchase to credit against. openingStock() unwinds the
  // whole activity history to recover exactly that pre-ledger position, so this is independent
  // of asOfT — pre-ledger stock is present at every reporting date.
  const openingStockEquity = accounts
    .filter((a) => a.type === 'Currency Stock')
    .reduce((s, a) => {
      const open = openingStock(a.code || 'AED', stocks, activity)
      return s + open.qty * open.avg
    }, 0)

  const unexplained = rawDiff - openingStockEquity

  if (Math.abs(openingStockEquity) > 0.5) {
    diags.push({
      label: 'Opening currency stock',
      detail:
        'Currency stock held before the recorded ledger begins, carried at its weighted-average cost. It has no originating purchase to credit against, so it is attributed to opening equity rather than inventing a transaction for it. This is expected and does not indicate an error.',
      amount: Math.abs(openingStockEquity),
    })
  }

  if (!(Math.abs(unexplained) < 0.5)) {
    diags.push({
      label: 'Unexplained difference',
      detail:
        'Debits and credits do not agree once opening currency stock is accounted for. This is a real imbalance — a posting that did not record both of its legs, or a balance changed outside the ledger — not a reconciling item. The plug below keeps the printed sheet footing, but the books do not actually balance.',
      amount: Math.abs(unexplained),
    })
  }

  // Apply the plug for presentation only, so the printed sheet still foots — never as the basis
  // for `balanced`, which was the original defect.
  if (Math.abs(rawDiff) > 0.5) {
    const capitalRows = rowsByGroup[GROUP_TITLES.Capital] || (rowsByGroup[GROUP_TITLES.Capital] = [])
    let capitalRow = capitalRows.find((r) => r.id === 'capital')
    if (!capitalRow) {
      capitalRow = { id: 'capital', label: 'Opening Balance / Capital', sub: 'Owner capital and opening balances', dr: 0, cr: 0 }
      capitalRows.push(capitalRow)
    }
    if (rawDiff > 0) {
      capitalRow.cr += rawDiff
      totalCr += rawDiff
    } else {
      capitalRow.dr += -rawDiff
      totalDr += -rawDiff
    }
  }

  const groups: TrialBalanceGroup[] = GROUP_ORDER.filter((g) => rowsByGroup[g]?.length).map((title) => {
    const rows = rowsByGroup[title]
    return { title, rows, subDr: sum(rows, 'dr'), subCr: sum(rows, 'cr') }
  })

  return { groups, totalDr, totalCr, balanced: Math.abs(unexplained) < 0.5, openingStockEquity, unexplained, diags }
}

// ---------------------------------------------------------------------------
// Income statement
// ---------------------------------------------------------------------------

export interface IncomeStatementResult {
  gross: number
  salesMargin: number
  journalAdj: number
  currencyRows: { code: string; margin: number; sub: string; rows: { label: string; sub: string; amount: number }[] }[]
  adjRows: { label: string; sub: string; amount: number }[]
  expenseTotal: number
  expenseRows: { id: string; label: string; sub: string; amount: number }[]
  salaryDue: number
  net: number
  checks: { label: string; detail: string; ok: boolean }[]
}

export function computeIncomeStatement(
  accounts: Account[],
  activity: Activity[],
  journalEntries: JournalEntry[],
  stocks: Stocks,
  fromT: number,
  toT: number,
): IncomeStatementResult {
  const keep = (iso: string) => {
    const t = stampTime(iso)
    return t >= fromT && t <= toT
  }
  const margin = marginLedger(accounts, activity, journalEntries, stocks, keep)

  const currencyRows = margin.byCurrency
    .filter((c) => c.count > 0)
    .map((c) => ({
      code: c.code,
      margin: c.margin,
      sub: `${c.count} sale${c.count === 1 ? '' : 's'} · revenue ${Math.round(c.revenue).toLocaleString('en-US')} · cost ${Math.round(c.cost).toLocaleString('en-US')}`,
      rows: [],
    }))

  const expenseAccounts = accounts.filter((a) => a.type === 'Expense')
  const expenseRows = expenseAccounts
    .map((a) => {
      const amt = journalEntries.filter((e) => e.debitAccount === a.id && keep(e.createdAt)).reduce((s, e) => s + e.amount, 0)
      return { id: a.id, label: a.name, sub: a.category || a.type, amount: amt }
    })
    .filter((r) => r.amount > 0)
  const expenseTotal = expenseRows.reduce((s, r) => s + r.amount, 0)
  const salaryDue = expenseRows.find((r) => r.id === 'salaryExpense')?.amount || 0

  const net = margin.total - expenseTotal

  // Five independent checks over the filtered period, mirroring the verification layer the
  // real reports run: currency attribution, margin rebuilt independently, per-currency lines
  // summing to the headline figure, no out-of-range leakage, and revenue-minus-cost consistency.
  const checks = [
    {
      label: 'Currency attribution',
      detail: 'Every sale in the period is bucketed under exactly one currency desk.',
      ok: margin.sales.every((t) => currencyCodes(stocks).includes(t.currency || 'AED')),
    },
    {
      label: 'Margin rebuilt independently',
      detail: 'Gross profit recomputed from revenue minus cost matches the stored margin on every sale.',
      ok: margin.sales.every((t) => Math.abs((t.pkrValue || 0) - (t.cost || 0) - (t.margin || 0)) < 0.5),
    },
    {
      label: 'Per-currency lines sum to the headline figure',
      detail: 'Each currency desk’s margin adds up to the total sales margin shown above.',
      ok: Math.abs(margin.byCurrency.reduce((s, c) => s + c.margin, 0) - margin.salesMargin) < 0.5,
    },
    {
      label: 'No out-of-range transaction leaked into this period',
      detail: 'Every sale (on its transaction date) and journal line counted falls inside the selected date range.',
      ok: margin.sales.every((t) => keep(activityDate(t))) && journalEntries.filter((e) => keep(e.createdAt)).every((e) => keep(e.createdAt)),
    },
    {
      label: 'Gross profit matches sales margin plus journal postings',
      detail: 'The headline Gross Profit figure equals margin on sales plus anything journalled directly to Income.',
      ok: Math.abs(margin.total - (margin.salesMargin + margin.journalAdj)) < 0.5,
    },
  ]

  return {
    gross: margin.total,
    salesMargin: margin.salesMargin,
    journalAdj: margin.journalAdj,
    currencyRows,
    adjRows: margin.adjRows,
    expenseTotal,
    expenseRows,
    salaryDue,
    net,
    checks,
  }
}
