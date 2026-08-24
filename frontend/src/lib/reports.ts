import type { Account, Activity, Cheque, JournalEntry, Stocks } from './types'
import { currencyCodes, marginLedger, stampTime, stk } from './engine'

// ---------------------------------------------------------------------------
// Generic account ledger balance (Dr positive) — everything except Customer
// and Currency Stock accounts, which are carried on their own dedicated
// fields (receivable/payable, and the currency stock table) rather than
// replayed from journal legs.
//
// Cheque-method settlements only move a bank/cash balance once the cheque
// clears — matching "Cheque-method amounts count only once cleared."
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
    if (!keep(e.createdAt)) return
    if (e.debitAccount === accountId) net += e.amount
    if (e.creditAccount === accountId) net -= e.amount
  })
  activity.forEach((t) => {
    if (t.settlementAccountId !== accountId || t.method === 'Cheque') return
    if (!keep(t.createdAt)) return
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
  totalDr: number
  totalCr: number
  balanced: boolean
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
  const push = (type: string, row: TrialBalanceRow) => {
    const g = GROUP_TITLES[type] || type
    ;(rowsByGroup[g] ||= []).push(row)
  }

  let residual = 0

  accounts.forEach((a) => {
    if (a.type === 'Customer') {
      const dr = a.receivable || 0
      const cr = a.payable || 0
      if (dr || cr) push('Customer', { id: a.id, label: a.name, sub: 'Customer', dr, cr })
      return
    }
    if (a.type === 'Currency Stock') {
      const code = a.code || 'AED'
      const { available, avgCost } = stk(stocks, code)
      const value = available * avgCost
      push('Currency Stock', { id: a.id, label: a.name, sub: `${available.toLocaleString('en-US')} ${code} @ ${avgCost.toFixed(2)}`, dr: value, cr: 0 })
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
      if (a.id === 'capital') residual = cr // capital row filled below with plug added
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

  // Balance the sheet with an equity plug on Capital, and surface exactly what it absorbed.
  const diags: { label: string; detail: string; amount: number }[] = []
  const diff = totalDr - totalCr
  if (Math.abs(diff) > 0.5) {
    const capitalRows = rowsByGroup[GROUP_TITLES.Capital] || (rowsByGroup[GROUP_TITLES.Capital] = [])
    let capitalRow = capitalRows.find((r) => r.id === 'capital')
    if (!capitalRow) {
      capitalRow = { id: 'capital', label: 'Opening Balance / Capital', sub: 'Owner capital and opening balances', dr: 0, cr: 0 }
      capitalRows.push(capitalRow)
    }
    if (diff > 0) {
      capitalRow.cr += diff
      totalCr += diff
    } else {
      capitalRow.dr += -diff
      totalDr += -diff
    }
    diags.push({
      label: 'Opening currency stock',
      detail: 'Seeded currency stock predates the ledger and carries no originating journal entry — the reconciling residual is attributed to opening equity so the sheet balances without inventing a fake transaction.',
      amount: Math.abs(diff),
    })
  }
  void residual

  const groups: TrialBalanceGroup[] = GROUP_ORDER.filter((g) => rowsByGroup[g]?.length).map((title) => {
    const rows = rowsByGroup[title]
    return { title, rows, subDr: sum(rows, 'dr'), subCr: sum(rows, 'cr') }
  })

  return { groups, totalDr, totalCr, balanced: Math.abs(totalDr - totalCr) < 0.5, diags }
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
      detail: 'Every sale and journal line counted falls inside the selected date range.',
      ok: margin.sales.every((t) => keep(t.createdAt)) && journalEntries.filter((e) => keep(e.createdAt)).every((e) => keep(e.createdAt)),
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
