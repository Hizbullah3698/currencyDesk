import { describe, it, expect } from 'vitest'
import { journalOnlyNet, reconcile, reconciliationDates, TOLERANCE, type Snapshot } from './reconcile'
import type { Account, JournalEntry } from './types'

// These cover the harness itself, not requirement 7. The harness is expected to report NOT
// RECONCILED against real data until requirement 7 is finished — what has to be true right now is
// that it reports that for the right reasons, and would notice if the two pictures ever agreed.

const audit = { createdAt: '2026-08-10T10:00:00.000Z', createdBy: 'tester', updatedAt: '2026-08-10T10:00:00.000Z', updatedBy: 'tester' }

const account = (id: string, type: Account['type'], name = id): Account => ({
  id, type, name, notes: '', since: 'Aug 2026', ...audit,
})

const entry = (id: string, debitAccount: string, creditAccount: string, amount: number, createdAt: string): JournalEntry => ({
  id, ref: 'JV-' + id, narration: '', debitAccount, creditAccount,
  debitLabel: debitAccount, creditLabel: creditAccount, amount,
  ...audit, createdAt, updatedAt: createdAt,
})

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  accounts: [], activity: [], cheques: [], journalEntries: [], stocks: {}, ...over,
})

const T = (iso: string) => new Date(iso).getTime()

describe('journalOnlyNet', () => {
  const entries = [
    entry('1', 'cash', 'capital', 1000, '2026-08-01T00:00:00.000Z'),
    entry('2', 'expense', 'cash', 400, '2026-08-05T00:00:00.000Z'),
  ]
  const all = () => true

  it('is debit-positive', () => {
    expect(journalOnlyNet('cash', entries, all)).toBe(600) // +1000 debited, −400 credited
    expect(journalOnlyNet('capital', entries, all)).toBe(-1000)
    expect(journalOnlyNet('expense', entries, all)).toBe(400)
  })

  it('respects the reporting cut-off', () => {
    const keep = (iso: string) => new Date(iso).getTime() <= T('2026-08-03T00:00:00.000Z')
    expect(journalOnlyNet('cash', entries, keep), 'the later entry is out of period').toBe(1000)
  })

  it('is zero for an account with no postings', () => {
    expect(journalOnlyNet('bank', entries, all)).toBe(0)
  })
})

// The cut-date change made for phase 4. Everything above this point uses entries with no txnDate,
// so it exercises only the fallback — these cover the behaviour that actually changed.
describe('journalOnlyNet cuts on the entry date, not when it was keyed in', () => {
  const backfilled = (txnDate: string, createdAt: string): JournalEntry => ({
    ...entry('b1', 'cash', 'capital', 1000, createdAt),
    txnDate,
  })

  it('counts a backfilled entry at the date of the deal, not the day it was written', () => {
    // The case phase 4 creates: a voucher written TODAY for a deal struck in June. Cut at the end
    // of July it must count — cut on createdAt it would not, and the harness would report drift at
    // every historical date after a perfect backfill.
    const e = backfilled('2026-06-01', '2026-09-03T10:00:00.000Z')
    const keep = (iso: string) => new Date(iso).getTime() <= T('2026-07-31T23:59:59.999Z')
    expect(journalOnlyNet('cash', [e], keep)).toBe(1000)
  })

  it('still excludes it before the deal happened', () => {
    const e = backfilled('2026-06-01', '2026-09-03T10:00:00.000Z')
    const keep = (iso: string) => new Date(iso).getTime() <= T('2026-05-31T23:59:59.999Z')
    expect(journalOnlyNet('cash', [e], keep)).toBe(0)
  })

  it('falls back to createdAt when an entry has no date of its own', () => {
    // Manual entries, opening balances and salary postings written before migration 017.
    const e = entry('m1', 'cash', 'capital', 500, '2026-04-10T00:00:00.000Z')
    const before = (iso: string) => new Date(iso).getTime() <= T('2026-04-09T23:59:59.999Z')
    const after = (iso: string) => new Date(iso).getTime() <= T('2026-04-10T23:59:59.999Z')
    expect(journalOnlyNet('cash', [e], before)).toBe(0)
    expect(journalOnlyNet('cash', [e], after)).toBe(500)
  })

  it('pins a bare date to local noon, so no timezone offset slides it a day', () => {
    // Same hazard activityDate() exists for. A bare 'YYYY-MM-DD' parsed as UTC lands on the wrong
    // side of a midnight cut in any offset zone; noon is far enough from both boundaries.
    const e = backfilled('2026-06-15', '2026-09-03T10:00:00.000Z')
    const endOfThatDay = new Date(2026, 5, 15, 23, 59, 59, 999).getTime()
    const endOfDayBefore = new Date(2026, 5, 14, 23, 59, 59, 999).getTime()
    expect(journalOnlyNet('cash', [e], (iso) => new Date(iso).getTime() <= endOfThatDay)).toBe(1000)
    expect(journalOnlyNet('cash', [e], (iso) => new Date(iso).getTime() <= endOfDayBefore)).toBe(0)
  })
})

