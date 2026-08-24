import { describe, it, expect } from 'vitest'
import {
  CORE_ACCOUNT_IDS,
  buyCalc,
  sellCalc,
  openingStock,
  stockAsOf,
  marginLedger,
  chequeNoError,
  nextChequeNumber,
  custEffects,
  customerBalanceAsOf,
} from './engine.js'
import type { Account, Activity, Cheque, JournalEntry } from './types.js'

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: 'a1',
    type: 'purchase',
    currency: 'AED',
    customerId: 'cust1',
    customerName: 'Test Customer',
    amount: 0,
    pkrValue: 0,
    method: 'Credit',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'admin',
    ...overrides,
  }
}

function cheque(overrides: Partial<Cheque>): Cheque {
  return {
    id: 'q1',
    direction: 'Inward',
    number: '1001',
    party: 'Test Customer',
    customerId: 'cust1',
    bank: 'HBL',
    bankAccountId: 'bank',
    amount: 0,
    due: '2026-01-15',
    status: 'Pending',
    ledgerApplied: false,
    history: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'admin',
    ...overrides,
  }
}

function account(overrides: Partial<Account>): Account {
  return {
    id: 'cust1',
    type: 'Customer',
    name: 'Test Customer',
    notes: '',
    since: 'Jan 2026',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'admin',
    ...overrides,
  }
}

describe('CORE_ACCOUNT_IDS', () => {
  it('matches the exact set the DB trigger (migration 009) and accounts.id text-typed schema depend on', () => {
    // This list is generated verbatim into a Postgres trigger at migration-run time (see
    // backend/src/db/migrations/009_lock_core_accounts.ts) — a change here silently changes
    // what the database protects, so pin the exact set as a regression guard.
    expect(CORE_ACCOUNT_IDS).toEqual(['bank', 'cash', 'margin', 'expense', 'salaryExpense', 'salaryPayable', 'capital'])
  })
})

describe('buyCalc', () => {
  it('computes PKR value and leaves the full amount outstanding on Credit', () => {
    const r = buyCalc(1000, 78, 'Credit', 50000)
    expect(r.pkrValue).toBe(78000)
    expect(r.paidNow).toBe(0)
    expect(r.outstanding).toBe(78000)
  })

  it('caps paidNow at the PKR value even if more cash is offered', () => {
    const r = buyCalc(100, 80, 'Cash', 999999)
    expect(r.pkrValue).toBe(8000)
    expect(r.paidNow).toBe(8000)
    expect(r.outstanding).toBe(0)
  })

  it('leaves the remainder outstanding on a partial cash payment', () => {
    const r = buyCalc(100, 80, 'Cash', 3000)
    expect(r.pkrValue).toBe(8000)
    expect(r.paidNow).toBe(3000)
    expect(r.outstanding).toBe(5000)
  })
})

describe('sellCalc', () => {
  it('computes margin as sale value minus weighted-average cost', () => {
    const r = sellCalc(200, 80, 78, 'Credit', 0)
    expect(r.saleValue).toBe(16000)
    expect(r.cost).toBe(15600)
    expect(r.margin).toBe(400)
    expect(r.outstanding).toBe(16000)
  })

  it('supports a negative margin when selling below average cost', () => {
    const r = sellCalc(100, 75, 78, 'Credit', 0)
    expect(r.margin).toBe(-300)
  })

  it('caps paidNow at the sale value on Cash/Bank settlement', () => {
    const r = sellCalc(100, 80, 78, 'Cash', 100000)
    expect(r.paidNow).toBe(8000)
    expect(r.outstanding).toBe(0)
  })
})

describe('weighted-average cost (openingStock / stockAsOf)', () => {
  it('recomputes the average cost across successive purchases at different rates', () => {
    const activities: Activity[] = [
      activity({ id: 'p1', type: 'purchase', amount: 100, rate: 70, createdAt: '2026-01-01T00:00:00.000Z' }),
      activity({ id: 'p2', type: 'purchase', amount: 100, rate: 80, createdAt: '2026-01-02T00:00:00.000Z' }),
    ]
    // 100 @70 then 100 @80 -> weighted avg (7000 + 8000) / 200 = 75. `stocks` here is the current
    // LIVE totals stockAsOf reconstructs backward from — it must match what these activities
    // actually produce, the same way state.stocks always reflects the post-activity total.
    const liveStocks = { AED: { available: 200, avgCost: 75 } }
    const asOfSecondPurchase = stockAsOf('AED', liveStocks, activities, new Date('2026-01-02T12:00:00.000Z').getTime())
    expect(asOfSecondPurchase.available).toBe(200)
    expect(asOfSecondPurchase.avgCost).toBe(75)
  })

  it('does not change the average cost on a sale, only the quantity', () => {
    const activities: Activity[] = [
      activity({ id: 'p1', type: 'purchase', amount: 100, rate: 70, createdAt: '2026-01-01T00:00:00.000Z' }),
      activity({ id: 's1', type: 'sale', amount: 40, rate: 90, createdAt: '2026-01-02T00:00:00.000Z' }),
    ]
    const liveStocks = { AED: { available: 60, avgCost: 70 } }
    const asOf = stockAsOf('AED', liveStocks, activities, new Date('2026-01-02T12:00:00.000Z').getTime())
    expect(asOf.available).toBe(60)
    expect(asOf.avgCost).toBe(70)
  })

  it('replays correctly as of a date before the second purchase (openingStock/stockAsOf agree on ordering)', () => {
    const activities: Activity[] = [
      activity({ id: 'p1', type: 'purchase', amount: 100, rate: 70, createdAt: '2026-01-01T00:00:00.000Z' }),
      activity({ id: 'p2', type: 'purchase', amount: 100, rate: 80, createdAt: '2026-01-05T00:00:00.000Z' }),
    ]
    const liveStocks = { AED: { available: 200, avgCost: 75 } }
    const asOfBeforeSecond = stockAsOf('AED', liveStocks, activities, new Date('2026-01-03T00:00:00.000Z').getTime())
    expect(asOfBeforeSecond.available).toBe(100)
    expect(asOfBeforeSecond.avgCost).toBe(70)

    // openingStock reconstructs the position *before* the earliest movement by walking the
    // current live stock backwards — feeding it today's live totals should reconstruct 0/0.
    const open = openingStock('AED', { AED: { available: 200, avgCost: 75 } }, activities)
    expect(open.qty).toBe(0)
  })
})

