import type { Account, Activity, Cheque, JournalEntry } from './types.js'
import { activityDate, allocateCredit, allocateDebit, customerJournalEntries, stampTime } from './engine.js'

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

export type LedgerRowType = 'purchase' | 'sale' | 'receive' | 'pay' | 'cheque' | 'journal'

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

/**
 * Where a record sits on the statement: the calendar day it belongs to, then the moment it was
 * really keyed in.
 *
 * The day alone is not enough, and neither is the timestamp the row is dated by. A trade's date is
 * the day the deal was struck, pinned to local NOON so no timezone slides it a day — which means
 * every deal on one day carries the identical instant. The snapshot lists activity newest-first,
 * and the sort below is stable, so a tie kept the snapshot's order: dates ran oldest-first while
 * the deals inside a day ran NEWEST-first, and each row's running balance followed that reversed
 * order. A balance that crosses from Dr to Cr partway through a day printed the wrong side on the
 * wrong rows.
 *
 * The second key is the record's real creation time — the same order `customerBalanceAsOf` and the
 * server built the stored balance in ("replays include by document date, order by createdAt").
 * Never the id: a UUID carries no order at all. A cleared cheque has no separate entry time, so its
 * clearing moment stands in — it is when it moved the balance. Ties beyond that keep the order
 * given, which is why the sort must stay stable.
 */
interface StatementOrder {
  day: string
  created: number
}
function statementOrder(dateIso: string, createdIso: string): StatementOrder {
  return { day: isoDay(dateIso), created: stampTime(createdIso) }
}
const byStatementOrder = (a: StatementOrder, b: StatementOrder) => a.day.localeCompare(b.day) || a.created - b.created

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
export function customerLedger(
  cust: Account,
  activity: Activity[],
  cheques: Cheque[],
  journalEntries: JournalEntry[],
  range: LedgerRange = {},
): CustomerLedger {
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
  // Manual entries and customer-to-customer transfers move this balance too, and until now the
  // statement could not see them — it took activity and cheques only, so a transfer moved both
  // customers' balances while appearing on neither one's statement, and the closing figure was
  // short by exactly that amount. `customerJournalEntries` excludes voucher legs (a trade's
  // activity row already carries it) and the account's own opening entry (seeded below instead,
  // so replaying it here would count it twice).
  const myEntries = customerJournalEntries(cust.id, journalEntries, () => true)

  // --- opening balance: strictly what happened BEFORE the period, plus the account's own opening
  // figures. Anything after the period end is not brought forward — it has not happened yet as far
  // as this statement is concerned.
  //
  // ONE CHRONOLOGICAL FOLD, not three independent sums. Activity and cheques each know their own
  // direction so they could be added in any order, but a journal entry's effect depends on the
  // running pair at that moment (see allocateDebit/allocateCredit) — so the moment manual entries
  // joined the statement, "sum each kind separately" stopped being able to express the answer.
  let opening = { receivable: cust.openingReceivable || 0, payable: cust.openingPayable || 0 }
  const priorSteps: ({ at: number; apply: (b: typeof opening) => typeof opening } & StatementOrder)[] = []
  for (const t of mine) {
    if (!beforePeriod(activityDate(t))) continue
    const at = stampTime(activityDate(t))
    const k = statementOrder(activityDate(t), t.createdAt)
    if (t.type === 'sale') priorSteps.push({ at, ...k, apply: (b) => ({ ...b, receivable: b.receivable + owedOn(t) }) })
    else if (t.type === 'purchase') priorSteps.push({ at, ...k, apply: (b) => ({ ...b, payable: b.payable + owedOn(t) }) })
    else if (t.type === 'receive' && !t.chequeHeld) priorSteps.push({ at, ...k, apply: (b) => ({ ...b, receivable: b.receivable - (t.amount || 0) }) })
    else if (t.type === 'pay' && !t.chequeHeld) priorSteps.push({ at, ...k, apply: (b) => ({ ...b, payable: b.payable - (t.amount || 0) }) })
  }
  // Allocated, not subtracted — see customerBalanceAsOf. A cheque for more than the customer owes
  // settles the debt and leaves the remainder as a credit, which is what the server now stores.
  for (const q of myCheques) {
    if (!beforePeriod(chequeDate(q))) continue
    const at = stampTime(chequeDate(q))
    const k = statementOrder(chequeDate(q), chequeDate(q))
    if (q.direction === 'Inward') priorSteps.push({ at, ...k, apply: (b) => allocateCredit(b, q.amount) })
    else priorSteps.push({ at, ...k, apply: (b) => allocateDebit(b, q.amount) })
  }
  for (const e of myEntries) {
    if (!beforePeriod(activityDate(e))) continue
    const at = stampTime(activityDate(e))
    const k = statementOrder(activityDate(e), e.createdAt)
    if (e.debitAccount === cust.id) priorSteps.push({ at, ...k, apply: (b) => allocateDebit(b, e.amount) })
    if (e.creditAccount === cust.id) priorSteps.push({ at, ...k, apply: (b) => allocateCredit(b, e.amount) })
  }
  priorSteps.sort((a, b) => byStatementOrder(a, b) || a.at - b.at)
  for (const step of priorSteps) opening = step.apply(opening)
  const openingReceivable = opening.receivable
  const openingPayable = opening.payable

  // --- rows in the period ---
  interface Pending extends StatementOrder {
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
      ...statementOrder(date, t.createdAt),
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
      ...statementOrder(date, date),
      build: (run) => {
        // Deltas derived by difference from the allocation, exactly as the journal row does: on a
        // cheque that over-covers the debt both columns move and neither delta equals the cheque's
        // own figure, so a flat ±amount would contradict the running balance printed beside it.
        const before = { receivable: run.receivable, payable: run.payable }
        const after = q.direction === 'Inward' ? allocateCredit(before, q.amount) : allocateDebit(before, q.amount)
        run.receivable = after.receivable
        run.payable = after.payable
        const receivableDelta = after.receivable - before.receivable
        const payableDelta = after.payable - before.payable
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

  for (const e of myEntries) {
    const date = activityDate(e)
    if (!inPeriod(date)) continue
    pending.push({
      at: stampTime(date),
      date,
      ...statementOrder(date, e.createdAt),
      build: (run) => {
        // The allocation is applied to the RUNNING pair, so the deltas are whatever it actually
        // moved rather than a flat ±amount — on an entry that settles one column and crosses the
        // remainder into the other, both deltas are non-zero and neither equals the entry's own
        // figure. Derived by difference so the row can never disagree with the running balance it
        // is printed beside.
        const before = { receivable: run.receivable, payable: run.payable }
        const after = e.debitAccount === cust.id ? allocateDebit(before, e.amount) : allocateCredit(before, e.amount)
        run.receivable = after.receivable
        run.payable = after.payable
        return {
          id: e.id,
          date: isoDay(date),
          at: stampTime(date),
          type: 'journal',
          description: e.narration || `Journal entry ${e.ref}`,
          pkrValue: e.amount,
          receivableDelta: after.receivable - before.receivable,
          payableDelta: after.payable - before.payable,
          runningReceivable: run.receivable,
          runningPayable: run.payable,
          runningNet: run.receivable - run.payable,
        }
      },
    })
  }

  // Oldest first — a statement reads forward, and a running balance is meaningless in any other
  // order. (The customer detail screen lists newest-first, which is right for "what happened
  // lately" and wrong for this.) Oldest first WITHIN a day too: see `statementOrder`.
  pending.sort((a, b) => byStatementOrder(a, b) || a.at - b.at || a.date.localeCompare(b.date))

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
