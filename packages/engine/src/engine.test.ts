import { describe, it, expect } from 'vitest'
import {
  CORE_ACCOUNT_IDS,
  CURRENCIES,
  activityDate,
  buyCalc,
  sellCalc,
  toPaisa,
  openingStock,
  stockAsOf,
  marginLedger,
  chequeNoError,
  chequeIsOpen,
  chequeIsOverdue,
  nextChequeNumber,
  custEffects,
  customerBalanceAsOf,
  rangeBounds,
  periodIdFor,
  isClosedPeriod,
  closedPeriodFor,
  periodLabel,
} from './engine.js'
import { pkrPerUnit, quoteRate, pkrValueOf, currencyMeta, DEFAULT_CURRENCY } from './currencies.js'
import type { Account, Activity, Cheque, JournalEntry, Period } from './types.js'

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

describe('cheque open / overdue', () => {
  const at = (status: Cheque['status'], due: string) => cheque({ status, due })

  it('treats Pending and Deposited as open, and every finished state as closed', () => {
    expect(chequeIsOpen(at('Pending', '2026-01-15'))).toBe(true)
    expect(chequeIsOpen(at('Deposited', '2026-01-15'))).toBe(true)
    expect(chequeIsOpen(at('Cleared', '2026-01-15'))).toBe(false)
    expect(chequeIsOpen(at('Returned', '2026-01-15'))).toBe(false)
    expect(chequeIsOpen(at('Cancelled', '2026-01-15')), 'cancelled is finished, like cleared and returned').toBe(false)
  })

  it('is overdue only strictly after the due date', () => {
    const q = at('Pending', '2026-01-15')
    expect(chequeIsOverdue(q, '2026-01-14'), 'the day before').toBe(false)
    expect(chequeIsOverdue(q, '2026-01-15'), 'due today is not yet late').toBe(false)
    expect(chequeIsOverdue(q, '2026-01-16'), 'the day after').toBe(true)
  })

  it('never flags a cheque whose outcome is already known', () => {
    // A cleared cheque that happened to clear late is not something anyone needs chasing, and a
    // cancelled one never went anywhere. Flagging either would be noise about a closed record.
    for (const status of ['Cleared', 'Returned', 'Cancelled'] as const) {
      expect(chequeIsOverdue(at(status, '2026-01-01'), '2026-06-01'), status).toBe(false)
    }
  })

  it('does not flag a cheque with no due date at all', () => {
    expect(chequeIsOverdue(cheque({ status: 'Pending', due: '' }), '2026-06-01')).toBe(false)
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
    const balance = customerBalanceAsOf(cust, activities, [], [], new Date('2026-01-05T00:00:00.000Z').getTime())
    expect(balance.receivable).toBe(7000)
  })

  // openingReceivable/openingPayable carry no date of their own, so every replay applied them at
  // EVERY date — including dates before the account existed. createAccount journals the same figure
  // as a DATED entry, so a sheet cut before that date showed the opening balance while the journal
  // correctly showed nothing. Measured on real data: PKR 10,000 at 2026-08-31 for an account
  // created 2026-09-01, and the last remaining disagreement in `npm run reconcile`.
  it('does not apply an opening balance at a date before the account existed', () => {
    const cust = account({ id: 'cust1', openingReceivable: 10_000, createdAt: '2026-09-01T00:00:00.000Z' })
    const before = customerBalanceAsOf(cust, [], [], [], new Date('2026-08-31T23:59:59.999Z').getTime())
    expect(before.receivable, 'nothing was on the books before the account was opened').toBe(0)
    expect(before.payable).toBe(0)
  })

  it('applies the opening balance from the day the account was created onwards', () => {
    const cust = account({ id: 'cust1', openingReceivable: 10_000, createdAt: '2026-09-01T00:00:00.000Z' })
    expect(customerBalanceAsOf(cust, [], [], [], new Date('2026-09-01T00:00:00.000Z').getTime()).receivable).toBe(10_000)
    expect(customerBalanceAsOf(cust, [], [], [], new Date('2026-12-31T00:00:00.000Z').getTime()).receivable).toBe(10_000)
  })

  it('dates an opening payable on the same terms as an opening receivable', () => {
    const cust = account({ id: 'cust1', openingPayable: 4_000, createdAt: '2026-09-01T00:00:00.000Z' })
    expect(customerBalanceAsOf(cust, [], [], [], new Date('2026-08-20T00:00:00.000Z').getTime()).payable).toBe(0)
    expect(customerBalanceAsOf(cust, [], [], [], new Date('2026-09-02T00:00:00.000Z').getTime()).payable).toBe(4_000)
  })
})