describe('marginLedger', () => {
  it('sums sale margins and adds journal entries posted to Income accounts', () => {
    const accounts: Account[] = [account({ id: 'margin', type: 'Income', name: 'Margin / Income' })]
    const activities: Activity[] = [
      activity({ id: 's1', type: 'sale', amount: 100, rate: 80, pkrValue: 8000, cost: 7800, margin: 200, createdAt: '2026-01-01T00:00:00.000Z' }),
    ]
    const journalEntries: JournalEntry[] = [
      {
        id: 'j1',
        ref: 'JNL-1',
        narration: 'Extra income',
        debitAccount: 'bank',
        creditAccount: 'margin',
        debitLabel: 'Bank',
        creditLabel: 'Margin / Income',
        amount: 500,
        createdAt: '2026-01-02T00:00:00.000Z',
        createdBy: 'admin',
        updatedAt: '2026-01-02T00:00:00.000Z',
        updatedBy: 'admin',
      },
    ]
    // salesMargin is summed through the by-currency breakdown, which only includes currencies
    // present in `stocks` (see currencyCodes) — pass a real AED entry, matching how state.stocks
    // always carries one from the seed, rather than an empty object that would silently zero it.
    const stocks = { AED: { available: 0, avgCost: 0 } }
    const result = marginLedger(accounts, activities, journalEntries, stocks, () => true)
    expect(result.salesMargin).toBe(200)
    expect(result.journalAdj).toBe(500)
    expect(result.total).toBe(700)
  })

  it('subtracts journal entries debited against an Income account', () => {
    const accounts: Account[] = [account({ id: 'margin', type: 'Income', name: 'Margin / Income' })]
    const journalEntries: JournalEntry[] = [
      {
        id: 'j1',
        ref: 'JNL-1',
        narration: 'Correction',
        debitAccount: 'margin',
        creditAccount: 'bank',
        debitLabel: 'Margin / Income',
        creditLabel: 'Bank',
        amount: 300,
        createdAt: '2026-01-02T00:00:00.000Z',
        createdBy: 'admin',
        updatedAt: '2026-01-02T00:00:00.000Z',
        updatedBy: 'admin',
      },
    ]
    const result = marginLedger(accounts, [], journalEntries, {}, () => true)
    expect(result.journalAdj).toBe(-300)
  })
})

describe('cheque numbering', () => {
  it('flags a duplicate cheque number case-insensitively, only when method is Cheque', () => {
    const existing = [cheque({ number: '1005' })]
    expect(chequeNoError(existing, 'Cheque', '1005')).toMatch(/already exists/)
    expect(chequeNoError(existing, 'Cheque', ' 1005 ')).toMatch(/already exists/)
    expect(chequeNoError(existing, 'Credit', '1005')).toBe('')
    expect(chequeNoError(existing, 'Cheque', '1006')).toBe('')
  })

  it('skips forward past every already-taken number, not just the seed itself', () => {
    const existing = [cheque({ number: '1001' }), cheque({ number: '1002' }), cheque({ number: '1003' })]
    expect(nextChequeNumber(existing, 1001)).toBe(1004)
  })
})

describe('customer receivable/payable replay (custEffects / customerBalanceAsOf)', () => {
  it('reduces the receivable once an inward cheque against that sale actually clears', () => {
    const activities: Activity[] = [
      activity({ id: 's1', type: 'sale', customerId: 'cust1', pkrValue: 10000, paidNow: 0, chequeHeld: true, createdAt: '2026-01-01T00:00:00.000Z' }),
    ]
    const cheques: Cheque[] = [
      cheque({ id: 'q1', direction: 'Inward', customerId: 'cust1', amount: 10000, status: 'Cleared', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }),
    ]
    const effects = custEffects('cust1', activities, cheques, () => true)
    expect(effects.receivable).toBe(0)
  })

  it('leaves the receivable outstanding while the cheque is only Pending, not yet Cleared', () => {
    const activities: Activity[] = [
      activity({ id: 's1', type: 'sale', customerId: 'cust1', pkrValue: 10000, paidNow: 0, chequeHeld: true, createdAt: '2026-01-01T00:00:00.000Z' }),
    ]
    const cheques: Cheque[] = [
      cheque({ id: 'q1', direction: 'Inward', customerId: 'cust1', amount: 10000, status: 'Pending', createdAt: '2026-01-01T00:00:00.000Z' }),
    ]
    const effects = custEffects('cust1', activities, cheques, () => true)
    expect(effects.receivable).toBe(10000)
  })

  it('layers opening balance under the replayed activity effects as of a date', () => {
    const cust = account({ id: 'cust1', openingReceivable: 2000 })
    const activities: Activity[] = [
      activity({ id: 's1', type: 'sale', customerId: 'cust1', pkrValue: 5000, createdAt: '2026-01-01T00:00:00.000Z' }),
    ]
    const balance = customerBalanceAsOf(cust, activities, [], new Date('2026-01-05T00:00:00.000Z').getTime())
    expect(balance.receivable).toBe(7000)
  })
})
