import { describe, it, expect } from 'vitest'
import { computeBalanceSheet } from './reports'
import { stampTime } from './engine'
import type { Account, Activity, Cheque, JournalEntry, Stocks } from './types'

// ---------------------------------------------------------------------------
// Balance sheet reconciliation
// ---------------------------------------------------------------------------
// The defect these cover: `balanced` used to be computed from totalDr/totalCr AFTER the equity
// plug had been added into them, which made it a tautology — it could essentially never be false,
// so the "Debits and credits agree across the full dataset" line on the Balance Sheet attested to
// nothing and a genuine posting error was indistinguishable from the expected opening-stock
// residual. It is now judged on `unexplained`: the pre-plug difference minus the one residual
// that is legitimately unjournalled.
// ---------------------------------------------------------------------------

const AUDIT = { createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'System', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'System' }

function account(id: string, type: Account['type'], name: string, extra: Partial<Account> = {}): Account {
  return { id, type, name, notes: '', since: 'Jan 2026', ...AUDIT, ...extra }
}

function activity(extra: Partial<Activity> & Pick<Activity, 'id' | 'type' | 'amount' | 'pkrValue'>): Activity {
  return {
    customerId: 'cust',
    customerName: 'Test Customer',
    method: 'Credit',
    currency: 'AED',
    ...AUDIT,
    ...extra,
  } as Activity
}

const NO_CHEQUES: Cheque[] = []
const NO_JOURNAL: JournalEntry[] = []
const NO_ACTIVITY: Activity[] = []
const LATER = stampTime('2026-12-31T00:00:00.000Z')

/** The system accounts every sheet carries, minus anything a given test adds itself. */
const BASE_ACCOUNTS: Account[] = [
  account('bank', 'Bank', 'Bank'),
  account('cash', 'Cash', 'Cash'),
  account('capital', 'Capital', 'Opening Balance / Capital'),
  account('margin', 'Income', 'Trading margin'),
]

