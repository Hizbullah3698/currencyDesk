import type { Account, Activity, Cheque } from './types.js'
import { activityDate, stampTime } from './engine.js'

// ---------------------------------------------------------------------------
// Customer ledger / statement
// ---------------------------------------------------------------------------
//
// A chronological statement for ONE customer, with a running balance.
//
// The rules here are not new. They are the same ones custEffects() already applies to compute a
// customer's balance — deliberately so: a statement whose closing figure disagreed with the
// balance shown everywhere else in the app would be worse than no statement. The difference is
// that custEffects returns only a total, and a statement has to show how it was arrived at, one
// row at a time.
//
// WHY CLEARED CHEQUES ARE ROWS, even though the client asked for "one row per transaction":
// a cheque only moves a customer's balance when it CLEARS, which can be days after the trade it
// settles. Leaving those events out would produce a statement whose running balance silently
// stopped reconciling to the real one — the reader would see a closing figure that did not match
// the customer's actual position and have no way to account for the gap. They are included, typed
// distinctly, and carry no currency or rate because they have none.

export type LedgerRowType = 'purchase' | 'sale' | 'receive' | 'pay' | 'cheque'

export interface LedgerRow {
  id: string
  /** 'YYYY-MM-DD' — the deal date for a trade, the clearing date for a cheque. */
  date: string
  /** Sort key. Kept separate from `date` because two rows can share a date. */
  at: number
  type: LedgerRowType
  description: string
  /** Trades only. Settlements and cheques move rupees and have no foreign currency. */
  currency?: string
  /** Units of `currency`, for a trade. */
  amount?: number
  /** In the currency's own quote convention, exactly as stored — see the note on rates below. */
  rate?: number
  /** The rupee value of this row. */
  pkrValue: number

  receivableDelta: number
  payableDelta: number

  /** Balance after this row. */
  runningReceivable: number
  runningPayable: number
  /** receivable − payable. Positive: the customer owes the desk. Negative: the desk owes them. */
  runningNet: number

  /**
   * Running net units of THIS row's currency, after this row. Undefined on rows with no currency.
   *
   * This is what keeps a multi-currency statement honest. A single running number covering AED and
   * USD together would be the "silently converted currency" bug wearing a different hat — the two
   * are not commensurable and adding them produces a figure that means nothing.
   */
  runningCurrencyUnits?: number
}

export interface CurrencyPosition {
  code: string
  /** Purchases minus sales: net units the desk took IN from this customer over the period. */
  units: number
  /** Rupee value of those trades, kept per currency rather than pooled. */
  pkr: number
  trades: number
}

export interface CustomerLedger {
  rows: LedgerRow[]
  opening: { receivable: number; payable: number; net: number }
  closing: { receivable: number; payable: number; net: number }
  /** One entry per currency actually traded in the period, so nothing is collapsed. */
  currencies: CurrencyPosition[]
}

/**
 * How much of a trade is still owed after whatever was settled at the counter.
 *
 * Copied in spirit from custEffects, including the cheque rule: an amount settled BY CHEQUE does
 * not reduce the balance yet, because the cheque has not cleared. That is why `chequeHeld` zeroes
 * the paid figure rather than subtracting it.
 */
function owedOn(t: Activity): number {
  return (t.pkrValue || 0) - (t.chequeHeld ? 0 : t.paidNow || 0)
}

/**
 * The calendar day a row falls on, as a plain 'YYYY-MM-DD'.
 *
 * Needed because the two sources are shaped differently: activityDate() pins a bare date to LOCAL
 * noon and hands back something like '2026-02-01T12:00:00', while a cheque carries a full UTC
 * timestamp. Left unnormalised, the raw value reaches the CSV export verbatim — a statement column
 * reading "2026-02-01T12:00:00" instead of a date, which is exactly the kind of thing that looks
 * fine on screen (where it is formatted) and wrong in the file the client actually opens.
 *
 * Converted through the LOCAL calendar rather than by slicing the string, so a cheque cleared at
 * 22:00 UTC lands on the desk's day, not the previous one.
 */