// ---------------------------------------------------------------------------
// Multi-currency quote conventions (see currencies.ts)
// ---------------------------------------------------------------------------

describe('quote conventions (pkrPerUnit / quoteRate / pkrValueOf)', () => {
  it('lists exactly the six codes the desk trades, in strongest-to-weakest order', () => {
    // CURRENCIES is what tradesService.ts validates an incoming trade's currency against, and what
    // migrations 012 and 014 seeded stock_positions/Currency Stock accounts for — a change here
    // without a matching migration leaves a tradeable code with no seeded row behind it.
    expect(CURRENCIES).toEqual(['EUR', 'USD', 'AED', 'AFN', 'JPY', 'TMN'])
  })

  it('quotes every currency the normal way round except TMN', () => {
    // The multiply/divide split is the one piece of per-currency behaviour that can silently
    // corrupt a posting: getting it wrong returns a cheerful 200 while booking the position at
    // millions of times its true cost. JPY is the interesting case — at ~1.9 PKR it is the
    // weakest 'multiply' currency, and close enough to parity to be worth pinning deliberately.
    for (const code of ['EUR', 'USD', 'AED', 'AFN', 'JPY']) {
      expect(currencyMeta(code).quote, `${code} should be a multiply quote`).toBe('multiply')
    }
    expect(currencyMeta('TMN').quote).toBe('divide')
  })

  it('opens the trade screen on AED, independently of picker order', () => {
    // DEFAULT_CURRENCY exists precisely so that reordering the picker cannot move the default.
    // Adding EUR and USD sorted both above AED, and the screen previously took the first entry.
    expect(DEFAULT_CURRENCY).toBe('AED')
    expect(CURRENCIES).toContain(DEFAULT_CURRENCY)
    expect(CURRENCIES[0]).not.toBe(DEFAULT_CURRENCY) // the two are genuinely decoupled now
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
    // 1 PKR ~= 797 TMN, so one TMN is worth ~0.001255 PKR.
    expect(pkrPerUnit('TMN', 797)).toBeCloseTo(0.001254705, 8)
    expect(pkrPerUnit('TMN', 797)).toBe(1 / 797)
    // quoteRate is what puts a stored weighted-average cost back on a dealer's screen as a
    // number they recognise, rather than as 0.001255. It is a float round-trip (1/(1/797) is
    // 797.0000000000001), so it is asserted as close, never as exactly equal.
    expect(quoteRate('TMN', pkrPerUnit('TMN', 797))).toBeCloseTo(797, 9)
    expect(quoteRate('TMN', 0.00125)).toBeCloseTo(800, 9)
  })

  it('treats an unknown code as a plain PKR-per-unit currency rather than throwing', () => {
    expect(pkrPerUnit('USD', 280)).toBe(280)
    expect(quoteRate('USD', 280)).toBe(280)
  })

  it('returns 0 for a zero rate on both sides instead of dividing by zero', () => {
    expect(pkrPerUnit('TMN', 0)).toBe(0)
    expect(quoteRate('TMN', 0)).toBe(0)
  })

  it("values a 'divide'-quoted amount by dividing, not multiplying", () => {
    // 1,000,000 TMN / 797 = ~1,254.71 PKR. Multiplying instead would book 797,000,000 PKR.
    expect(pkrValueOf('TMN', 1_000_000, 797)).toBeCloseTo(1254.705, 3)
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

  it('values a TMN purchase by dividing by the typed rate', () => {
    const r = buyCalc(1_000_000, 797, 'Credit', 0, 'TMN')
    expect(r.pkrValue).toBeCloseTo(1254.705, 3)
    expect(r.outstanding).toBeCloseTo(1254.705, 3)
    // `rate` is echoed back as the dealer typed it, never as the converted figure — the stored
    // row has to stay in quote convention for unitPkr() to re-derive it correctly on replay.
    expect(r.rate).toBe(797)
  })

  it("reads sellCalc's avgCost as canonical PKR-per-unit while converting only the sale rate", () => {
    // Bought at 797 TMN per PKR (avg cost 0.001255 PKR per TMN), selling at 787 TMN per PKR — a
    // LOWER number in a divide quote means the currency is worth more PKR per unit, so this is a
    // profitable sale.
    const avgCost = 1 / 797
    const r = sellCalc(1_000_000, 787, avgCost, 'Credit', 0, 'TMN')
    // sellCalc rounds sale value and cost to a paisa once (see 'sale rounding' below), so these are
    // close to the raw quotients within half a paisa, not to nine decimals. Two digits = 0.005.
    expect(r.saleValue).toBeCloseTo(1_000_000 / 787, 2)
    expect(r.cost).toBeCloseTo(1_000_000 / 797, 2)
    expect(r.margin).toBeCloseTo(1_000_000 / 787 - 1_000_000 / 797, 2)
    expect(r.margin).toBeGreaterThan(0)
    // The double-conversion bug this guards against would have divided avgCost as well,
    // producing a cost of ~7.97e8 rather than ~1,255.
    expect(r.cost).toBeLessThan(10_000)
  })
})

// The client's own ledger, used as the acceptance figures. His previous system books Toman sales as
// "SALE Dubai Tmn 3,000,000,000@797 = 3,764,115", i.e. amount in Toman, rate in Toman per 1 PKR,
// value in rupees. These are real numbers off his real statement, not invented ones — if the engine
// disagrees with them by even a rupee, the engine is what is wrong.
describe("the client's real Toman figures (his own ledger)", () => {
  // The engine does not round: pkrValue is the raw quotient. A ledger that prints whole rupees is
  // showing that quotient rounded, so each case pins BOTH the raw value and the whole-rupee figure
  // the client reads. Math.round, not floor — 3,807,106.6 must read 3,807,107, and a display that
  // truncated would read 3,807,106 and disagree with his statement by a rupee.
  const cases = [
    { amount: 3_000_000_000, rate: 797, raw: 3764115.433, whole: 3_764_115, ref: 'DTMS6173' },
    { amount: 5_000_000_000, rate: 787, raw: 6353240.152, whole: 6_353_240, ref: 'DTMS6197' },
    { amount: 3_000_000_000, rate: 788, raw: 3807106.599, whole: 3_807_107, ref: 'DTMS6221' },
  ]

  for (const c of cases) {
    it(`${c.amount.toLocaleString('en-US')} TMN @ ${c.rate} = ${c.whole.toLocaleString('en-US')} PKR (${c.ref})`, () => {
      const pkr = pkrValueOf('TMN', c.amount, c.rate)
      expect(pkr).toBeCloseTo(c.raw, 3)
      expect(Math.round(pkr)).toBe(c.whole)
      // buyCalc and sellCalc must agree with the bare conversion: they are what actually books it.
      expect(buyCalc(c.amount, c.rate, 'Credit', 0, 'TMN').pkrValue).toBe(pkr)
      // sellCalc rounds the sale value to a paisa once; buyCalc leaves the raw quotient for the
      // database to round on insert. Same paisa either way.
      expect(sellCalc(c.amount, c.rate, 0, 'Credit', 0, 'TMN').saleValue).toBe(toPaisa(pkr) / 100)
    })
  }

  it('rounds 3,807,106.6 UP to 3,807,107 — the one figure where floor and round disagree', () => {
    const pkr = pkrValueOf('TMN', 3_000_000_000, 788)
    expect(pkr).toBeGreaterThan(3_807_106.5)
    expect(pkr).toBeLessThan(3_807_106.7)
    expect(Math.round(pkr)).toBe(3_807_107)
    expect(Math.floor(pkr)).toBe(3_807_106) // what a truncating display would have printed
  })

  it('is a divide quote: a multiplied booking would be off by a factor of rate squared', () => {
    // 3e9 x 797 = 2.39e12 PKR. Dividing gives 3.76e6. Off by 797^2 ~ 635,000x — the size of the
    // error this whole rename exists to make impossible to type.
    const right = pkrValueOf('TMN', 3_000_000_000, 797)
    const wrong = 3_000_000_000 * 797
    expect(right).toBeLessThan(4_000_000)
    expect(wrong / right).toBeCloseTo(797 * 797, 0)
  })

  it('describes itself as the Toman, quoted TMN per 1 PKR, and sits last in the picker', () => {
    const m = currencyMeta('TMN')
    expect(m.name).toBe('Toman')
    expect(m.quote).toBe('divide')
    expect(m.rateLabel).toBe('TMN per 1 PKR')
    // Weakest currency stays last — the picker orders strongest-to-weakest.
    expect(CURRENCIES[CURRENCIES.length - 1]).toBe('TMN')
  })

  it('does not offer IRR, so a stale Rial code can never be traded by accident', () => {
    // An unknown code falls back to a plain PKR-per-unit MULTIPLY quote (currencies.ts). If IRR
    // were merely left unrecognised rather than removed, a trade keyed under it would be booked
    // at its typed rate times its amount — roughly 797 times what a Toman-scale figure is worth.
    expect(CURRENCIES).not.toContain('IRR')
  })
})

// AUDIT.md §3 #4, fixed 2026-09-21. A sale's three figures — what the customer owes, what the stock
// cost, and the profit — used to be rounded to a paisa separately and could stop summing. The
// client's own third ledger line reproduced it: 3,000,000,000 TMN at 788 stored 3,807,106.60 /
// 3,794,008.34 / 13,098.25, so cost + margin was 3,807,106.59 and the voucher debited the customer
// a paisa less than the balance moved.
describe('sale rounding — the three figures always sum', () => {
  const paisa = (n: number) => Math.round(n * 100)

  it('rounds half away from zero on the decimal text, not in binary', () => {
    expect(toPaisa(3807106.5989847714)).toBe(380_710_660)
    expect(toPaisa(3764115.4328732747)).toBe(376_411_543)
    // Ties that binary multiplication gets wrong: 1.005 * 100 is 100.49999999999999.
    expect(toPaisa(1.005)).toBe(101)
    expect(toPaisa(2.675)).toBe(268)
    expect(toPaisa(0.005)).toBe(1)
    expect(toPaisa(0.004)).toBe(0)
    expect(toPaisa(-1.005)).toBe(-101) // away from zero, matching Postgres
    expect(toPaisa(100)).toBe(10_000)
    expect(toPaisa(0)).toBe(0)
  })

  it('does not snap a value just BELOW a tie onto it — the one case an early version got wrong', () => {
    // Found by checking 200,000 values against Postgres. Re-parsing "<n>e2" into a double lost the
    // fourth decimal at this magnitude, rounded this to .72, and Postgres stores .71. The decimal
    // text ends ...714999996, which is below the tie.
    expect(toPaisa(61625952.714999996)).toBe(6_162_595_271)
  })

  it("makes the client's 3,000,000,000 TMN @ 788 sale sum exactly: cost + margin == pkr_value", () => {
    // avg cost as stock_positions holds it after his two purchases (3e9 @ 797, 5e9 @ 787), 12dp.
    const avgCost = 0.001264669448
    const r = sellCalc(3_000_000_000, 788, avgCost, 'Credit', 0, 'TMN')
    expect(r.saleValue).toBe(3807106.6)
    expect(r.cost).toBe(3794008.34)
    // 13,098.26, where independent rounding stored 13,098.25 and lost a paisa.
    expect(r.margin).toBe(13098.26)
    expect(paisa(r.cost) + paisa(r.margin)).toBe(paisa(r.saleValue))
    expect(r.outstanding).toBe(3807106.6)
  })

  it('leaves saleValue and cost exactly as they were, so only margin can move', () => {
    // The rule rounds each of these ONCE, the same way Postgres did on insert. So the figures the
    // customer owes and the stock cost are unchanged from before — the margin absorbs the rounding.
    const avgCost = 0.001264669448
    const r = sellCalc(3_000_000_000, 788, avgCost, 'Credit', 0, 'TMN')
    expect(paisa(r.saleValue)).toBe(toPaisa(pkrValueOf('TMN', 3_000_000_000, 788)))
    expect(paisa(r.cost)).toBe(toPaisa(3_000_000_000 * avgCost))
  })

  it('sums exactly across thousands of sales in both quote conventions', () => {
    // Deterministic pseudo-random sweep (mulberry32), so a failure reproduces.
    let a = 0x9e3779b9
    const rand = () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    let losses = 0
    for (let i = 0; i < 5000; i++) {
      const tmn = i % 2 === 0
      const amount = tmn ? Math.round(1e6 + rand() * 5e9) : Math.round(1 + rand() * 2e6)
      const rate = Math.round((tmn ? 300 + rand() * 700 : 60 + rand() * 35) * 100) / 100
      const avgCost = tmn ? Number((1 / (300 + rand() * 700)).toFixed(12)) : Number((60 + rand() * 35).toFixed(6))
      const r = sellCalc(amount, rate, avgCost, 'Credit', 0, tmn ? 'TMN' : 'AED')
      expect(paisa(r.cost) + paisa(r.margin), `sale ${i}: ${amount} @ ${rate}`).toBe(paisa(r.saleValue))
      if (r.margin < 0) losses++
    }
    // The sweep must include loss-making sales, or the negative-margin path was never exercised.
    expect(losses).toBeGreaterThan(100)
  })

  it('keeps a loss exact too, and a breakeven sale at exactly zero', () => {
    const loss = sellCalc(1000, 70, 78, 'Credit', 0, 'AED') // sold at 70 what cost 78
    expect(loss.margin).toBe(-8000)
    expect(paisa(loss.cost) + paisa(loss.margin)).toBe(paisa(loss.saleValue))

    const even = sellCalc(1000, 78, 78, 'Credit', 0, 'AED')
    expect(even.margin).toBe(0)
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

describe('weighted-average cost across a mix of AED and TMN', () => {
  // One activity list holding both currencies — the per-code filter has to keep each position's
  // cost basis entirely separate, and the TMN legs have to go through unitPkr() rather than
  // reading `rate` directly.
  const mixed: Activity[] = [
    activity({ id: 'a1', type: 'purchase', currency: 'AED', amount: 100, rate: 70, createdAt: '2026-01-01T00:00:00.000Z' }),
    activity({ id: 'i1', type: 'purchase', currency: 'TMN', amount: 3_000_000_000, rate: 797, createdAt: '2026-01-02T00:00:00.000Z' }),
    activity({ id: 'a2', type: 'purchase', currency: 'AED', amount: 100, rate: 80, createdAt: '2026-01-03T00:00:00.000Z' }),
    activity({ id: 'i2', type: 'purchase', currency: 'TMN', amount: 5_000_000_000, rate: 787, createdAt: '2026-01-04T00:00:00.000Z' }),
  ]
  // What the server's own running totals would be after those four postings:
  //   AED  (100*70 + 100*80) / 200            = 75
  //   TMN  (3e9/797 + 5e9/787) / 8e9          = 0.001264669448...
  const liveStocks = {
    AED: { available: 200, avgCost: 75 },
    TMN: { available: 8_000_000_000, avgCost: (3_000_000_000 / 797 + 5_000_000_000 / 787) / 8_000_000_000 },
  }

  it('unwinds each currency back to a zero opening position independently', () => {
    expect(openingStock('AED', liveStocks, mixed).qty).toBe(0)
    expect(openingStock('TMN', liveStocks, mixed).qty).toBe(0)
    expect(openingStock('AED', liveStocks, mixed).moves.map((m) => m.id)).toEqual(['a1', 'a2'])
    expect(openingStock('TMN', liveStocks, mixed).moves.map((m) => m.id)).toEqual(['i1', 'i2'])
  })

  it('re-weights a TMN position by PKR-per-unit, not by the typed divide-quote rate', () => {
    const asOf = stockAsOf('TMN', liveStocks, mixed, new Date('2026-01-05T00:00:00.000Z').getTime())
    expect(asOf.available).toBe(8_000_000_000)
    expect(asOf.avgCost).toBeCloseTo(0.001264669448, 11)
    // Total PKR cost basis = quantity x average = ~10,117,355.59, i.e. the sum of the two legs
    // (3,764,115.43 + 6,353,240.15). Weighting by the typed quote rate instead would put the
    // position at a cost of roughly 800 rupees per Toman.
    expect(asOf.available * asOf.avgCost).toBeCloseTo(10_117_355.585, 2)
  })

  it('leaves the AED position untouched by the interleaved TMN movements', () => {
    const asOf = stockAsOf('AED', liveStocks, mixed, new Date('2026-01-05T00:00:00.000Z').getTime())
    expect(asOf.available).toBe(200)
    expect(asOf.avgCost).toBe(75)
  })

  it('replays each currency as of a date that falls between their movements', () => {
    // As of Jan 2nd: AED has only its first leg (100 @ 70), TMN only its first (3e9 @ 797).
    const midT = new Date('2026-01-02T18:00:00.000Z').getTime()
    const aed = stockAsOf('AED', liveStocks, mixed, midT)
    expect(aed.available).toBe(100)
    expect(aed.avgCost).toBe(70)

    const tmn = stockAsOf('TMN', liveStocks, mixed, midT)
    expect(tmn.available).toBe(3_000_000_000)
    expect(tmn.avgCost).toBeCloseTo(1 / 797, 12)
  })
})

describe('rangeBounds 7d/10d presets (Margin Ledger quick filters)', () => {
  it('7d spans exactly 7 calendar days including today', () => {
    const b = rangeBounds('7d', '', '')
    expect(Math.round((b.toT - b.fromT) / 86400000)).toBe(7)
    expect(b.label).toBe('Last 7 days')
  })

  it('10d spans exactly 10 calendar days including today', () => {
    const b = rangeBounds('10d', '', '')
    expect(Math.round((b.toT - b.fromT) / 86400000)).toBe(10)
    expect(b.label).toBe('Last 10 days')
  })
})

function period(overrides: Partial<Period>): Period {
  return {
    id: '2026-09',
    closedMargin: 0,
    closedAt: '2026-09-30T12:00:00.000Z',
    closedBy: 'admin',
    ...overrides,
  }
}

describe('period close helpers (periodIdFor / isClosedPeriod / closedPeriodFor / periodLabel)', () => {
  it('derives a YYYY-MM id from a bare txnDate by slicing, not parsing', () => {
    expect(periodIdFor('2026-09-17')).toBe('2026-09')
  })

  it('is closed once it has a row that was never reopened', () => {
    expect(isClosedPeriod(period({}))).toBe(true)
  })

  it('is open again once reopenedAt is set', () => {
    expect(isClosedPeriod(period({ reopenedAt: '2026-10-01T00:00:00.000Z', reopenedBy: 'admin' }))).toBe(false)
  })

  it('finds the closed period a txnDate falls into', () => {
    expect(closedPeriodFor('2026-09-15', [period({})])?.id).toBe('2026-09')
  })

  it('does not match a period that was closed then reopened', () => {
    const periods = [period({ reopenedAt: '2026-10-01T00:00:00.000Z', reopenedBy: 'admin' })]
    expect(closedPeriodFor('2026-09-15', periods)).toBeUndefined()
  })

  it('does not match a txnDate outside the closed month', () => {
    expect(closedPeriodFor('2026-08-31', [period({})])).toBeUndefined()
  })

  it('labels an id as its month and year', () => {
    expect(periodLabel('2026-09')).toBe('September 2026')
  })
})
