import { describe, it, expect } from 'vitest'
import { inUseAccountIds, postedAccountIds } from './accountRefs'
import type { Activity, Cheque, JournalEntry } from './types'

// ---------------------------------------------------------------------------
// The two questions, and why they need two answers
// ---------------------------------------------------------------------------
// Reported 2026-09-09, on the desk's first real day of trading: the client created two customer
// accounts, recorded one purchase against each, and found "Currency stock (AED)" and "Currency
// stock (USD)" sitting on the Accounts page alongside them.
//
// Nothing was wrong with the Accounts page's rule — a built-in account appears once something is
// posted against it. What changed underneath it was requirement 7: a purchase now also writes a
// voucher debiting the Currency Stock account, so "something was posted against it" became true
// for accounts no person had ever touched. Excluding voucher legs is what restores the rule to
// what it always meant.
//
// The delete/retype guard must NOT be changed the same way — it mirrors the server, and the
// server counts those rows. Hence two functions, and hence these tests, which exist mainly to
// pin the DIFFERENCE between them.
// ---------------------------------------------------------------------------

const AUDIT = { createdAt: '2026-09-09T10:00:00.000Z', createdBy: 'Admin', updatedAt: '2026-09-09T10:00:00.000Z', updatedBy: 'Admin' }

function journal(extra: Partial<JournalEntry>): JournalEntry {
  return {
    id: 'j1',
    ref: 'JV-1',
    narration: 'Test',
    debitAccount: 'dr',
    creditAccount: 'cr',
    debitLabel: 'Dr',
    creditLabel: 'Cr',
    amount: 100,
    ...AUDIT,
    ...extra,
  } as JournalEntry
}

const NO_ACTIVITY: Activity[] = []
const NO_CHEQUES: Cheque[] = []

/** The two legs a live purchase writes today: Dr Currency Stock / Cr the customer. */
const PURCHASE_VOUCHER = journal({
  id: 'v1',
  voucherId: 'voucher-1',
  debitAccount: 'currencyUSD',
  creditAccount: 'wazir',
  narration: 'Purchase — 900 USD from Wazir',
})

describe('postedAccountIds — what the Accounts page reveals', () => {
  it('does NOT reveal a Currency Stock account touched only by a trade voucher', () => {
    const ids = postedAccountIds({ activity: NO_ACTIVITY, cheques: NO_CHEQUES, journalEntries: [PURCHASE_VOUCHER] })

    expect(ids.has('currencyUSD')).toBe(false)
    expect(ids.has('wazir')).toBe(false)
  })

  it('DOES reveal an account someone posted a manual journal entry against', () => {
    // The reveal rule's actual purpose: Bank, Cash and Capital are hidden scaffolding right up
    // until a person posts to one, and then they belong on the page.
    const manual = journal({ id: 'm1', debitAccount: 'expense', creditAccount: 'cash', narration: 'Office rent' })

    const ids = postedAccountIds({ activity: NO_ACTIVITY, cheques: NO_CHEQUES, journalEntries: [manual] })

    expect(ids.has('expense')).toBe(true)
    expect(ids.has('cash')).toBe(true)
  })

  it('still reveals the customer and settlement account of a trade, which come from the activity row', () => {
    // Excluding voucher legs must not cost the page the accounts a trade genuinely names. These
    // arrive via `activity`, not via the journal, so they are unaffected — worth pinning, because
    // "filter out the voucher" applied one level too high would silently hide the customer too.
    const purchase = {
      id: 'a1',
      type: 'purchase',
      customerId: 'wazir',
      customerName: 'Wazir',
      settlementAccountId: 'cash',
      amount: 900,
      pkrValue: 250_200,
      ...AUDIT,
    } as unknown as Activity

    const ids = postedAccountIds({ activity: [purchase], cheques: NO_CHEQUES, journalEntries: [PURCHASE_VOUCHER] })

    expect(ids.has('wazir')).toBe(true)
    expect(ids.has('cash')).toBe(true)
    expect(ids.has('currencyUSD')).toBe(false)
  })

  it('counts opening balances and salary postings, which are entries in their own right', () => {
    const opening = journal({ id: 'o1', debitAccount: 'ahmed', creditAccount: 'capital', openingFor: 'ahmed' })
    const salary = journal({
      id: 's1',
      debitAccount: 'salaryExpense',
      creditAccount: 'salaryPayable',
      salary: { employeeId: 'emp1', period: '2026-09', kind: 'accrual' },
    })

    const ids = postedAccountIds({ activity: NO_ACTIVITY, cheques: NO_CHEQUES, journalEntries: [opening, salary] })

    expect(ids.has('ahmed')).toBe(true)
    expect(ids.has('capital')).toBe(true)
    expect(ids.has('emp1')).toBe(true)
  })
})

describe('inUseAccountIds — what the server will refuse to retype or delete', () => {
  it('DOES count a voucher leg, because describeAccountReferences does', () => {
    // The one assertion that keeps the two functions from being collapsed back into one. If this
    // followed postedAccountIds, the edit form would wave through a retype the API then rejects,
    // with no confirmation shown first.
    const ids = inUseAccountIds({ activity: NO_ACTIVITY, cheques: NO_CHEQUES, journalEntries: [PURCHASE_VOUCHER] })

    expect(ids.has('currencyUSD')).toBe(true)
    expect(ids.has('wazir')).toBe(true)
  })

  it('counts a cheque bank account, which is easy to forget and was missing until 2026-09-06', () => {
    const cheque = { id: 'q1', customerId: 'ahmed', bankAccountId: 'bank', ...AUDIT } as unknown as Cheque

    const ids = inUseAccountIds({ activity: NO_ACTIVITY, cheques: [cheque], journalEntries: [] })

    expect(ids.has('ahmed')).toBe(true)
    expect(ids.has('bank')).toBe(true)
  })
})
