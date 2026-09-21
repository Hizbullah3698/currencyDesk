import { describe, it, expect } from 'vitest'
import { customerLedger } from './ledger.js'
import { custEffects, stampTime } from './engine.js'
import type { Account, Activity, Cheque, JournalEntry } from './types.js'

const AUDIT = { createdBy: 'admin', updatedBy: 'admin' }

function cust(overrides: Partial<Account> = {}): Account {
  return {
    id: 'c1',
    type: 'Customer',
    name: 'Test Customer',
    notes: '',
    since: 'Jan 2026',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...AUDIT,
    ...overrides,
  }
}

function act(o: Partial<Activity> & Pick<Activity, 'id' | 'type'>): Activity {
  return {
    currency: 'AED',
    customerId: 'c1',
    customerName: 'Test Customer',
    amount: 0,
    pkrValue: 0,
    method: 'Credit',
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
    ...AUDIT,
    ...o,
  } as Activity
}

function chq(o: Partial<Cheque> & Pick<Cheque, 'id' | 'direction' | 'amount'>): Cheque {
  return {
    number: '1001',
    party: 'Test Customer',
    customerId: 'c1',
    bank: 'HBL',
    bankAccountId: 'bank',
    due: '2026-03-01',
    status: 'Cleared',
    ledgerApplied: true,
    history: [],
    createdAt: '2026-02-10T10:00:00.000Z',
    updatedAt: '2026-02-10T10:00:00.000Z',
    ...AUDIT,
    ...o,
  } as Cheque
}