describe('reconcile', () => {
  it('reports agreement when the journal is the only source of a balance', () => {
    // Expense and Capital carry no stored column and no activity, so the app already derives them
    // from the journal alone — these must agree today, before requirement 7 exists.
    const snap = snapshot({
      accounts: [account('expense', 'Expense'), account('capital', 'Capital'), account('cash', 'Cash')],
      journalEntries: [entry('1', 'expense', 'cash', 250, '2026-08-01T00:00:00.000Z')],
    })
    const result = reconcile(snap, T('2026-09-01T00:00:00.000Z'))
    expect(result.ok, 'a journal-only book should already reconcile').toBe(true)
    expect(result.mismatched).toHaveLength(0)
    expect(result.totalDrift).toBeLessThan(TOLERANCE)
  })

  it('catches a customer balance the journal cannot account for', () => {
    // The real case: receivable lives in a stored column that no journal entry backs.
    const cust = account('c1', 'Customer', 'Ahmed')
    cust.receivable = 50_000
    cust.payable = 0
    const result = reconcile(snapshot({ accounts: [cust] }), T('2026-09-01T00:00:00.000Z'))

    expect(result.ok).toBe(false)
    expect(result.mismatched).toHaveLength(1)
    expect(result.mismatched[0].current).toBe(50_000)
    expect(result.mismatched[0].journal).toBe(0)
    expect(result.mismatched[0].delta).toBe(50_000)
    expect(result.mismatched[0].source).toBe('receivable/payable columns')
  })

  it('nets a receivable against a payable, debit-positive', () => {
    const cust = account('c1', 'Customer')
    cust.receivable = 10_000
    cust.payable = 25_000
    const result = reconcile(snapshot({ accounts: [cust] }), T('2026-09-01T00:00:00.000Z'))
    expect(result.mismatched[0].current).toBe(-15_000)
  })

  it('names which reconstruction each disagreement came from', () => {
    const cust = account('c1', 'Customer')
    cust.payable = 1_000
    const stock = account('currency', 'Currency Stock')
    stock.code = 'AED'
    const snap = snapshot({ accounts: [cust, stock], stocks: { AED: { available: 100, avgCost: 77 } } })

    const result = reconcile(snap, T('2026-09-01T00:00:00.000Z'))
    const sources = result.mismatched.map((r) => r.source).sort()
    expect(sources).toEqual(['receivable/payable columns', 'stockAsOf() replay'])
  })

  it('sorts the largest disagreement first, so a report leads with what matters', () => {
    const small = account('c1', 'Customer', 'Small')
    small.receivable = 500
    const big = account('c2', 'Customer', 'Big')
    big.receivable = 900_000
    const result = reconcile(snapshot({ accounts: [small, big] }), T('2026-09-01T00:00:00.000Z'))
    expect(result.mismatched.map((r) => r.label)).toEqual(['Big', 'Small'])
    expect(result.worst).toBe(900_000)
  })

  it('treats an employee as memo-only, matching the balance sheet', () => {
    const emp = account('e1', 'Employee')
    emp.monthlySalary = 60_000
    const result = reconcile(snapshot({ accounts: [emp] }), T('2026-09-01T00:00:00.000Z'))
    expect(result.ok, 'an employee carries no ledger balance on either side').toBe(true)
  })
})

describe('reconciliationDates', () => {
  it('always checks more than today', () => {
    // Both of the reporting defects fixed on 2026-08-31 were cases where a past date behaved
    // differently from the present one, so checking only today would have passed straight through.
    const snap = snapshot({
      journalEntries: [
        entry('1', 'cash', 'capital', 100, '2026-08-01T00:00:00.000Z'),
        entry('2', 'cash', 'capital', 100, '2026-08-20T00:00:00.000Z'),
      ],
    })
    const dates = reconciliationDates(snap)
    expect(dates.length).toBeGreaterThan(1)
    expect(dates.map((d) => d.label)).toContain('today')
    expect(dates.map((d) => d.label)).toContain('before any activity')
  })

  it('puts the control date genuinely before the first posting', () => {
    const snap = snapshot({ journalEntries: [entry('1', 'cash', 'capital', 100, '2026-08-10T00:00:00.000Z')] })
    const control = reconciliationDates(snap).find((d) => d.label === 'before any activity')!
    expect(control.t).toBeLessThan(T('2026-08-10T00:00:00.000Z'))
  })

  it('falls back to today alone for an empty book', () => {
    expect(reconciliationDates(snapshot())).toHaveLength(1)
  })
})
