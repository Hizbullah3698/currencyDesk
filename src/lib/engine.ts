import type {
  Account,
  Activity,
  Cheque,
  JournalEntry,
  ReportPreset,
  RangeBounds,
  Stocks,
} from './types'

export const CURRENCIES = ['AED']

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

export function daysAgoIso(days: number, hour = 12): string {
  const d = new Date()
  d.setDate(d.getDate() - (days || 0))
  d.setHours(hour, days ? 5 : 0, 0, 0)
  return d.toISOString()
}

function dayIndex(d: Date): number {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000)
}

export function relLabel(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const diff = dayIndex(new Date()) - dayIndex(d)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) return diff + ' days ago'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function isToday(iso?: string): boolean {
  return !!iso && dayIndex(new Date(iso)) === dayIndex(new Date())
}

export function stampTime(iso?: string): number {
  return (iso && new Date(iso).getTime()) || 0
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
  const act = activity.filter((t) => t.customerId === customerId && keep(t.createdAt))
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

export function customerBalanceAsOf(cust: Account, activity: Activity[], cheques: Cheque[], toT: number) {
  const opening = { receivable: cust.openingReceivable || 0, payable: cust.openingPayable || 0 }
  const effects = custEffects(cust.id, activity, cheques, (iso) => stampTime(iso) <= toT)
  return { receivable: opening.receivable + effects.receivable, payable: opening.payable + effects.payable }
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
      avg = prev > 0 ? (qty * avg - (t.amount || 0) * (t.rate || 0)) / prev : avg
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
    if (stampTime(t.createdAt) > toT) return
    const amt = t.amount || 0
    if (t.type === 'purchase') {
      const nq = qty + amt
      avg = nq > 0 ? (qty * avg + amt * (t.rate || 0)) / nq : avg
      qty = nq
    } else {
      qty = qty - amt
    }
  })
  return { available: qty, avgCost: avg }
}

export interface TrendBar {
  heightPct: number
  label: string
  color: string
  labelColor: string
}

/** Running stock quantity after each of the last N movements, for a small sparkline. */
export function stockTrend(code: string, stocks: Stocks, activity: Activity[], count = 6): TrendBar[] {
  const open = openingStock(code, stocks, activity)
  const moves = open.moves.slice(-count)
  let qty = open.qty
  const points: { qty: number; date: Date; kind: string }[] = []
  open.moves.slice(0, open.moves.length - moves.length).forEach((t) => {
    qty = t.type === 'purchase' ? qty + (t.amount || 0) : qty - (t.amount || 0)
  })
  moves.forEach((t) => {
    qty = t.type === 'purchase' ? qty + (t.amount || 0) : qty - (t.amount || 0)
    points.push({ qty, date: new Date(t.createdAt), kind: t.type })
  })
  while (points.length < count) points.unshift({ qty: points[0]?.qty ?? qty, date: new Date(), kind: '' })
  const max = Math.max(...points.map((p) => p.qty), 1)
  return points.map((p, i) => ({
    heightPct: Math.max(10, Math.round((p.qty / max) * 100)),
    label: p.kind ? p.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
    color: i === points.length - 1 ? 'var(--color-accent)' : 'var(--color-accent-border)',
    labelColor: 'var(--color-muted-60)',
  }))
}

// ---------------------------------------------------------------------------
// Buy / Sell math
// ---------------------------------------------------------------------------

export function buyCalc(amount: number, rate: number, method: string, paidNowRaw: number) {
  const pkrValue = amount * rate
  const paidNow = method === 'Credit' ? 0 : Math.min(paidNowRaw || 0, pkrValue)
  const outstanding = Math.max(pkrValue - paidNow, 0)
  return { amount, rate, pkrValue, paidNow, outstanding }
}

export function sellCalc(amount: number, rate: number, avgCost: number, method: string, paidNowRaw: number) {
  const saleValue = amount * rate
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

export function marginLedger(accounts: Account[], activity: Activity[], journalEntries: JournalEntry[], stocks: Stocks, keep: (iso: string) => boolean) {
  const sales = activity.filter((t) => t.type === 'sale' && keep(t.createdAt))
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
  journalEntries.filter((e) => keep(e.createdAt)).forEach((e) => {
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
// Cheques
// ---------------------------------------------------------------------------

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
