/**
 * Which accounts anything points at — the two different answers, in one place.
 *
 * Extracted from store.tsx's provider so it can be tested. It is pure set-building over a
 * snapshot, with no React in it; leaving it inside a `useMemo` meant the only way to cover it was
 * to render the provider, and this frontend's tests run in a node environment with no jsdom.
 *
 * THE TWO QUESTIONS ARE NOT THE SAME QUESTION, which is the whole reason this file exists.
 */

import { isVoucherLeg } from './engine'
import type { Activity, Cheque, JournalEntry } from './types'

export interface AccountRefInput {
  activity: Activity[]
  cheques: Cheque[]
  journalEntries: JournalEntry[]
}

/**
 * The seven paths that can point at an account. Shared by both sets below so neither can quietly
 * grow a path the other lacks — the three easy to forget, and missing until 2026-09-06, are a
 * trade's settlement account, a cheque's bank account, and a salary posting's employee (a salary
 * accrual posts Dr salaryExpense / Cr salaryPayable, so the employee is never a leg and an
 * employee with a year of payroll read as untouched).
 */
function collect({ activity, cheques, journalEntries }: AccountRefInput, includeJournalEntry: (e: JournalEntry) => boolean): Set<string> {
  const ids = new Set<string>()
  for (const t of activity) {
    if (t.customerId) ids.add(t.customerId)
    if (t.settlementAccountId) ids.add(t.settlementAccountId)
  }
  for (const q of cheques) {
    if (q.customerId) ids.add(q.customerId)
    if (q.bankAccountId) ids.add(q.bankAccountId)
  }
  for (const e of journalEntries) {
    if (!includeJournalEntry(e)) continue
    ids.add(e.debitAccount)
    ids.add(e.creditAccount)
    if (e.salary) ids.add(e.salary.employeeId)
    if (e.openingFor) ids.add(e.openingFor)
  }
  return ids
}

/**
 * "Will the server refuse to retype or delete this account?"
 *
 * The client-side twin of accountHelpers.ts's `describeAccountReferences`, which counts
 * `journal_entries` rows outright — vouchers included. So this counts them too. Diverging would
 * mean the form waves through a retype the API then rejects, with no warning shown first.
 *
 * An Operator's snapshot omits journal entries with an Income leg, so this can under-report for an
 * Income account on a non-admin screen. Harmless in practice: the only Income account is the
 * built-in 'margin', which is a system account and therefore neither hidden nor deletable.
 */
export function inUseAccountIds(input: AccountRefInput): Set<string> {
  return collect(input, () => true)
}

/**
 * "Was this account posted to by a PERSON?"
 *
 * Same paths minus the voucher legs requirement 7 writes automatically. This is the one to ask
 * when deciding what to SHOW.
 *
 * THE REGRESSION IT FIXES. Accounts.tsx reveals a built-in account once something is posted
 * against it — a rule written when the only way to touch one was to mean to. Requirement 7 then
 * made every purchase debit a Currency Stock account (voucherPostings.ts `purchaseSides`), so the
 * desk's first two live trades dragged "Currency stock (AED)" and "Currency stock (USD)" onto a
 * page whose entire purpose is to list the accounts the client created. Reported 2026-09-09 on
 * first real use. A manual journal posting still reveals the account, which is what the rule was
 * always for.
 */
export function postedAccountIds(input: AccountRefInput): Set<string> {
  return collect(input, (e) => !isVoucherLeg(e))
}
