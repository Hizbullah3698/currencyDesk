// ---------------------------------------------------------------------------
// Journal reconciliation harness (requirement 7, phase 2)
// ---------------------------------------------------------------------------
//
// Requirement 7 moves the source of truth for reporting out of four separate reconstructions and
// into the journal. The one thing that must not happen along the way is a reported figure quietly
// changing. This measures that, per account, at any date.
//
// It answers exactly one question: **if the journal were the only source, would every account
// still show the number the app reports today?**
//
// Today the answer is a resounding no, and that is the point of building it now. Nothing posts a
// voucher yet, so a journal-only balance sheet is missing every trade and every settlement. The
// harness is expected to fail loudly against real data before phase 3 exists — a harness that has
// never been seen failing is not known to be checking anything, which is the same discipline this
// project applies to regression tests.
//
// As phase 5 retires each reconstruction, its accounts come into agreement one group at a time.
// The harness reaching zero is the definition of requirement 7 being finished.

import type { Account, Activity, Cheque, JournalEntry, Stocks } from './types'
import { ledgerBalance } from './reports'
import { marginLedger, stampTime, stockAsOf } from './engine'

export interface Snapshot {
  accounts: Account[]
  activity: Activity[]
  cheques: Cheque[]
  journalEntries: JournalEntry[]
  stocks: Stocks
}

export interface ReconRow {
  id: string
  label: string
  type: string
  /** Dr-positive, as the app reports it today. */
  current: number
  /** Dr-positive, derived from journal entries alone. */
  journal: number
  delta: number
  /** Which of the four reconstructions supplies `current` for this account. */
  source: string
}

export interface ReconResult {
  asOf: string
  rows: ReconRow[]
  mismatched: ReconRow[]
  worst: number
  /** Absolute deltas summed — a single number for "how far apart are the two pictures". */
  totalDrift: number
  ok: boolean
}

/**
 * A rupee is the smallest unit anything here is reported in, so half a paisa is comfortably
 * below anything that could matter while still catching a genuine one-rupee posting error.
 */
export const TOLERANCE = 0.005

/**
 * Net debit position from journal entries alone.
 *
 * Cut on `createdAt`, matching what ledgerBalance() already does with journal entries today.
 *
 * PHASE 3 WILL NEED MORE THAN THIS. Reports cut activity on `activityDate()` — the day the deal
 * was struck — not on the day it was keyed in. `journal_entries` has no equivalent column, so a
 * voucher posted for a backdated trade would land in the wrong period and silently undo
 * requirement 1. Either journal entries gain their own transaction date, or a voucher's date is
 * read through its `activity_id`. That decision belongs to phase 3; recording it here because
 * building this is what surfaced it.
 */
export function journalOnlyNet(accountId: string, journalEntries: JournalEntry[], keep: (iso: string) => boolean): number {
  let net = 0
  for (const e of journalEntries) {
    if (!keep(e.createdAt)) continue
    if (e.debitAccount === accountId) net += e.amount
    if (e.creditAccount === accountId) net -= e.amount
  }
  return net
}

/**
 * What the app reports for one account today, Dr-positive.
 *
 * This deliberately mirrors computeBalanceSheet()'s per-account branches rather than reading its
 * output. Two reasons: its Capital row carries the presentation-only equity plug, which would
 * make that one account incomparable; and its Customer rows are suppressed entirely when both
 * sides are zero, which would hide an account the journal thinks is non-zero — the exact
 * disagreement this harness exists to catch.
 */
export function currentNet(
  account: Account,
  snap: Snapshot,
  keep: (iso: string) => boolean,
  asOfT: number,
): { net: number; source: string } {
  if (account.type === 'Customer') {
    return { net: (account.receivable || 0) - (account.payable || 0), source: 'receivable/payable columns' }
  }
  if (account.type === 'Currency Stock') {
    const { available, avgCost } = stockAsOf(account.code || 'AED', snap.stocks, snap.activity, asOfT)
    return { net: available * avgCost, source: 'stockAsOf() replay' }
  }
  // Memo-only on the balance sheet — it carries no ledger balance of its own, and the journal
  // agrees, since salary posts to salaryExpense/salaryPayable rather than to the employee.
  if (account.type === 'Employee') return { net: 0, source: 'memo only' }

  const net = ledgerBalance(account.id, snap.journalEntries, snap.activity, snap.cheques, keep)
  if (account.type === 'Income') {
    // computeBalanceSheet subtracts trading margin here: net is Dr-positive, margin is Cr-normal.
    const salesMargin = marginLedger(snap.accounts, snap.activity, [], snap.stocks, keep).salesMargin
    return { net: net - salesMargin, source: 'ledgerBalance + marginLedger' }
  }
  return { net, source: 'ledgerBalance' }
}

export function reconcile(snap: Snapshot, asOfT: number): ReconResult {
  const keep = (iso: string) => stampTime(iso) <= asOfT

  const rows: ReconRow[] = snap.accounts.map((a) => {
    const { net: current, source } = currentNet(a, snap, keep, asOfT)
    const journal = journalOnlyNet(a.id, snap.journalEntries, keep)
    return { id: a.id, label: a.name, type: a.type, current, journal, delta: current - journal, source }
  })

  const mismatched = rows
    .filter((r) => Math.abs(r.delta) > TOLERANCE)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))

  const worst = mismatched.length ? Math.abs(mismatched[0].delta) : 0
  const totalDrift = rows.reduce((s, r) => s + Math.abs(r.delta), 0)

  return {
    asOf: new Date(asOfT).toISOString().slice(0, 10),
    rows,
    mismatched,
    worst,
    totalDrift,
    ok: mismatched.length === 0,
  }
}

/**
 * Dates to reconcile at.
 *
 * Never only today. The two most recently fixed reporting defects were both cases where a past
 * date behaved differently from the present one — the balance sheet valuing historical stock at
 * today's position, and the equity plug concealing the residual that produced. A harness that
 * only checked today would have passed straight through both.
 *
 * Returns a pre-history control date (where every account should be flat and the two pictures
 * should already agree), three points spread across the activity, and today.
 */
export function reconciliationDates(snap: Snapshot): { label: string; t: number }[] {
  const stamps = [
    ...snap.activity.map((a) => stampTime(a.createdAt)),
    ...snap.journalEntries.map((e) => stampTime(e.createdAt)),
  ].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)

  const now = Date.now()
  if (stamps.length === 0) return [{ label: 'today', t: now }]

  const first = stamps[0]
  const last = stamps[stamps.length - 1]
  const at = (f: number) => first + (last - first) * f

  return [
    { label: 'before any activity', t: first - 86_400_000 },
    { label: 'a quarter through', t: at(0.25) },
    { label: 'halfway', t: at(0.5) },
    { label: 'three quarters through', t: at(0.75) },
    { label: 'today', t: now },
  ]
}