function isoDay(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface LedgerRange {
  /** Inclusive lower bound as a timestamp. Omit for "from the beginning". */
  fromT?: number
  /** Inclusive upper bound as a timestamp. Omit for "up to now". */
  toT?: number
}

/**
 * Builds the statement.
 *
 * Takes explicit BOUNDS rather than the `keep(iso) => boolean` predicate used elsewhere in this
 * module, and the difference is not cosmetic. A statement needs three buckets, not two: rows
 * before the period fold into the opening balance, rows inside it are listed, and rows *after* it
 * are ignored entirely. A predicate only answers "in or out", so everything excluded looks alike —
 * which silently pulled future transactions into the balance brought forward, making a
 * mid-history statement open at the wrong figure. Bounds make the three cases distinguishable.
 */
export function customerLedger(cust: Account, activity: Activity[], cheques: Cheque[], range: LedgerRange = {}): CustomerLedger {
  const fromT = range.fromT ?? -Infinity
  const toT = range.toT ?? Infinity
  const inPeriod = (iso: string) => {
    const t = stampTime(iso)
    return t >= fromT && t <= toT
  }
  const beforePeriod = (iso: string) => stampTime(iso) < fromT

  const chequeDate = (q: Cheque) => q.updatedAt || q.createdAt

  const mine = activity.filter((t) => t.customerId === cust.id)
  const myCheques = cheques.filter((q) => q.customerId === cust.id && q.status === 'Cleared')

  // --- opening balance: strictly what happened BEFORE the period, plus the account's own opening
  // figures. Anything after the period end is not brought forward — it has not happened yet as far
  // as this statement is concerned.
  const before = <T>(items: T[], dateOf: (x: T) => string) => items.filter((x) => beforePeriod(dateOf(x)))
  let openingReceivable = cust.openingReceivable || 0
  let openingPayable = cust.openingPayable || 0
  for (const t of before(mine, activityDate)) {
    if (t.type === 'sale') openingReceivable += owedOn(t)
    if (t.type === 'purchase') openingPayable += owedOn(t)
    if (t.type === 'receive' && !t.chequeHeld) openingReceivable -= t.amount || 0
    if (t.type === 'pay' && !t.chequeHeld) openingPayable -= t.amount || 0
  }
  for (const q of before(myCheques, chequeDate)) {
    if (q.direction === 'Inward') openingReceivable -= q.amount
    else openingPayable -= q.amount
  }

  // --- rows in the period ---
  interface Pending {
    at: number
    date: string
    build: (r: { receivable: number; payable: number; units: Record<string, number> }) => LedgerRow
  }
  const pending: Pending[] = []

  for (const t of mine) {
    const date = activityDate(t)
    if (!inPeriod(date)) continue
    pending.push({
      at: stampTime(date),
      date,
      build: (run) => {
        let receivableDelta = 0
        let payableDelta = 0
        if (t.type === 'sale') receivableDelta = owedOn(t)
        else if (t.type === 'purchase') payableDelta = owedOn(t)
        else if (t.type === 'receive' && !t.chequeHeld) receivableDelta = -(t.amount || 0)
        else if (t.type === 'pay' && !t.chequeHeld) payableDelta = -(t.amount || 0)

        run.receivable += receivableDelta
        run.payable += payableDelta

        const isTrade = t.type === 'purchase' || t.type === 'sale'
        const code = isTrade ? t.currency || 'AED' : undefined
        if (code) {
          // Purchases add to what the desk took in from this customer, sales give it back.
          run.units[code] = (run.units[code] || 0) + (t.type === 'purchase' ? t.amount || 0 : -(t.amount || 0))
        }

        return {
          id: t.id,
          date: isoDay(date),
          at: stampTime(date),
          type: t.type,
          description: describeActivity(t),
          currency: code,
          amount: isTrade ? t.amount : undefined,
          rate: isTrade ? t.rate : undefined,
          pkrValue: t.type === 'receive' || t.type === 'pay' ? t.amount || 0 : t.pkrValue || 0,
          receivableDelta,
          payableDelta,
          runningReceivable: run.receivable,
          runningPayable: run.payable,
          runningNet: run.receivable - run.payable,
          runningCurrencyUnits: code ? run.units[code] : undefined,
        }
      },
    })
  }

  for (const q of myCheques) {
    const date = chequeDate(q)
    if (!inPeriod(date)) continue
    pending.push({
      at: stampTime(date),
      date,
      build: (run) => {
        const receivableDelta = q.direction === 'Inward' ? -q.amount : 0
        const payableDelta = q.direction === 'Outward' ? -q.amount : 0
        run.receivable += receivableDelta
        run.payable += payableDelta
        return {
          id: q.id,
          date: isoDay(date),
          at: stampTime(date),
          type: 'cheque',
          description: `Cheque ${q.number} cleared (${q.direction.toLowerCase()})`,
          pkrValue: q.amount,
          receivableDelta,
          payableDelta,
          runningReceivable: run.receivable,
          runningPayable: run.payable,
          runningNet: run.receivable - run.payable,
        }
      },
    })
  }

  // Oldest first — a statement reads forward, and a running balance is meaningless in any other
  // order. (The customer detail screen lists newest-first, which is right for "what happened
  // lately" and wrong for this.)
  pending.sort((a, b) => a.at - b.at || a.date.localeCompare(b.date))

  const run = { receivable: openingReceivable, payable: openingPayable, units: {} as Record<string, number> }
  const rows = pending.map((p) => p.build(run))

  const currencies: CurrencyPosition[] = []
  for (const row of rows) {
    if (!row.currency) continue
    let pos = currencies.find((c) => c.code === row.currency)
    if (!pos) {
      pos = { code: row.currency, units: 0, pkr: 0, trades: 0 }
      currencies.push(pos)
    }
    pos.units += row.type === 'purchase' ? row.amount || 0 : -(row.amount || 0)
    pos.pkr += row.type === 'purchase' ? row.pkrValue : -row.pkrValue
    pos.trades += 1
  }
  currencies.sort((a, b) => a.code.localeCompare(b.code))

  return {
    rows,
    opening: { receivable: openingReceivable, payable: openingPayable, net: openingReceivable - openingPayable },
    closing: { receivable: run.receivable, payable: run.payable, net: run.receivable - run.payable },
    currencies,
  }
}

function describeActivity(t: Activity): string {
  switch (t.type) {
    case 'purchase':
      return 'Currency purchased from customer'
    case 'sale':
      return 'Currency sold to customer'
    case 'receive':
      return `Payment received${t.method ? ` (${t.method})` : ''}`
    case 'pay':
      return `Payment made${t.method ? ` (${t.method})` : ''}`
    default:
      return t.type
  }
}
