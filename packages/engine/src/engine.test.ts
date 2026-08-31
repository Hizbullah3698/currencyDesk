import { describe, it, expect } from 'vitest'
import {
  CORE_ACCOUNT_IDS,
  CURRENCIES,
  activityDate,
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
import { pkrPerUnit, quoteRate, pkrValueOf, currencyMeta } from './currencies.js'
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

// ---------------------------------------------------------------------------
// Multi-currency quote conventions (see currencies.ts)
// ---------------------------------------------------------------------------

describe('quote conventions (pkrPerUnit / quoteRate / pkrValueOf)', () => {
  it('lists exactly the three codes the desk trades, in strongest-to-weakest order', () => {
    // CURRENCIES is what tradesService.ts validates an incoming trade's currency against, and
    // what migration 012 seeded stock_positions/Currency Stock accounts for — a change here
    // without a matching migration leaves a tradeable code with no seeded row behind it.
    expect(CURRENCIES).toEqual(['AED', 'AFN', 'IRR'])
    expect(currencyMeta('AED').quote).toBe('multiply')
    expect(currencyMeta('AFN').quote).toBe('multiply')
    expect(currencyMeta('IRR').quote).toBe('divide')
  })

  it("round-trips a 'multiply' currency's rate unchanged in both directions", () => {
    // For AED the quote rate and the canonical PKR-per-unit figure are the same number, which
    // is exactly why the single-currency version of this app never needed the distinction.
    expect(pkrPerUnit('AED', 77)).toBe(77)
    expect(quoteRate('AED', 77)).toBe(77)
    expect(quoteRate('AED', pkrPerUnit('AED', 77))).toBe(77)
    expect(pkrPerUnit('AFN', 1.15)).toBe(1.15)
    expect(quoteRate('AFN', pkrPerUnit('AFN', 1.15))).toBeCloseTo(1.15, 12)
  })

  it("inverts a 'divide' currency's rate and round-trips back to the typed quote", () => {
    // 1 PKR ~= 4,952.53 IRR, so one IRR is worth ~0.000202 PKR.
    expect(pkrPerUnit('IRR', 4952.53)).toBeCloseTo(0.000201917, 12)
    expect(pkrPerUnit('IRR', 4952.53)).toBe(1 / 4952.53)
    // quoteRate is what puts a stored weighted-average cost back on a dealer's screen as a
    // number they recognise, rather than as 0.000202.
    expect(quoteRate('IRR', pkrPerUnit('IRR', 4952.53))).toBeCloseTo(4952.53, 9)
    expect(quoteRate('IRR', 0.00025)).toBe(4000)
  })

  it('treats an unknown code as a plain PKR-per-unit currency rather than throwing', () => {
    expect(pkrPerUnit('USD', 280)).toBe(280)
    expect(quoteRate('USD', 280)).toBe(280)
  })

  it('returns 0 for a zero rate on both sides instead of dividing by zero', () => {
    expect(pkrPerUnit('IRR', 0)).toBe(0)
    expect(quoteRate('IRR', 0)).toBe(0)
  })

  it("values a 'divide'-quoted amount by dividing, not multiplying", () => {
    // 1,000,000 IRR / 4,952.53 = ~201.92 PKR. Multiplying instead would book ~4.95 billion PKR.
    expect(pkrValueOf('IRR', 1_000_000, 4952.53)).toBeCloseTo(201.917, 3)
    expect(pkrValueOf('AED', 1000, 77)).toBe(77000)
  })
})

describe('buyCalc / sellCalc with an explicit currency code', () => {
  it('keeps every pre-existing 4-argument call site byte-identical (default code = AED)', () => {
    // The `code` parameter was appended, not inserted, specifically so existing call sites keep
    // meaning `pkrValue = amount * rate`. Assert the defaulted result is IDENTICAL to the
    // explicit-AED result, key by key — not merely "close".
    const defaulted = buyCalc(1000, 78, 'Credit', 50000)
    const explicit = buyCalc(1000, 78, 'Credit', 50000, 'AED')
    expect(defaulted).toEqual(explicit)
    expect(defaulted.pkrValue).toBe(78000)

    const soldDefault = sellCalc(200, 80, 78, 'Cash', 5000)
    const soldExplicit = sellCalc(200, 80, 78, 'Cash', 5000, 'AED')
    expect(soldDefault).toEqual(soldExplicit)
    expect(soldDefault.saleValue).toBe(16000)
  })

  it('values an IRR purchase by dividing by the typed rate', () => {
    const r = buyCalc(1_000_000, 4952.53, 'Credit', 0, 'IRR')
    expect(r.pkrValue).toBeCloseTo(201.917, 3)
    expect(r.outstanding).toBeCloseTo(201.917, 3)
    // `rate` is echoed back as the dealer typed it, never as the converted figure — the stored
    // row has to stay in quote convention for unitPkr() to re-derive it correctly on replay.
    expect(r.rate).toBe(4952.53)
  })

  it("reads sellCalc's avgCost as canonical PKR-per-unit while converting only the sale rate", () => {
    // Bought at 4,952.53 IRR per PKR (avg cost 0.000201917 PKR per IRR), selling at 4,900 IRR
    // per PKR — a stronger rial means more PKR per unit, so this is a profitable sale.
    const avgCost = 1 / 4952.53
    const r = sellCalc(1_000_000, 4900, avgCost, 'Credit', 0, 'IRR')
    expect(r.saleValue).toBeCloseTo(1_000_000 / 4900, 9)
    expect(r.cost).toBeCloseTo(201.917, 3)
    expect(r.margin).toBeCloseTo(1_000_000 / 4900 - 1_000_000 / 4952.53, 9)
    expect(r.margin).toBeGreaterThan(0)
    // The double-conversion bug this guards against would have divided avgCost as well,
    // producing a cost of ~4.95e9 rather than ~202.
    expect(r.cost).toBeLessThan(1000)
  })
})

describe('activityDate', () => {
  it('falls back to createdAt when the row has no txnDate (rows posted before the column existed)', () => {
    expect(activityDate({ createdAt: '2026-01-01T09:30:00.000Z' })).toBe('2026-01-01T09:30:00.000Z')
    expect(activityDate({ txnDate: undefined, createdAt: '2026-01-01T09:30:00.000Z' })).toBe('2026-01-01T09:30:00.000Z')
  })

  it('pins a bare YYYY-MM-DD to LOCAL noon so no timezone offset can slide it a day', () => {
    const iso = activityDate({ txnDate: '2026-03-05', createdAt: '2026-06-01T00:00:00.000Z' })
    expect(iso).toBe('2026-03-05T12:00:00')
    // The point of the noon pin: parsed as a LOCAL timestamp it is still March 5th, whereas a
    // bare `new Date('2026-03-05')` is parsed as UTC midnight and lands on March 4th local in
    // any negative-offset zone. Assert the calendar day survives in the running local zone.
    const d = new Date(iso)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(5)
    // 12 hours of slack either side, which is more than any real UTC offset.
    expect(d.getHours()).toBe(12)
  })

  it('lets a backdated trade fall into an earlier reporting period than the day it was keyed in', () => {
    const backdated = activity({ id: 's1', type: 'sale', txnDate: '2026-01-10', createdAt: '2026-02-20T08:00:00.000Z', pkrValue: 5000 })
    const januaryEnd = new Date('2026-01-31T23:59:59.999').getTime()
    const effects = custEffects('cust1', [backdated], [], (iso) => new Date(iso).getTime() <= januaryEnd)
    expect(effects.receivable).toBe(5000)
  })
})

describe('weighted-average cost across a mix of AED and IRR', () => {
  // One activity list holding both currencies — the per-code filter has to keep each position's
  // cost basis entirely separate, and the IRR legs have to go through unitPkr() rather than
  // reading `rate` directly.
  const mixed: Activity[] = [
    activity({ id: 'a1', type: 'purchase', currency: 'AED', amount: 100, rate: 70, createdAt: '2026-01-01T00:00:00.000Z' }),
    activity({ id: 'i1', type: 'purchase', currency: 'IRR', amount: 1_000_000, rate: 4952.53, createdAt: '2026-01-02T00:00:00.000Z' }),
    activity({ id: 'a2', type: 'purchase', currency: 'AED', amount: 100, rate: 80, createdAt: '2026-01-03T00:00:00.000Z' }),
    activity({ id: 'i2', type: 'purchase', currency: 'IRR', amount: 500_000, rate: 4000, createdAt: '2026-01-04T00:00:00.000Z' }),
  ]
  // What the server's own running totals would be after those four postings:
  //   AED  (100*70 + 100*80) / 200            = 75
  //   IRR  (1e6/4952.53 + 5e5/4000) / 1.5e6   = 0.000217944666...
  const liveStocks = {
    AED: { available: 200, avgCost: 75 },
    IRR: { available: 1_500_000, avgCost: (1_000_000 / 4952.53 + 500_000 / 4000) / 1_500_000 },
  }

  it('unwinds each currency back to a zero opening position independently', () => {
    expect(openingStock('AED', liveStocks, mixed).qty).toBe(0)
    expect(openingStock('IRR', liveStocks, mixed).qty).toBe(0)
    expect(openingStock('AED', liveStocks, mixed).moves.map((m) => m.id)).toEqual(['a1', 'a2'])
    expect(openingStock('IRR', liveStocks, mixed).moves.map((m) => m.id)).toEqual(['i1', 'i2'])
  })

  it('re-weights an IRR position by PKR-per-unit, not by the typed divide-quote rate', () => {
    const asOf = stockAsOf('IRR', liveStocks, mixed, new Date('2026-01-05T00:00:00.000Z').getTime())
    expect(asOf.available).toBe(1_500_000)
    expect(asOf.avgCost).toBeCloseTo(0.000217944667, 11)
    // Total PKR cost basis = quantity x average = ~326.92, i.e. the sum of the two legs
    // (201.92 + 125.00). Multiplying by the quote rate instead would give ~7.2 billion.
    expect(asOf.available * asOf.avgCost).toBeCloseTo(326.917, 3)
  })

  it('leaves the AED position untouched by the interleaved IRR movements', () => {
    const asOf = stockAsOf('AED', liveStocks, mixed, new Date('2026-01-05T00:00:00.000Z').getTime())
    expect(asOf.available).toBe(200)
    expect(asOf.avgCost).toBe(75)
  })

  it('replays each currency as of a date that falls between their movements', () => {
    // As of Jan 2nd: AED has only its first leg (100 @ 70), IRR only its first (1e6 @ 4952.53).
    const midT = new Date('2026-01-02T18:00:00.000Z').getTime()
    const aed = stockAsOf('AED', liveStocks, mixed, midT)
    expect(aed.available).toBe(100)
    expect(aed.avgCost).toBe(70)

    const irr = stockAsOf('IRR', liveStocks, mixed, midT)
    expect(irr.available).toBe(1_000_000)
    expect(irr.avgCost).toBeCloseTo(1 / 4952.53, 12)
  })
})