describe('computeBalanceSheet — reconciliation', () => {
  it('reports balanced with no plug at all on an empty, freshly-seeded desk', () => {
    const accounts = [...BASE_ACCOUNTS, account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' })]
    const stocks: Stocks = { AED: { available: 0, avgCost: 0 } }

    const result = computeBalanceSheet(accounts, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    expect(result.balanced).toBe(true)
    expect(result.openingStockEquity).toBeCloseTo(0, 2)
    expect(result.unexplained).toBeCloseTo(0, 2)
    expect(result.diags).toHaveLength(0)
  })

  it('attributes genuine pre-ledger currency stock to opening equity and still reports balanced', () => {
    // 1,000 AED at 70 PKR sitting in stock with NO purchase behind it — stock that predates the
    // recorded ledger. There is no originating entry to credit, so 70,000 of assets legitimately
    // has no counterparty. That is a reconciling item, not an error.
    const accounts = [...BASE_ACCOUNTS, account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' })]
    const stocks: Stocks = { AED: { available: 1000, avgCost: 70 } }

    const result = computeBalanceSheet(accounts, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    expect(result.openingStockEquity).toBeCloseTo(70_000, 2)
    expect(result.unexplained).toBeCloseTo(0, 2)
    expect(result.balanced).toBe(true)
    // The plug still runs so the printed sheet foots...
    expect(result.totalDr).toBeCloseTo(result.totalCr, 2)
    // ...and it says what it absorbed, flagged as expected rather than as a problem.
    expect(result.diags).toHaveLength(1)
    expect(result.diags[0].label).toBe('Opening currency stock')
    expect(result.diags[0].amount).toBeCloseTo(70_000, 2)
  })

  it('reports NOT balanced when a real one-legged posting is present — the regression this fix exists for', () => {
    // A customer receivable with no matching credit anywhere: exactly the shape of a posting that
    // recorded one leg and lost the other. Before the fix, the plug swallowed this whole and the
    // sheet still announced "Debits and credits agree across the full dataset."
    const accounts = [
      ...BASE_ACCOUNTS,
      account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' }),
      account('cust', 'Customer', 'Orphan Receivable Customer', { receivable: 25_000, payable: 0 }),
    ]
    const stocks: Stocks = { AED: { available: 0, avgCost: 0 } }

    const result = computeBalanceSheet(accounts, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    expect(result.balanced).toBe(false)
    expect(result.unexplained).toBeCloseTo(25_000, 2)
    // The totals themselves still agree, because the plug still ran — which is precisely why
    // `balanced` must never be derived from them.
    expect(result.totalDr).toBeCloseTo(result.totalCr, 2)
    expect(result.diags.some((d) => d.label === 'Unexplained difference')).toBe(true)
  })

  it('separates the expected residual from a real imbalance when both are present at once', () => {
    const accounts = [
      ...BASE_ACCOUNTS,
      account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' }),
      account('cust', 'Customer', 'Orphan Receivable Customer', { receivable: 25_000, payable: 0 }),
    ]
    const stocks: Stocks = { AED: { available: 1000, avgCost: 70 } }

    const result = computeBalanceSheet(accounts, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    expect(result.openingStockEquity).toBeCloseTo(70_000, 2)
    expect(result.unexplained).toBeCloseTo(25_000, 2)
    expect(result.balanced).toBe(false)
    expect(result.diags.map((d) => d.label)).toEqual(['Opening currency stock', 'Unexplained difference'])
  })

  it('values currency stock AS OF the reporting date, not at today, so a historical sheet still balances', () => {
    // The second half of the same defect. Every other row on this sheet is cut at asOfT, but
    // currency stock was valued from the LIVE position — so any past date mixed two dates and
    // produced a residual the plug then hid. Here: buy 1,000 AED at 70 in March, and ask for the
    // sheet as of February. As of February nothing has happened; the sheet must be empty and
    // balanced, not carrying March's stock against February's (absent) payable.
    const accounts = [
      ...BASE_ACCOUNTS,
      account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' }),
      account('cust', 'Customer', 'Supplier', { receivable: 0, payable: 70_000 }),
    ]
    const stocks: Stocks = { AED: { available: 1000, avgCost: 70 } }
    const march: Activity[] = [
      activity({
        id: 'a1',
        type: 'purchase',
        amount: 1000,
        rate: 70,
        pkrValue: 70_000,
        txnDate: '2026-03-15',
        createdAt: '2026-03-15T10:00:00.000Z',
        outstanding: 70_000,
        paidNow: 0,
      }),
    ]

    const asOfFebruary = computeBalanceSheet(accounts, march, NO_CHEQUES, NO_JOURNAL, stocks, stampTime('2026-02-28T23:59:59.000Z'))

    // Unwinding March's purchase leaves a zero opening position, so nothing is legitimately
    // unjournalled, and February's sheet has no stock on it at all.
    expect(asOfFebruary.openingStockEquity).toBeCloseTo(0, 2)
    // The group is ABSENT, not present-and-zero. This assertion used to read
    // `stockGroup?.rows[0]?.dr ?? 0`, which passed either way and so tested nothing once zero
    // rows began being suppressed — stating which of the two is true is the point.
    expect(asOfFebruary.groups.find((g) => g.title === 'Currency Stock')).toBeUndefined()
  })

  it('does not treat customer/bank opening balances as unexplained — those are journalled against Capital', () => {
    // createAccount posts a real journal entry against Capital for every opening balance
    // (accountsService.ts, `opening_for`), so these carry their own credit and must NOT be
    // swept into the opening-stock allowance or counted as an imbalance.
    const accounts = [
      ...BASE_ACCOUNTS,
      account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' }),
      account('cust', 'Customer', 'Opening Balance Customer', { receivable: 40_000, payable: 0, openingReceivable: 40_000, openingPosted: true }),
    ]
    const stocks: Stocks = { AED: { available: 0, avgCost: 0 } }
    const journal: JournalEntry[] = [
      {
        id: 'j1',
        ref: 'JV-1',
        narration: 'Opening balance',
        debitAccount: 'cust',
        creditAccount: 'capital',
        debitLabel: 'Opening Balance Customer',
        creditLabel: 'Opening Balance / Capital',
        amount: 40_000,
        openingFor: 'cust',
        ...AUDIT,
      },
    ]

    const result = computeBalanceSheet(accounts, [], NO_CHEQUES, journal, stocks, LATER)

    expect(result.openingStockEquity).toBeCloseTo(0, 2)
    expect(result.unexplained).toBeCloseTo(0, 2)
    expect(result.balanced).toBe(true)
    expect(result.diags).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Zero rows are not printed
// ---------------------------------------------------------------------------
// The client's "it shows all", 2026-09-09: a desk with two purchases on it printed the four
// untraded currency positions, both empty expense accounts and an unused salary payable as blank
// lines around the few figures that carried anything.
//
// This is PRESENTATION ONLY and these tests exist to hold it to that — every figure the sheet
// reports, and the balanced/unexplained verdict, must be identical with and without the empty
// rows, because a zero contributes zero.
// ---------------------------------------------------------------------------

describe('computeBalanceSheet — empty rows', () => {
  const TRADED: Account[] = [
    ...BASE_ACCOUNTS,
    account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' }),
    account('currencyUSD', 'Currency Stock', 'Currency stock (USD)', { code: 'USD' }),
    account('currencyJPY', 'Currency Stock', 'Currency stock (JPY)', { code: 'JPY' }),
    account('expense', 'Expense', 'General expenses'),
    account('salaryPayable', 'Payable', 'Salaries payable'),
    account('cust', 'Customer', 'Wazir', { receivable: 0, payable: 250_200 }),
  ]
  // One position held, two currencies untouched.
  const stocks: Stocks = { AED: { available: 0, avgCost: 0 }, USD: { available: 900, avgCost: 278 }, JPY: { available: 0, avgCost: 0 } }

  it('drops accounts with nothing on either side, and the groups left empty by that', () => {
    const result = computeBalanceSheet(TRADED, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    const stockGroup = result.groups.find((g) => g.title === 'Currency Stock')
    expect(stockGroup?.rows.map((r) => r.id)).toEqual(['currencyUSD'])

    // Bank and Cash are both zero, so the group they share does not appear at all.
    expect(result.groups.find((g) => g.title === 'Bank & Cash')).toBeUndefined()
    expect(result.groups.find((g) => g.title === 'Expenses')).toBeUndefined()
    expect(result.groups.find((g) => g.title === 'Other Payables')).toBeUndefined()
  })

  it('keeps every account that does carry a balance', () => {
    const result = computeBalanceSheet(TRADED, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    const customerRows = result.groups.find((g) => g.title === 'Receivables & Payables — Customers')?.rows
    expect(customerRows?.map((r) => r.id)).toEqual(['cust'])
    expect(customerRows?.[0].cr).toBeCloseTo(250_200, 2)
  })

  it('changes no figure and no verdict — the suppressed rows were all zero', () => {
    // The guard on the whole change. Compared against the same books with every empty account
    // removed by hand: if suppressing a row ever moved a total, these two would disagree.
    const withEmpties = computeBalanceSheet(TRADED, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)
    const withoutEmpties = computeBalanceSheet(
      TRADED.filter((a) => !['bank', 'cash', 'expense', 'salaryPayable', 'currency', 'currencyJPY'].includes(a.id)),
      [],
      NO_CHEQUES,
      NO_JOURNAL,
      { USD: { available: 900, avgCost: 278 } },
      LATER,
    )

    expect(withEmpties.totalDr).toBeCloseTo(withoutEmpties.totalDr, 2)
    expect(withEmpties.totalCr).toBeCloseTo(withoutEmpties.totalCr, 2)
    expect(withEmpties.unexplained).toBeCloseTo(withoutEmpties.unexplained, 2)
    expect(withEmpties.openingStockEquity).toBeCloseTo(withoutEmpties.openingStockEquity, 2)
    expect(withEmpties.balanced).toBe(withoutEmpties.balanced)
  })

  it('still prints the Capital row when it is carrying the presentation plug', () => {
    // THE ONE EXCEPTION to the rule above, and the reason the plug is applied below `push` rather
    // than through it. Capital's own balance here is zero, so suppression would drop the row —
    // and then the plug would have nowhere to land and the printed sheet would stop footing.
    //
    // Stock held with no purchase behind it is what forces a plug: 900 USD at 278 is a debit with
    // no credit anywhere to meet it.
    const openingOnly = [...BASE_ACCOUNTS, account('currencyUSD', 'Currency Stock', 'Currency stock (USD)', { code: 'USD' })]
    const result = computeBalanceSheet(openingOnly, [], NO_CHEQUES, NO_JOURNAL, { USD: { available: 900, avgCost: 278 } }, LATER)

    const capitalRow = result.groups.find((g) => g.title === 'Equity')?.rows.find((r) => r.id === 'capital')
    expect(capitalRow).toBeDefined()
    expect(capitalRow!.cr).toBeCloseTo(250_200, 2)
    expect(result.totalDr).toBeCloseTo(result.totalCr, 2)
    // And it is the legitimate kind of residual, not a real imbalance.
    expect(result.balanced).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Customer balances are cut at the reporting date
// ---------------------------------------------------------------------------
// The defect, logged 2026-09-02 and fixed 2026-09-09: the Customer branch read the stored
// `receivable`/`payable` columns with no reference to `asOfT`, so it printed TODAY's balance on a
// balance sheet asked for any past date. Its signature in `npm run reconcile` was a Customer row
// whose Reported figure was identical at every date while Journal only moved.
//
// Every other branch was already cut correctly — Bank/Cash/Expense/Income/Capital/Payable through
// `ledgerBalance(..., keep)`, and Currency Stock through `stockAsOf(...)`. This was the one
// hold-out, and the fix follows the Currency Stock pattern because the problem has the same shape:
// a stored current value that has to be unwound over history rather than replayed from nothing.
// ---------------------------------------------------------------------------

describe('computeBalanceSheet — customer balances as of a past date', () => {
  // A desk whose only customer movement is a credit sale struck on 15 March. The stored columns
  // carry the result of it, which is what today's sheet must keep showing.
  const CUST = account('cust', 'Customer', 'Ahmed Khan', { receivable: 80_000, payable: 0 })
  const accounts = [...BASE_ACCOUNTS, CUST]
  const stocks: Stocks = { AED: { available: 0, avgCost: 0 } }
  const marchSale: Activity[] = [
    activity({
      id: 'a1',
      type: 'sale',
      customerId: 'cust',
      amount: 1000,
      rate: 80,
      pkrValue: 80_000,
      txnDate: '2026-03-15',
      createdAt: '2026-03-15T10:00:00.000Z',
      outstanding: 80_000,
      paidNow: 0,
    }),
  ]
  const FEBRUARY = stampTime('2026-02-28T23:59:59.000Z')

  it('does NOT report a customer balance that had not been created yet', () => {
    const result = computeBalanceSheet(accounts, marchSale, NO_CHEQUES, NO_JOURNAL, stocks, FEBRUARY)

    // In February this customer owed nothing — the sale that created the 80,000 is two weeks away.
    expect(result.groups.find((g) => g.title === 'Receivables & Payables — Customers')).toBeUndefined()
  })

  it('reports the stored figure unchanged on a sheet asked for today', () => {
    // THE CONSTRAINT ON THE WHOLE FIX. Present-day figures are what the reconciliation harness and
    // the client both read, and they must not move by a rupee. Nothing postdates this reporting
    // date, so the stored columns are used directly rather than replayed.
    const result = computeBalanceSheet(accounts, marchSale, NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    const row = result.groups.find((g) => g.title === 'Receivables & Payables — Customers')?.rows.find((r) => r.id === 'cust')
    expect(row?.dr).toBeCloseTo(80_000, 2)
    expect(row?.cr).toBeCloseTo(0, 2)
  })

  it('cuts on the deal date, not the day the deal was keyed in', () => {
    // Backdating moves a deal between reporting periods. A sale keyed in September for a deal
    // struck in March belongs in March's balance sheet and not in February's — custEffects reads
    // activityDate(), so this follows the same rule the rest of the sheet already uses.
    const backdated: Activity[] = [
      activity({
        id: 'a1',
        type: 'sale',
        customerId: 'cust',
        amount: 1000,
        rate: 80,
        pkrValue: 80_000,
        txnDate: '2026-03-15',
        createdAt: '2026-09-09T10:00:00.000Z', // keyed in months later
        outstanding: 80_000,
        paidNow: 0,
      }),
    ]

    const april = computeBalanceSheet(accounts, backdated, NO_CHEQUES, NO_JOURNAL, stocks, stampTime('2026-04-30T00:00:00.000Z'))
    expect(april.groups.find((g) => g.title === 'Receivables & Payables — Customers')?.rows[0]?.dr).toBeCloseTo(80_000, 2)

    const february = computeBalanceSheet(accounts, backdated, NO_CHEQUES, NO_JOURNAL, stocks, FEBRUARY)
    expect(february.groups.find((g) => g.title === 'Receivables & Payables — Customers')).toBeUndefined()
  })

  it('holds a cheque-settled sale on the books until the cheque clears', () => {
    // The replay is not a naive sum of activity: custEffects excludes a cheque-held amount and
    // applies the cleared cheque on its OWN clearing date. Pinned because this is the behaviour
    // that would be lost if anyone reimplemented the replay at the call site.
    const chequeSale: Activity[] = [
      activity({ id: 'a1', type: 'sale', customerId: 'cust', amount: 1000, rate: 80, pkrValue: 80_000, chequeHeld: true, paidNow: 0, txnDate: '2026-03-15', createdAt: '2026-03-15T10:00:00.000Z' }),
    ]
    const cleared: Cheque[] = [
      { id: 'q1', direction: 'Inward', customerId: 'cust', amount: 80_000, status: 'Cleared', createdAt: '2026-03-15T10:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' } as Cheque,
    ]
    const custWithCheque = [...BASE_ACCOUNTS, account('cust', 'Customer', 'Ahmed Khan', { receivable: 0, payable: 0 })]

    // April: sale struck, cheque not yet cleared — still owed.
    const april = computeBalanceSheet(custWithCheque, chequeSale, cleared, NO_JOURNAL, stocks, stampTime('2026-04-30T00:00:00.000Z'))
    expect(april.groups.find((g) => g.title === 'Receivables & Payables — Customers')?.rows[0]?.dr).toBeCloseTo(80_000, 2)

    // June: cheque cleared in May, so the receivable is gone.
    const june = computeBalanceSheet(custWithCheque, chequeSale, cleared, NO_JOURNAL, stocks, stampTime('2026-06-30T00:00:00.000Z'))
    expect(june.groups.find((g) => g.title === 'Receivables & Payables — Customers')).toBeUndefined()
  })

  // WAS "KNOWN GAP". This test pinned the opposite behaviour until the replay became chronological:
  // `custEffects` summed activity and cheques and could not see a hand-written entry at all, so a
  // past-dated sheet silently dropped it. It now reports the figure the customer genuinely owed.
  it('reports a manual journal posting against a customer on a past-dated sheet', () => {
    const manual: JournalEntry[] = [
      {
        id: 'j1', ref: 'JV-1', narration: 'Adjustment', debitAccount: 'cust', creditAccount: 'capital',
        debitLabel: 'Ahmed Khan', creditLabel: 'Capital', amount: 10_000,
        createdAt: '2026-01-10T00:00:00.000Z', createdBy: 'Admin', updatedAt: '2026-01-10T00:00:00.000Z', updatedBy: 'Admin',
      } as JournalEntry,
    ]
    const withManual = [...BASE_ACCOUNTS, account('cust', 'Customer', 'Ahmed Khan', { receivable: 90_000, payable: 0 })]

    // February: the March sale postdates it, so the replay branch runs. January's manual posting
    // has happened by then and the sheet now says so.
    const february = computeBalanceSheet(withManual, marchSale, NO_CHEQUES, manual, stocks, FEBRUARY)
    expect(february.groups.find((g) => g.title === 'Receivables & Payables — Customers')?.rows[0]?.dr).toBeCloseTo(10_000, 2)

    // Today is unchanged: nothing postdates it, so the stored 90,000 still comes through untouched.
    // This is the constraint the whole rework had to hold — present-day figures must not move.
    const today = computeBalanceSheet(withManual, marchSale, NO_CHEQUES, manual, stocks, LATER)
    expect(today.groups.find((g) => g.title === 'Receivables & Payables — Customers')?.rows[0]?.dr).toBeCloseTo(90_000, 2)
  })

  it('reports nothing for a customer whose only movement is a later transfer', () => {
    // The JV case, and the one the old `later` test could not reach: a customer with NO activity
    // row and NO cheque at all. Journal entries were absent from that test, so this customer took
    // the stored-columns branch at every historical date and reported today's balance on a sheet
    // dated before the account existed. Measured at PKR 1,000,000 in `npm run reconcile`.
    const transfer: JournalEntry[] = [
      {
        id: 'j2', ref: 'JV-9', narration: 'Transfer from Ahmed Khan to Kata Customer', debitAccount: 'cust', creditAccount: 'kata',
        debitLabel: 'Ahmed Khan', creditLabel: 'Kata Customer', amount: 1_000_000,
        createdAt: '2026-03-20T00:00:00.000Z', createdBy: 'Admin', updatedAt: '2026-03-20T00:00:00.000Z', updatedBy: 'Admin',
      } as JournalEntry,
    ]
    const kata = account('kata', 'Customer', 'Kata Customer', { receivable: 0, payable: 1_000_000 })
    const withKata = [...BASE_ACCOUNTS, kata]

    const february = computeBalanceSheet(withKata, NO_ACTIVITY, NO_CHEQUES, transfer, stocks, FEBRUARY)
    expect(february.groups.find((g) => g.title === 'Receivables & Payables — Customers'), 'nothing had reached this customer in February').toBeUndefined()

    const today = computeBalanceSheet(withKata, NO_ACTIVITY, NO_CHEQUES, transfer, stocks, LATER)
    expect(today.groups.find((g) => g.title === 'Receivables & Payables — Customers')?.rows[0]?.cr).toBeCloseTo(1_000_000, 2)
  })

  it('applies the allocation rule, settling the opposite column before crossing over', () => {
    // The reason the replay had to become chronological rather than a sum. The customer is owed
    // 4,000 by the desk; a 10,000 debit clears that first and only the remaining 6,000 becomes a
    // receivable. A naive `receivable += 10,000` would report 10,000 against 4,000 and a net that
    // happens to match — the split is what would be wrong, and the split is what is shown.
    const entries: JournalEntry[] = [
      {
        id: 'j3', ref: 'JV-3', narration: 'Adjustment', debitAccount: 'cust', creditAccount: 'capital',
        debitLabel: 'Ahmed Khan', creditLabel: 'Capital', amount: 10_000,
        createdAt: '2026-01-10T00:00:00.000Z', createdBy: 'Admin', updatedAt: '2026-01-10T00:00:00.000Z', updatedBy: 'Admin',
      } as JournalEntry,
    ]
    const owedByDesk = account('cust', 'Customer', 'Ahmed Khan', { receivable: 0, payable: 0, openingPayable: 4_000 })
    const accts = [...BASE_ACCOUNTS, owedByDesk]

    const february = computeBalanceSheet(accts, marchSale, NO_CHEQUES, entries, stocks, FEBRUARY)
    const row = february.groups.find((g) => g.title === 'Receivables & Payables — Customers')?.rows[0]
    expect(row?.cr, 'the 4,000 the desk owed is settled first').toBeCloseTo(0, 2)
    expect(row?.dr, 'only the remaining 6,000 crosses over').toBeCloseTo(6_000, 2)
  })

  it('does not double-count a trade that also wrote voucher legs', () => {
    // A trade writes an activity row AND voucher legs against the same customer. The replay counts
    // the activity row, so counting the legs too would report the sale twice — isVoucherLeg is what
    // keeps them out, exactly as the reports already do elsewhere.
    const legs: JournalEntry[] = [
      {
        id: 'v1', ref: 'JV-5', narration: 'Currency sold to customer', debitAccount: 'cust', creditAccount: 'stockAED',
        debitLabel: 'Ahmed Khan', creditLabel: 'Currency stock (AED)', amount: 80_000,
        voucherId: 'voucher-1', activityId: 'a1',
        createdAt: '2026-03-15T10:00:00.000Z', createdBy: 'Admin', updatedAt: '2026-03-15T10:00:00.000Z', updatedBy: 'Admin',
      } as JournalEntry,
    ]
    // A cheque dated after the sale forces the replay branch without adding a customer movement.
    const laterCheque: Cheque[] = []
    const asOfMidMarch = stampTime('2026-03-16T00:00:00.000Z')
    const withLegs = computeBalanceSheet(accounts, marchSale, laterCheque, legs, stocks, asOfMidMarch)
    const withoutLegs = computeBalanceSheet(accounts, marchSale, laterCheque, NO_JOURNAL, stocks, asOfMidMarch)
    const dr = (r: ReturnType<typeof computeBalanceSheet>) =>
      r.groups.find((g) => g.title === 'Receivables & Payables — Customers')?.rows[0]?.dr ?? 0
    expect(dr(withLegs), 'voucher legs must not add to the activity row they record').toBeCloseTo(dr(withoutLegs), 2)
  })
})
