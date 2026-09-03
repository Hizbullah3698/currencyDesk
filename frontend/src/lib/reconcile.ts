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
// It was built before it could pass, and confirmed failing against real data, on the principle that
// a check never seen failing is not known to be checking anything.
//
// As of phase 4 it reports RECONCILED at the current date: vouchers are posted live and history is
// backfilled, so the journal alone reproduces every reported figure. Disagreements at HISTORICAL
// dates are no longer a blanket expected gap and must each be attributed to a cause. The one known
// cause is the asOfT defect in computeBalanceSheet's Customer branch, logged 2026-09-02 and left to
// phase 5 — there the journal is right and the report is wrong, not the other way round.
//
// The harness reaching zero at every date is the definition of requirement 7 being finished.

import type { Account, Activity, Cheque, JournalEntry, Stocks } from './types'
import { ledgerBalance } from './reports'
import { activityDate, marginLedger, stampTime, stockAsOf } from './engine'

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
 * CUT ON THE ENTRY'S OWN DATE, not on when it was keyed in — `txnDate` where present, falling back
 * to `createdAt`. This is the measuring instrument, so the change deserves stating rather than
 * slipping in with the phase 4 logic it is about to validate.
 *
 * Why it has to change for phase 4: backfilled vouchers are written *now* for deals struck months
 * ago. Cut on `createdAt` they would all pile up on the day the backfill ran, so at any historical
 * date the journal would look empty while the reports showed the real figure — the harness would
 * report drift at every past date after a *perfect* backfill, and be useless exactly when it is
 * needed most.
 *
 * The alternative was backdating `created_at` on backfilled rows. Rejected: that column means "when
 * this was keyed in", and writing a false value into it to make a measurement come out right is the
 * kind of thing this harness exists to catch, not to do.
 *
 * It reuses the engine's `activityDate()` rather than describing the rule again. That helper's
 * parameter is structural — `{ txnDate?, createdAt }` — which journal entries now satisfy, and it
 * carries the local-noon pinning that stops a bare 'YYYY-MM-DD' sliding a day across a timezone
 * offset. The hazard is identical for both record types, so the handling should be too.
 *
 * NOTE THIS DOES NOT DESYNC FROM `currentNet`. ledgerBalance() still cuts journal entries on
 * `createdAt`, and moving it would change reported figures — which the acceptance test forbids. The
 * two only disagree for rows where `txnDate` differs from the `createdAt` day, and those are
 * exactly the voucher legs that ledgerBalance already excludes via isVoucherLeg(). Phase 5 moves
 * that side over when the reports switch to the journal.
 */
export function journalOnlyNet(accountId: string, journalEntries: JournalEntry[], keep: (iso: string) => boolean): number {
  let net = 0
  for (const e of journalEntries) {
    if (!keep(activityDate(e))) continue
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
 * Snaps a moment to the end of its local day, which is the ONLY cut the app ever makes: every
 * branch of the engine's `rangeBounds()` ends a period at 23:59:59.999, never at the current time.
 *
 * Reproducing that is not a detail. `activityDate()` pins a bare 'YYYY-MM-DD' to local NOON, so a
 * cut taken at `Date.now()` on a morning run silently excludes every deal dated today — which made
 * this harness report a currency-stock gap of PKR 46,800 that the app itself would never show. A
 * harness that does not cut the way the thing it audits cuts is measuring its own arithmetic.
 */
function endOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
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

  const now = endOfDay(Date.now())
  if (stamps.length === 0) return [{ label: 'today', t: now }]

  const first = stamps[0]
  const last = stamps[stamps.length - 1]
  const at = (f: number) => endOfDay(first + (last - first) * f)

  return [
    { label: 'before any activity', t: endOfDay(first - 86_400_000) },
    { label: 'a quarter through', t: at(0.25) },
    { label: 'halfway', t: at(0.5) },
    { label: 'three quarters through', t: at(0.75) },
    { label: 'today', t: now },
  ]
}
