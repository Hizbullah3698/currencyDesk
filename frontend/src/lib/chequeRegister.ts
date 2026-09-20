import type { Account, Activity, Cheque } from './types'
import { activityDate } from './engine'

/**
 * The cheque register — every cheque as one accounting line, listed by the day it was received.
 *
 * READ-ONLY, DERIVED FROM WHAT ALREADY EXISTS. Cheques are entered through Receive/Make Payment,
 * which writes both the cheque and the payment behind it. A second entry path here would either
 * duplicate that pair or — worse — write a cheque with no payment behind it, which looks right
 * and produces wrong books: clearing reads `customerId` to move a balance that was never raised.
 *
 * Extracted from the page rather than written inside it because the Dr/Cr rules below are the
 * whole point of the screen and frontend tests run with no jsdom — logic in a component cannot be
 * tested at all, logic in `lib/` can. Same reasoning as lib/accountRefs.ts.
 */
export interface ChequeRegisterRow {
  id: string
  /** The day the cheque was handed over, 'YYYY-MM-DD'-ish — see `receivedDate` below. */
  received: string
  /** The date written on the cheque itself (`due`). */
  chequeDate: string
  number: string
  amount: number
  status: string
  direction: string
  /** Resolved names, not ids — this is a register to read, not a form to post from. */
  debitAccount: string
  creditAccount: string
  description: string
}

/**
 * The day the cheque was given to the desk.
 *
 * NOT on the cheque row. A cheque carries only `createdAt`, which is when it was keyed in — a
 * cheque taken on Monday and entered on Wednesday would list under Wednesday. The day it was
 * actually received is the transaction date of the PAYMENT it was taken against, which lives on
 * the linked activity row, so that is what this reads.
 *
 * Falls back to the cheque's own `createdAt` when no activity row points at it, which keeps a
 * cheque from vanishing off the register if one is ever created by another path.
 */
export function receivedDate(q: Cheque, activity: Activity[]): string {
  const behind = activity.find((t) => t.chequeId === q.id)
  return behind ? activityDate(behind) : q.createdAt
}

/**
 * Which account is debited and which credited when this cheque clears.
 *
 * DERIVED, NEVER CHOSEN — this mirrors `chequeClearingSides` in the backend's voucherPostings.ts,
 * which is the single description of what legs each movement produces. An inward cheque is money
 * arriving: the desk's bank gains and the customer owes that much less. An outward one is the
 * mirror. The two accounts were both already fixed at entry — the customer by the payment, the
 * bank by the "Deposit into" / "Drawn from" picker — so there is nothing left to pick here.
 *
 * Shown for every cheque, including ones not yet cleared: this is what the entry WILL post, which
 * is what a register is for. Nothing is posted until the cheque clears (settlementSides zeroes a
 * cheque-method settlement outright), and the page says so.
 */
export function chequeLegs(q: Cheque, accounts: Account[]): { debitAccount: string; creditAccount: string } {
  const name = (id: string | null) => (id ? accounts.find((a) => a.id === id)?.name || '—' : '—')
  const bank = name(q.bankAccountId)
  const customer = name(q.customerId)
  return q.direction === 'Inward'
    ? { debitAccount: bank, creditAccount: customer }
    : { debitAccount: customer, creditAccount: bank }
}

/**
 * A plain-language line for the Description column.
 *
 * A cheque carries no free-text note of its own, so this is composed from what the record actually
 * holds rather than left blank. Adding a stored description would mean a new column AND a field on
 * the entry form — a write-path change, which this screen deliberately is not.
 */
export function chequeDescription(q: Cheque): string {
  const who = q.party || 'customer'
  const from = q.direction === 'Inward' ? `Cheque from ${who}` : `Cheque to ${who}`
  return q.bank ? `${from} · ${q.bank}` : from
}

export interface ChequeRegisterDay {
  date: string
  rows: ChequeRegisterRow[]
  total: number
}

/**
 * The register, grouped by received date, most recent day first.
 *
 * Newest-first matches the Transactions page and is what a desk actually scans — a statement reads
 * forward because it carries a running balance, and this does not.
 */
export function chequeRegister(cheques: Cheque[], activity: Activity[], accounts: Account[]): ChequeRegisterDay[] {
  const rows: (ChequeRegisterRow & { sortT: number })[] = cheques.map((q) => {
    const received = receivedDate(q, activity)
    const { debitAccount, creditAccount } = chequeLegs(q, accounts)
    return {
      id: q.id,
      received,
      chequeDate: q.due,
      number: q.number,
      amount: q.amount,
      status: q.status,
      direction: q.direction,
      debitAccount,
      creditAccount,
      description: chequeDescription(q),
      sortT: new Date(received).getTime() || 0,
    }
  })

  const byDay = new Map<string, ChequeRegisterDay>()
  for (const row of rows.sort((a, b) => b.sortT - a.sortT)) {
    // Group on the calendar DAY, not the raw stamp: activityDate pins a bare date to local noon
    // and a fallback createdAt is a full timestamp, so two cheques received on the same day can
    // carry different times and would otherwise head two separate groups.
    const day = dayOf(row.received)
    const existing = byDay.get(day)
    if (existing) {
      existing.rows.push(row)
      existing.total += row.amount
    } else {
      byDay.set(day, { date: day, rows: [row], total: row.amount })
    }
  }
  return [...byDay.values()]
}

/** The calendar day of an ISO stamp, as 'YYYY-MM-DD', read through the LOCAL calendar so a
 *  late-evening UTC timestamp lands on the desk's day rather than the previous one. */
function dayOf(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