describe('customerLedger — running balance', () => {
  it('runs a balance forward across purchases and payments', () => {
    const activity = [
      act({ id: 'p1', type: 'purchase', amount: 1000, rate: 77, pkrValue: 77_000, txnDate: '2026-02-01' }),
      act({ id: 'pay1', type: 'pay', amount: 30_000, method: 'Bank', txnDate: '2026-02-05' }),
    ]
    const l = customerLedger(cust(), activity, [], [])

    // A purchase means the desk owes the customer, so the net balance goes negative (Cr).
    expect(l.rows.map((r) => r.runningNet)).toEqual([-77_000, -47_000])
    expect(l.closing.net).toBe(-47_000)
    expect(l.closing.payable).toBe(47_000)
  })

  it('orders oldest-first, because a running balance in any other order is meaningless', () => {
    const activity = [
      act({ id: 'b', type: 'purchase', amount: 100, rate: 77, pkrValue: 7_700, txnDate: '2026-02-10' }),
      act({ id: 'a', type: 'purchase', amount: 100, rate: 77, pkrValue: 7_700, txnDate: '2026-02-01' }),
    ]
    const l = customerLedger(cust(), activity, [], [])
    expect(l.rows.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('agrees with custEffects — the statement and the balance shown elsewhere cannot disagree', () => {
    // The load-bearing invariant. A statement whose closing figure differed from the customer's
    // balance everywhere else in the app would be worse than no statement at all.
    const activity = [
      act({ id: 'p1', type: 'purchase', amount: 1000, rate: 77, pkrValue: 77_000, txnDate: '2026-02-01' }),
      act({ id: 's1', type: 'sale', amount: 500, rate: 80, pkrValue: 40_000, txnDate: '2026-02-03' }),
      act({ id: 'pay1', type: 'pay', amount: 20_000, method: 'Bank', txnDate: '2026-02-05' }),
      act({ id: 'rec1', type: 'receive', amount: 15_000, method: 'Cash', txnDate: '2026-02-07' }),
    ]
    const cheques = [chq({ id: 'q1', direction: 'Outward', amount: 5_000, updatedAt: '2026-02-09T10:00:00.000Z' })]
    const c = cust({ openingReceivable: 2_000, openingPayable: 1_000 })

    const l = customerLedger(c, activity, cheques, [])
    const effects = custEffects(c.id, activity, cheques, () => true)

    expect(l.closing.receivable).toBeCloseTo((c.openingReceivable || 0) + effects.receivable, 6)
    expect(l.closing.payable).toBeCloseTo((c.openingPayable || 0) + effects.payable, 6)
  })

  it('counts a cleared cheque on the day it cleared, not the day it was written', () => {
    // A cheque only moves the balance when it clears. Omitting these rows would leave a running
    // balance that silently stopped reconciling, with no visible reason for the gap.
    const activity = [act({ id: 'p1', type: 'purchase', amount: 1000, rate: 77, pkrValue: 77_000, txnDate: '2026-02-01' })]
    const cheques = [chq({ id: 'q1', direction: 'Outward', amount: 77_000, updatedAt: '2026-02-20T10:00:00.000Z' })]

    const l = customerLedger(cust(), activity, cheques, [])
    expect(l.rows).toHaveLength(2)
    expect(l.rows[1].type).toBe('cheque')
    expect(l.rows[1].date.slice(0, 10)).toBe('2026-02-20')
    expect(l.closing.net).toBe(0)
  })

  it('does not let a cheque still pending move the balance', () => {
    const activity = [act({ id: 'p1', type: 'purchase', amount: 1000, rate: 77, pkrValue: 77_000, txnDate: '2026-02-01' })]
    const cheques = [chq({ id: 'q1', direction: 'Outward', amount: 77_000, status: 'Pending' })]
    const l = customerLedger(cust(), activity, cheques, [])
    expect(l.rows).toHaveLength(1)
    expect(l.closing.net).toBe(-77_000)
  })
})

describe('customerLedger — date range', () => {
  const activity = [
    act({ id: 'jan', type: 'purchase', amount: 100, rate: 77, pkrValue: 7_700, txnDate: '2026-01-15' }),
    act({ id: 'feb', type: 'purchase', amount: 200, rate: 78, pkrValue: 15_600, txnDate: '2026-02-15' }),
    act({ id: 'mar', type: 'purchase', amount: 300, rate: 79, pkrValue: 23_700, txnDate: '2026-03-15' }),
  ]

  it('carries the pre-period balance forward instead of starting from zero', () => {
    // The subtle one. A February statement that opened at zero would misstate every line in it.
    const from = stampTime('2026-02-01')
    const to = stampTime('2026-02-28')
    const l = customerLedger(cust(), activity, [], [], { fromT: from, toT: to })

    expect(l.rows.map((r) => r.id)).toEqual(['feb'])
    expect(l.opening.net, 'January is brought forward').toBe(-7_700)
    expect(l.closing.net).toBe(-7_700 - 15_600)
  })

  it('covers everything when no range is given', () => {
    const l = customerLedger(cust(), activity, [], [])
    expect(l.rows).toHaveLength(3)
    expect(l.opening.net).toBe(0)
  })
})

describe('customerLedger — multi-currency', () => {
  // The requirement this exists for: a running balance that mixes currencies is the "silently
  // converted currency" bug in a different shape. AED and USD units are not commensurable, and a
  // single figure covering both means nothing.
  const activity = [
    act({ id: 'a1', type: 'purchase', currency: 'AED', amount: 1000, rate: 77, pkrValue: 77_000, txnDate: '2026-02-01' }),
    act({ id: 'u1', type: 'purchase', currency: 'USD', amount: 500, rate: 282, pkrValue: 141_000, txnDate: '2026-02-02' }),
    act({ id: 'a2', type: 'purchase', currency: 'AED', amount: 2000, rate: 78, pkrValue: 156_000, txnDate: '2026-02-03' }),
    act({ id: 'u2', type: 'sale', currency: 'USD', amount: 200, rate: 285, pkrValue: 57_000, txnDate: '2026-02-04' }),
  ]

  it('keeps a separate running unit total per currency', () => {
    const l = customerLedger(cust(), activity, [], [])
    const byId = Object.fromEntries(l.rows.map((r) => [r.id, r]))

    // AED: 1000, then 3000. USD: 500, then 300 after the sale. Crucially the AED row after the USD
    // one continues AED's own sequence — it does not pick up 1500 from the currency in between.
    expect(byId.a1.runningCurrencyUnits).toBe(1000)
    expect(byId.u1.runningCurrencyUnits).toBe(500)
    expect(byId.a2.runningCurrencyUnits, 'AED continues from 1000, not from the USD row').toBe(3000)
    expect(byId.u2.runningCurrencyUnits, 'USD reduced by the sale').toBe(300)
  })

  it('reports one position per currency and never sums units across them', () => {
    const l = customerLedger(cust(), activity, [], [])
    expect(l.currencies.map((c) => c.code)).toEqual(['AED', 'USD'])

    const aed = l.currencies.find((c) => c.code === 'AED')!
    const usd = l.currencies.find((c) => c.code === 'USD')!
    expect(aed.units).toBe(3000)
    expect(usd.units).toBe(300)
    expect(aed.trades).toBe(2)
    expect(usd.trades).toBe(2)

    // 3000 + 300 = 3300 would be the bug. Nothing in the result should ever produce it.
    expect(l.currencies.reduce((s, c) => s + c.units, 0)).not.toBe(0) // sanity: they are non-zero
    expect(aed.units).not.toBe(usd.units)
  })

  it('still runs ONE rupee balance across all currencies, which is correct', () => {
    // Rupees ARE commensurable — the customer owes one rupee amount regardless of which currency
    // generated it. Splitting that would be as wrong as merging the unit totals.
    const l = customerLedger(cust(), activity, [], [])
    // Owed to customer: 77,000 + 141,000 + 156,000 = 374,000. Owed by customer: 57,000.
    expect(l.closing.payable).toBe(374_000)
    expect(l.closing.receivable).toBe(57_000)
    expect(l.closing.net).toBe(57_000 - 374_000)
  })

  it('leaves settlements and cheques out of the per-currency totals — they move rupees, not units', () => {
    const withSettlement = [...activity, act({ id: 'pay', type: 'pay', amount: 100_000, method: 'Bank', txnDate: '2026-02-05' })]
    const l = customerLedger(cust(), withSettlement, [], [])
    const payRow = l.rows.find((r) => r.id === 'pay')!
    expect(payRow.currency).toBeUndefined()
    expect(payRow.runningCurrencyUnits).toBeUndefined()
    expect(l.currencies.reduce((s, c) => s + c.trades, 0), 'settlement is not a trade').toBe(4)
  })
})

// Same-day order. The snapshot lists activity newest-first and every deal on one day carries the same
// noon-pinned instant, so the statement used to keep the snapshot's order on a tie: dates ran
// oldest-first while the deals INSIDE a day ran newest-first, each with a running balance that
// followed the reversed order. Fixed 2026-09-21: oldest first within a day, by real creation time.
describe('customerLedger — order within one day', () => {
  function je(o: Partial<JournalEntry> & Pick<JournalEntry, 'id' | 'debitAccount' | 'creditAccount' | 'amount'>): JournalEntry {
    return {
      ref: 'JV-1',
      narration: 'Manual entry',
      debitLabel: 'x',
      creditLabel: 'y',
      txnDate: '2026-02-05',
      createdAt: '2026-02-05T10:00:00.000Z',
      updatedAt: '2026-02-05T10:00:00.000Z',
      ...AUDIT,
      ...o,
    } as JournalEntry
  }

  // Three deals on ONE day, keyed in A -> B -> C, handed over newest-first exactly as the snapshot
  // does. B is a purchase big enough to carry the balance from Dr across to Cr partway through the day.
  const A = act({ id: 'A', type: 'sale', amount: 100, rate: 10, pkrValue: 1000, txnDate: '2026-02-05', createdAt: '2026-02-05T07:00:00.000Z' })
  const B = act({ id: 'B', type: 'purchase', amount: 300, rate: 10, pkrValue: 3000, txnDate: '2026-02-05', createdAt: '2026-02-05T09:00:00.000Z' })
  const C = act({ id: 'C', type: 'sale', amount: 50, rate: 10, pkrValue: 500, txnDate: '2026-02-05', createdAt: '2026-02-05T11:00:00.000Z' })

  it('lists three deals on one day oldest-first, with the running balance following that order', () => {
    const l = customerLedger(cust(), [C, B, A], [], [])
    expect(l.rows.map((r) => r.id)).toEqual(['A', 'B', 'C'])
    // +1,000 (Dr), then -3,000 crosses to Cr, then +500 — each row's balance is the running total in THIS order.
    expect(l.rows.map((r) => r.runningNet)).toEqual([1000, -2000, -1500])
    expect(l.closing.net).toBe(-1500)
    // The crossing lands on the right row: Dr after the first deal, Cr after the second.
    expect(Math.sign(l.rows[0].runningNet)).toBe(1)
    expect(Math.sign(l.rows[1].runningNet)).toBe(-1)
  })

  it('does not depend on the order the records are handed over in', () => {
    const orders = [[A, B, C], [B, A, C], [C, A, B], [C, B, A]]
    for (const input of orders) {
      const l = customerLedger(cust(), input, [], [])
      expect(l.rows.map((r) => r.id), input.map((r) => r.id).join('')).toEqual(['A', 'B', 'C'])
      expect(l.rows.map((r) => r.runningNet)).toEqual([1000, -2000, -1500])
    }
  })

  it('still lists different days oldest-first, whatever time of day each was keyed in', () => {
    // A backdated deal keyed in LAST but struck the day before belongs above the others.
    const backdated = act({ id: 'Z', type: 'sale', amount: 10, rate: 10, pkrValue: 100, txnDate: '2026-02-04', createdAt: '2026-02-05T12:00:00.000Z' })
    const l = customerLedger(cust(), [backdated, C, B, A], [], [])
    expect(l.rows.map((r) => r.id)).toEqual(['Z', 'A', 'B', 'C'])
  })

  it('puts a cheque that cleared mid-day between the deals keyed in before and after it', () => {
    // Cleared at 09:00, between a deal keyed in at 07:30 and one keyed in at 13:00. Before this fix the
    // cheque sorted on its real clearing time against deals pinned to local noon, so it landed before both
    // (or after both, depending on the desk's timezone) instead of between them.
    const early = act({ id: 'early', type: 'sale', amount: 10, rate: 10, pkrValue: 1000, txnDate: '2026-02-05', createdAt: '2026-02-05T07:30:00.000Z' })
    const late = act({ id: 'late', type: 'sale', amount: 10, rate: 10, pkrValue: 2000, txnDate: '2026-02-05', createdAt: '2026-02-05T13:00:00.000Z' })
    const cheque = chq({ id: 'q', direction: 'Inward', amount: 400, createdAt: '2026-02-01T10:00:00.000Z', updatedAt: '2026-02-05T09:00:00.000Z' })
    const l = customerLedger(cust(), [late, early], [cheque], [])
    expect(l.rows.map((r) => r.id)).toEqual(['early', 'q', 'late'])
    expect(l.rows.map((r) => r.runningNet)).toEqual([1000, 600, 2600])
  })

  it('orders same-day entries the same way in the opening balance, where journal allocation depends on it', () => {
    // A journal entry debiting the customer 400 is keyed in FIRST (08:00), a purchase carrying a payable of
    // 1,000 second (09:00). In that order the debit has nothing to settle and sits as a receivable of 400,
    // then the purchase adds the payable: 400 owed to the desk, 1,000 owed by it. If the purchase were
    // replayed first, the debit would settle the payable instead and print 0 / 600 — the same NET, but
    // different columns, and the columns are what an opening balance shows. The old sort pushed every
    // activity ahead of every journal entry on a tie, so it produced the wrong pair.
    const debit = je({ id: 'j', debitAccount: 'c1', creditAccount: 'capital', amount: 400, createdAt: '2026-02-05T08:00:00.000Z' })
    const purchase = act({ id: 'p', type: 'purchase', amount: 100, rate: 10, pkrValue: 1000, txnDate: '2026-02-05', createdAt: '2026-02-05T09:00:00.000Z' })
    const l = customerLedger(cust(), [purchase], [], [debit], { fromT: stampTime('2026-02-10') })
    expect(l.opening.receivable).toBe(400)
    expect(l.opening.payable).toBe(1000)
    expect(l.opening.net).toBe(-600)
  })
})
